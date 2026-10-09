from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest

from aftershock.api.app import create_app
from aftershock.api.cache import HIT_HEADER, fresh_for
from tests.test_hub import FakeRedis


@pytest.fixture
async def cached() -> AsyncIterator[tuple[httpx.AsyncClient, FakeRedis]]:
    fake = FakeRedis()
    app = create_app(redis=fake, subscribe=False)  # type: ignore[arg-type]
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            yield c, fake


def test_cache_policy_by_path() -> None:
    assert fresh_for("/api/state") == 5
    assert fresh_for("/api/teams/TOR") == 30
    assert fresh_for("/api/methodology") == 300
    assert fresh_for("/api/health") is None
    assert fresh_for("/api/push/subscribe") is None
    assert fresh_for("/page/team/tor") is None


async def test_state_is_cached_briefly_and_busted_by_version(cached: Any) -> None:
    """Repeat requests reuse one build; the CDN may keep it five seconds. A
    client that must reload adds the version, which is a new document."""
    c, fake = cached
    # Errors are never kept: the next request after the worker starts works.
    assert (await c.get("/api/state")).status_code == 503
    await fake.set("aftershock:state", json.dumps({"mode": "demo", "state_version": 1}))
    first = await c.get("/api/state")
    assert first.status_code == 200 and HIT_HEADER not in first.headers
    assert "s-maxage=5" in first.headers["cache-control"]
    await fake.set("aftershock:state", json.dumps({"mode": "live", "state_version": 2}))
    again = await c.get("/api/state")
    assert again.headers[HIT_HEADER] == "hit" and again.json()["mode"] == "demo"
    assert again.headers["cache-control"] == first.headers["cache-control"]
    fresh = await c.get("/api/state?v=2")
    assert fresh.json()["mode"] == "live"
