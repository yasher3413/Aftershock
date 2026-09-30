from __future__ import annotations

import time
from pathlib import Path

import httpx
import pytest

from aftershock.config import Settings
from aftershock.nhl.client import NhlApiError, NhlClient, NhlNotFound, RateLimiter


def make_client(handler: httpx.MockTransport, tmp_path: Path, **overrides: object) -> NhlClient:
    settings = Settings(nhl_max_rps=1000.0, **overrides)  # type: ignore[arg-type]
    sleeps: list[float] = []

    async def fake_sleep(s: float) -> None:
        sleeps.append(s)

    client = NhlClient(settings, cache_dir=tmp_path, transport=handler, sleep=fake_sleep)
    client.sleeps = sleeps  # type: ignore[attr-defined]
    return client


async def test_retries_on_5xx_then_succeeds(tmp_path: Path) -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(503)
        return httpx.Response(200, json={"ok": True})

    async with make_client(httpx.MockTransport(handler), tmp_path) as client:
        body = await client.score()
    assert body == {"ok": True}
    assert calls["n"] == 3
    assert client.stats.retries == 2


async def test_gives_up_after_max_tries(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, headers={"retry-after": "2"})

    async with make_client(httpx.MockTransport(handler), tmp_path, nhl_max_tries=3) as client:
        with pytest.raises(NhlApiError):
            await client.score()
        assert client.sleeps == [2.0, 2.0]  # type: ignore[attr-defined]


async def test_404_raises_not_found_without_retry(tmp_path: Path) -> None:
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(404)

    async with make_client(httpx.MockTransport(handler), tmp_path) as client:
        with pytest.raises(NhlNotFound):
            await client.play_by_play(2026020001)
    assert calls["n"] == 1


async def test_play_by_play_cached_only_when_final(tmp_path: Path) -> None:
    state = {"value": "LIVE", "n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        state["n"] += 1
        return httpx.Response(200, json={"id": 1, "gameState": state["value"], "plays": []})

    async with make_client(httpx.MockTransport(handler), tmp_path) as client:
        await client.play_by_play(1)
        await client.play_by_play(1)
        assert state["n"] == 2
        state["value"] = "OFF"
        await client.play_by_play(1)
        await client.play_by_play(1)
        assert state["n"] == 3
        assert client.stats.cache_hits == 1
    assert (tmp_path / "play-by-play" / "1.json.gz").exists()


async def test_conditional_request_uses_etag(tmp_path: Path) -> None:
    seen: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers.get("if-none-match"))
        if request.headers.get("if-none-match") == 'W/"abc"':
            return httpx.Response(304)
        return httpx.Response(200, json={"v": 1}, headers={"etag": 'W/"abc"'})

    async with make_client(httpx.MockTransport(handler), tmp_path) as client:
        first = await client.score()
        second = await client.score()
    assert first == second == {"v": 1}
    assert seen == [None, 'W/"abc"']
    assert client.stats.not_modified == 1


async def test_user_agent_is_descriptive(tmp_path: Path) -> None:
    agents: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        agents.append(request.headers["user-agent"])
        return httpx.Response(200, json={})

    async with make_client(httpx.MockTransport(handler), tmp_path) as client:
        await client.score()
    assert agents[0].startswith("aftershock/")
    assert "(+https://" in agents[0]


async def test_rate_limiter_spaces_requests() -> None:
    limiter = RateLimiter(max_rps=50.0)
    start = time.monotonic()
    for _ in range(6):
        await limiter.acquire()
    elapsed = time.monotonic() - start
    assert elapsed >= 5 / 50.0 * 0.9
