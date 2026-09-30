"""Outbound notifications: web push to subscribed browsers, and Discord."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
import structlog
from sqlalchemy import delete, select

from aftershock.api import schemas as S
from aftershock.config import Settings
from aftershock.db.models import PushSubscription
from aftershock.db.session import session_scope

log = structlog.get_logger(__name__)
DISCORD_MIN_MAGNITUDE = 6.0


def tremor_text(t: S.Tremor, team: str | None = None) -> tuple[str, str]:
    who = t.scorer.name if t.scorer else f"{t.team} goal"
    title = f"Magnitude {t.magnitude:.1f}: {who} ({t.team})"
    d = next((x for x in t.deltas if x.team == team), None) if team else None
    if d is not None:
        v = d.d_playoffs * 100
        body = (
            f"{t.away} {t.score_after.away}, {t.home} {t.score_after.home}. {team} playoff "
            f"odds {'up' if v >= 0 else 'down'} {abs(v):.1f} percentage points."
        )
    else:
        body = f"{t.away} {t.score_after.away}, {t.home} {t.score_after.home}."
    return title, body


def _send_push(sub: PushSubscription, payload: str, settings: Settings) -> int | None:
    from pywebpush import WebPushException, webpush

    try:
        webpush(
            subscription_info={"endpoint": sub.endpoint, "keys": sub.keys},
            data=payload,
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={"sub": settings.vapid_subject},
            ttl=3600,
        )
        return None
    except WebPushException as exc:
        return exc.response.status_code if exc.response is not None else -1


async def push_tremor(t: S.Tremor, settings: Settings) -> int:
    """Notify subscribers whose team is in the game and whose threshold is met."""
    if not settings.vapid_private_key or t.overturned:
        return 0
    async with session_scope() as s:
        subs = list(
            (
                await s.execute(
                    select(PushSubscription).where(
                        PushSubscription.team.in_([t.team, t.opponent]),
                        PushSubscription.min_magnitude <= t.magnitude,
                    )
                )
            ).scalars()
        )
    sent = 0
    gone: list[str] = []
    for sub in subs:
        title, body = tremor_text(t, sub.team)
        payload = json.dumps({"title": title, "body": body, "url": f"/tremor/{t.id}"})
        status = await asyncio.to_thread(_send_push, sub, payload, settings)
        if status in (404, 410):
            gone.append(sub.endpoint)
        elif status is None:
            sent += 1
        else:
            log.warning("push.failed", status=status)
    if gone:
        async with session_scope() as s:
            await s.execute(delete(PushSubscription).where(PushSubscription.endpoint.in_(gone)))
    return sent


async def discord_tremor(
    t: S.Tremor, settings: Settings, client: httpx.AsyncClient | None = None
) -> bool:
    """Post magnitude 6+ tremors to a Discord channel with the share card."""
    if not settings.discord_webhook_url or t.magnitude < DISCORD_MIN_MAGNITUDE or t.overturned:
        return False
    title, body = tremor_text(t)
    base = settings.public_base_url.rstrip("/")
    movers = ", ".join(f"{d.team} {d.d_playoffs * 100:+.1f} pp" for d in t.deltas[:3])
    payload: dict[str, Any] = {
        "username": "Aftershock",
        "embeds": [
            {
                "title": title,
                "url": f"{base}/tremor/{t.id}",
                "description": f"{body}\n{movers}",
                "color": 0xC8102E,
                "image": {"url": f"{base}/api/og/tremor/{t.id}.png"},
                "footer": {"text": "Data from NHL.com. Not affiliated with the NHL."},
            }
        ],
    }
    own = client is None
    http = client or httpx.AsyncClient(timeout=10)
    try:
        resp = await http.post(settings.discord_webhook_url, json=payload)
        ok = resp.status_code < 300
        if not ok:
            log.warning("discord.failed", status=resp.status_code)
        return ok
    except httpx.HTTPError as exc:
        log.warning("discord.error", error=str(exc))
        return False
    finally:
        if own:
            await http.aclose()
