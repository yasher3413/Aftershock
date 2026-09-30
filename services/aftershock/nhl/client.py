"""Thin async client for the NHL web API.

The API is public but unofficial and undocumented. This client is polite
(bounded concurrency, a global request rate, backoff on 429 and 5xx), sends a
descriptive User-Agent, uses ETag conditional requests where the server
supports them, and caches raw responses gzipped on disk so backfills are
resumable and never refetch finished data.
"""

from __future__ import annotations

import asyncio
import gzip
import json
import random
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import httpx
import structlog

from aftershock import __version__
from aftershock.config import Settings, get_settings

log = structlog.get_logger(__name__)

JSON = Any

FINISHED_STATES = frozenset({"OFF", "FINAL"})


class NhlApiError(RuntimeError):
    """The API returned an unexpected response after all retries."""


class NhlNotFound(NhlApiError):
    """The API returned 404 for the requested resource."""


class RateLimiter:
    """Global minimum spacing between request starts."""

    def __init__(self, max_rps: float) -> None:
        self._interval = 1.0 / max_rps
        self._lock = asyncio.Lock()
        self._next = 0.0

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            wait = self._next - now
            if wait > 0:
                await asyncio.sleep(wait)
                now = time.monotonic()
            self._next = max(now, self._next) + self._interval


@dataclass
class _Conditional:
    etag: str | None
    last_modified: str | None
    body: JSON


@dataclass
class ClientStats:
    requests: int = 0
    cache_hits: int = 0
    not_modified: int = 0
    retries: int = 0
    last_success: dict[str, float] = field(default_factory=dict)


class NhlClient:
    """Async NHL API client. Use as an async context manager."""

    def __init__(
        self,
        settings: Settings | None = None,
        *,
        cache_dir: Path | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Any] = asyncio.sleep,
    ) -> None:
        self.settings = settings or get_settings()
        self.cache_dir = cache_dir if cache_dir is not None else self.settings.raw_cache_dir
        self._sem = asyncio.Semaphore(self.settings.nhl_max_concurrency)
        self._limiter = RateLimiter(self.settings.nhl_max_rps)
        self._conditional: dict[str, _Conditional] = {}
        self._sleep = sleep
        self.stats = ClientStats()
        self._http = httpx.AsyncClient(
            timeout=self.settings.nhl_timeout_seconds,
            follow_redirects=True,
            transport=transport,
            headers={
                "User-Agent": f"aftershock/{__version__} (+{self.settings.repo_url})",
                "Accept": "application/json",
            },
        )

    async def __aenter__(self) -> NhlClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._http.aclose()

    # ------------------------------------------------------------------
    # Core request path

    def _cache_path(self, endpoint: str, key: str) -> Path:
        return self.cache_dir / endpoint / f"{key}.json.gz"

    def read_cache(self, endpoint: str, key: str) -> JSON | None:
        path = self._cache_path(endpoint, key)
        if not path.exists():
            return None
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            return json.load(fh)

    def write_cache(self, endpoint: str, key: str, body: JSON) -> None:
        path = self._cache_path(endpoint, key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        with gzip.open(tmp, "wt", encoding="utf-8") as fh:
            json.dump(body, fh, separators=(",", ":"))
        tmp.replace(path)

    async def get(
        self,
        url: str,
        *,
        params: dict[str, str] | None = None,
        cache: tuple[str, str] | None = None,
        store_if: Callable[[JSON], bool] | None = None,
        use_cache: bool = True,
    ) -> JSON:
        """Fetch JSON from ``url``.

        ``cache`` is ``(endpoint, key)``. When given and ``use_cache`` is
        true, a cached copy is returned without a request. A fresh response is
        written to the cache when ``store_if`` is absent or returns true, so
        callers can cache only immutable data (for example finished games).
        """
        if cache is not None and use_cache:
            cached = self.read_cache(*cache)
            if cached is not None:
                self.stats.cache_hits += 1
                return cached
        body = await self._fetch(url, params)
        if cache is not None and (store_if is None or store_if(body)):
            self.write_cache(*cache, body)
        return body

    async def _fetch(self, url: str, params: dict[str, str] | None) -> JSON:
        cond_key = url + ("?" + str(sorted(params.items())) if params else "")
        tries = self.settings.nhl_max_tries
        last_error: Exception | None = None
        for attempt in range(tries):
            headers: dict[str, str] = {}
            prior = self._conditional.get(cond_key)
            if prior is not None:
                if prior.etag:
                    headers["If-None-Match"] = prior.etag
                if prior.last_modified:
                    headers["If-Modified-Since"] = prior.last_modified
            retry_after: float | None = None
            async with self._sem:
                await self._limiter.acquire()
                self.stats.requests += 1
                try:
                    resp = await self._http.get(url, params=params, headers=headers)
                except (httpx.TimeoutException, httpx.TransportError) as exc:
                    last_error = exc
                    resp = None
            if resp is not None:
                if resp.status_code == 304 and prior is not None:
                    self.stats.not_modified += 1
                    self.stats.last_success[_source(url)] = time.time()
                    return prior.body
                if resp.status_code == 200:
                    body = resp.json()
                    etag = resp.headers.get("etag")
                    last_mod = resp.headers.get("last-modified")
                    if etag or last_mod:
                        self._conditional[cond_key] = _Conditional(etag, last_mod, body)
                    self.stats.last_success[_source(url)] = time.time()
                    return body
                if resp.status_code == 404:
                    raise NhlNotFound(f"404 for {resp.url}")
                if resp.status_code != 429 and resp.status_code < 500:
                    raise NhlApiError(f"HTTP {resp.status_code} for {resp.url}")
                last_error = NhlApiError(f"HTTP {resp.status_code} for {resp.url}")
                ra = resp.headers.get("retry-after")
                if ra and ra.isdigit():
                    retry_after = float(ra)
            if attempt == tries - 1:
                break
            self.stats.retries += 1
            delay = retry_after if retry_after is not None else _backoff(attempt)
            log.warning(
                "nhl.retry",
                url=url,
                attempt=attempt + 1,
                delay=round(delay, 2),
                error=str(last_error),
            )
            await self._sleep(delay)
        raise NhlApiError(f"giving up on {url} after {tries} tries: {last_error}")

    # ------------------------------------------------------------------
    # Endpoints

    @property
    def base(self) -> str:
        return self.settings.nhl_api_base.rstrip("/")

    async def score(self, day: date | None = None) -> JSON:
        suffix = "now" if day is None else day.isoformat()
        return await self.get(f"{self.base}/score/{suffix}")

    async def schedule(self, day: date | None = None) -> JSON:
        suffix = "now" if day is None else day.isoformat()
        return await self.get(f"{self.base}/schedule/{suffix}")

    async def play_by_play(self, game_id: int, *, use_cache: bool = True) -> JSON:
        """Play-by-play. Cached on disk only once the game is finished."""
        return await self.get(
            f"{self.base}/gamecenter/{game_id}/play-by-play",
            cache=("play-by-play", str(game_id)),
            store_if=lambda b: b.get("gameState") in FINISHED_STATES,
            use_cache=use_cache,
        )

    async def landing(self, game_id: int) -> JSON:
        return await self.get(
            f"{self.base}/gamecenter/{game_id}/landing",
            cache=("landing", str(game_id)),
            store_if=lambda b: b.get("gameState") in FINISHED_STATES,
        )

    async def boxscore(self, game_id: int) -> JSON:
        return await self.get(
            f"{self.base}/gamecenter/{game_id}/boxscore",
            cache=("boxscore", str(game_id)),
            store_if=lambda b: b.get("gameState") in FINISHED_STATES,
        )

    async def standings(self, day: date | None = None, *, final: bool = False) -> JSON:
        """Standings on ``day`` (or now). ``final`` caches past-season dates."""
        if day is None:
            return await self.get(f"{self.base}/standings/now")
        return await self.get(
            f"{self.base}/standings/{day.isoformat()}",
            cache=("standings", day.isoformat()) if final else None,
        )

    async def standings_seasons(self) -> JSON:
        return await self.get(f"{self.base}/standings-season")

    async def club_schedule_season(self, team: str, season: int, *, final: bool) -> JSON:
        return await self.get(
            f"{self.base}/club-schedule-season/{team}/{season}",
            cache=("club-schedule-season", f"{team}-{season}") if final else None,
        )

    async def roster(self, team: str, season: int | None = None) -> JSON:
        suffix = "current" if season is None else str(season)
        return await self.get(f"{self.base}/roster/{team}/{suffix}")

    async def player_landing(self, player_id: int) -> JSON:
        return await self.get(f"{self.base}/player/{player_id}/landing")

    async def shiftcharts(self, game_id: int) -> JSON:
        base = self.settings.nhl_stats_api_base.rstrip("/")
        return await self.get(
            f"{base}/shiftcharts",
            params={"cayenneExp": f"gameId={game_id}"},
            cache=("shiftcharts", str(game_id)),
        )


def _backoff(attempt: int) -> float:
    """Exponential backoff with full jitter, capped at 30 seconds."""
    return float(min(30.0, 0.5 * 2**attempt) * (0.5 + random.random() / 2))


def _source(url: str) -> str:
    """Short name of an endpoint for health reporting."""
    parts = url.split("/v1/", 1)[-1].split("/")
    if parts and parts[0] == "gamecenter" and len(parts) > 2:
        return parts[2]
    return parts[0] if parts else url
