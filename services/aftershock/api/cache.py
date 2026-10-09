"""Short-lived caching of read-only api responses.

Every page load asks the api for the same few documents, and the VM has a
single small CPU. Responses carry ``s-maxage`` so Vercel's CDN, which sits in
front of ``/api`` (vercel.json), answers repeat requests itself, and each api
process keeps its own copy for the same few seconds so cache misses from
several CDN regions build each document once. Live updates never depend on
this: they arrive over the WebSocket, which fills any gap since the state a
page loaded (``?since=``), and the client adds the state version to the URL
when it must reload the state.
"""

from __future__ import annotations

import asyncio
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable

from starlette.requests import Request
from starlette.responses import Response

# Seconds a response stays fresh, by path prefix; None is never cached.
POLICY: tuple[tuple[str, int | None], ...] = (
    ("/api/health", None),
    ("/api/push", None),
    ("/api/docs", None),
    ("/api/openapi.json", None),
    ("/api/state", 5),
    ("/api/status", 10),
    ("/api/methodology", 300),
    ("/api/reports", 300),
)
DEFAULT_S = 30
MAX_ENTRIES = 512
HIT_HEADER = "x-aftershock-cache"

Next = Callable[[Request], Awaitable[Response]]


def fresh_for(path: str) -> int | None:
    if not path.startswith("/api/"):
        return None
    for prefix, seconds in POLICY:
        if path == prefix or path.startswith(prefix + "/"):
            return seconds
    return DEFAULT_S


def cache_control(seconds: int) -> str:
    """Browsers revalidate; the CDN serves its copy for ``seconds`` and a
    stale one briefly while it fetches the next."""
    return f"public, max-age=0, s-maxage={seconds}, stale-while-revalidate={max(10, seconds * 2)}"


class ResponseCache:
    """HTTP middleware: adds the CDN header and keeps a per-process copy."""

    def __init__(self, *, enabled: bool = True) -> None:
        self.enabled = enabled
        self._store: OrderedDict[str, tuple[float, Response]] = OrderedDict()
        self._locks: dict[str, asyncio.Lock] = {}

    async def __call__(self, request: Request, call_next: Next) -> Response:
        seconds = fresh_for(request.url.path) if request.method == "GET" else None
        if seconds is None:
            return await call_next(request)
        if not self.enabled:
            return await self._render(request, call_next, seconds, store=False)
        key = f"{request.url.path}?{request.url.query}"
        hit = self._get(key)
        if hit is not None:
            return hit
        # One build per document at a time; the others wait for it.
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            hit = self._get(key)
            if hit is not None:
                return hit
            response = await self._render(request, call_next, seconds, store=True, key=key)
        self._locks.pop(key, None)
        return response

    def _get(self, key: str) -> Response | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        expires, cached = entry
        if time.monotonic() >= expires:
            del self._store[key]
            return None
        headers = dict(cached.headers)
        headers.pop("content-length", None)
        headers[HIT_HEADER] = "hit"
        return Response(bytes(cached.body), status_code=cached.status_code, headers=headers)

    async def _render(
        self, request: Request, call_next: Next, seconds: int, *, store: bool, key: str = ""
    ) -> Response:
        response = await call_next(request)
        # Endpoints that set their own policy (replays, images, files) keep it.
        if response.status_code != 200 or "cache-control" in response.headers:
            return response
        body = b"".join([chunk async for chunk in response.body_iterator])  # type: ignore[attr-defined]
        headers = dict(response.headers)
        headers.pop("content-length", None)
        headers["cache-control"] = cache_control(seconds)
        out = Response(body, status_code=200, headers=headers)
        if store:
            self._store[key] = (time.monotonic() + seconds, out)
            self._store.move_to_end(key)
            while len(self._store) > MAX_ENTRIES:
                self._store.popitem(last=False)
        return out
