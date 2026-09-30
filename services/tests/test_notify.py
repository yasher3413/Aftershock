from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncEngine

from aftershock.config import Settings
from aftershock.db.models import PushSubscription
from aftershock.db.session import session_scope
from aftershock.live import notify
from tests.test_share import tremor


async def test_discord_posts_only_big_tremors() -> None:
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return httpx.Response(204)

    s = Settings(
        discord_webhook_url="https://discord.example/hook",
        public_base_url="https://aftershock.example",
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
        assert await notify.discord_tremor(tremor(), s, client=c)  # magnitude 6.4
        small = tremor().model_copy(update={"magnitude": 3.0})
        assert not await notify.discord_tremor(small, s, client=c)
        assert not await notify.discord_tremor(tremor(), Settings(discord_webhook_url=""), client=c)
    embed = seen[0]["embeds"][0]
    assert embed["url"] == "https://aftershock.example/tremor/1"
    assert embed["image"]["url"].endswith("/api/og/tremor/1.png")
    assert "+5.4 pp" in embed["description"]


@pytest.mark.db
async def test_push_targets_team_and_threshold_and_drops_dead_endpoints(
    db_engine: AsyncEngine, monkeypatch: pytest.MonkeyPatch
) -> None:
    import aftershock.db.session as dbs

    monkeypatch.setattr(dbs, "get_engine", lambda url=None: db_engine)
    async with session_scope(db_engine) as s:
        s.add_all(
            [
                PushSubscription(
                    endpoint="https://p/mtl",
                    keys={"p256dh": "a", "auth": "b"},
                    team="MTL",
                    min_magnitude=5.0,
                ),
                PushSubscription(
                    endpoint="https://p/nsh-high",
                    keys={"p256dh": "a", "auth": "b"},
                    team="NSH",
                    min_magnitude=7.0,
                ),
                PushSubscription(
                    endpoint="https://p/tor",
                    keys={"p256dh": "a", "auth": "b"},
                    team="TOR",
                    min_magnitude=1.0,
                ),
                PushSubscription(
                    endpoint="https://p/gone",
                    keys={"p256dh": "a", "auth": "b"},
                    team="NSH",
                    min_magnitude=1.0,
                ),
            ]
        )
    sent: list[tuple[str, dict[str, Any]]] = []

    def fake_send(sub: PushSubscription, payload: str, settings: Settings) -> int | None:
        if sub.endpoint.endswith("gone"):
            return 410
        sent.append((sub.endpoint, json.loads(payload)))
        return None

    monkeypatch.setattr(notify, "_send_push", fake_send)
    n = await notify.push_tremor(tremor(), Settings(vapid_private_key="x"))
    assert n == 1
    assert sent[0][0] == "https://p/mtl"
    assert "MTL playoff odds up 5.4 percentage points" in sent[0][1]["body"]
    async with session_scope(db_engine) as s:
        assert await s.get(PushSubscription, "https://p/gone") is None
        assert await s.get(PushSubscription, "https://p/tor") is not None
