"""The goal bot: posts each regular-season goal on X, deletes overturned
ones, and replies with credit corrections.

The live worker hands it goals, reversals, and corrections; one queue and
one consumer task keep them in order and off the worker's critical path.
Every error is logged and swallowed. See docs/superpowers/specs/
2026-10-23-goal-bot-design.md and docs/DEPLOY.md, "Goal bot on X".
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, TypeVar

import httpx
import structlog
from redis.asyncio import Redis
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine

from aftershock.api import schemas as S
from aftershock.bot.text import CREDIT_KEYS, alt_text, compose, context_clause, correction
from aftershock.bot.x import XClient, XError
from aftershock.config import Settings
from aftershock.db.models import BotPost, Game, Team, Tremor
from aftershock.db.session import session_scope
from aftershock.share.cards import CairoUnavailable, render_png, tremor_og

log = structlog.get_logger(__name__)

Mode = Literal["off", "dry_run", "live"]
MODE_KEY = "aftershock:bot:mode"
SPEND_KEY = "aftershock:bot:spend:{month}"
SPEND_TTL_S = 40 * 86400
# Costs in tenths of a cent (X pay-per-use prices checked 2026-10-23).
POST_COST = 15
UPLOAD_COST = 5
STALE_AFTER = timedelta(minutes=15)
REGULAR_SEASON = 2
# Retries on rate limits and server errors: 2 s doubling to 30 s, about
# three minutes in all, then the goal is given up.
RETRY_FIRST_S = 2.0
RETRY_MAX_S = 30.0
RETRY_WINDOW_S = 180.0

__all__ = ["CairoUnavailable", "GoalBot", "render_png"]

T = TypeVar("T")


class GaveUp(Exception):
    pass


class _Window:
    """One retry window for everything a goal sends to X: real time since it
    started, or the time spent waiting, whichever is more."""

    def __init__(self) -> None:
        self.start = time.monotonic()
        self.slept = 0.0

    def used(self) -> float:
        return max(time.monotonic() - self.start, self.slept)


class GoalBot:
    def __init__(
        self,
        settings: Settings,
        redis: Redis,
        x: XClient | None = None,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
        *,
        engine: AsyncEngine | None = None,
    ) -> None:
        self.settings = settings
        self.redis = redis
        self.x = x if x is not None else XClient(settings)
        self.now = now
        self.engine = engine
        self.queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()
        self.task: asyncio.Task[None] | None = None

    # ------------------------------------------------------------------
    # Feeding and running

    def start(self) -> None:
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self._consume())

    async def stop(self) -> None:
        if self.task is not None:
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.task
            self.task = None

    async def drain(self) -> None:
        await self.queue.join()

    def enqueue_goal(self, t: S.Tremor) -> None:
        self.queue.put_nowait(("goal", t))

    def enqueue_reversal(self, tremor_id: int) -> None:
        self.queue.put_nowait(("reversal", tremor_id))

    def enqueue_correction(self, tremor_id: int, changes: dict[str, Any]) -> None:
        self.queue.put_nowait(("correction", (tremor_id, changes)))

    async def _consume(self) -> None:
        while True:
            kind, item = await self.queue.get()
            try:
                if kind == "goal":
                    await self._goal(item)
                elif kind == "reversal":
                    await self._reversal(item)
                else:
                    await self._correction(*item)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.exception("bot.failed", kind=kind, error=str(exc))
            finally:
                self.queue.task_done()

    async def mode(self) -> Mode:
        raw = await self.redis.get(MODE_KEY)
        modes: dict[str, Mode] = {"off": "off", "dry_run": "dry_run", "live": "live"}
        mode = modes.get(str(raw or ""), self.settings.x_bot_mode)
        if mode == "live" and not self.settings.x_keys_present:
            return "off"
        return mode

    # ------------------------------------------------------------------
    # Spending

    def _spend_key(self) -> str:
        return SPEND_KEY.format(month=self.now().strftime("%Y-%m"))

    async def _can_spend(self, cost: int) -> bool:
        spent = int(await self.redis.get(self._spend_key()) or 0)
        if spent + cost > self.settings.x_bot_monthly_cap_millicents:
            log.error(
                "bot.cap_reached", spent=spent, cap=self.settings.x_bot_monthly_cap_millicents
            )
            return False
        return True

    async def _spend(self, cost: int) -> None:
        key = self._spend_key()
        await self.redis.incrby(key, cost)
        await self.redis.expire(key, SPEND_TTL_S)

    async def _retry(self, what: str, call: Callable[[], Awaitable[T]], window: _Window) -> T:
        delay = RETRY_FIRST_S
        while True:
            try:
                return await call()
            except (XError, httpx.TransportError) as exc:
                status = exc.status if isinstance(exc, XError) else 0
                retryable = exc.retryable if isinstance(exc, XError) else True
                if not retryable or window.used() + delay > RETRY_WINDOW_S:
                    log.error("bot.gave_up", what=what, status=status, error=str(exc))
                    raise GaveUp(what) from exc
                log.warning("bot.retry", what=what, status=status, wait_s=delay)
                await asyncio.sleep(delay)
                window.slept += delay
                delay = min(delay * 2, RETRY_MAX_S)

    # ------------------------------------------------------------------
    # Goals

    async def _goal(self, t: S.Tremor) -> None:
        mode = await self.mode()
        if mode == "off":
            return
        async with session_scope(self.engine) as s:
            row = await s.get(BotPost, t.id)
            # A deleted post is for a goal the feed took away; if the goal is
            # back (same id, not overturned), it is posted again.
            if row is not None and not row.deleted:
                return
            game_type = await s.scalar(select(Game.game_type).where(Game.id == t.game_id))
            if game_type != REGULAR_SEASON:
                log.info("bot.skip", tremor=t.id, reason="not_regular_season")
                return
            # Reversed while it waited in the queue.
            if t.overturned or await s.scalar(select(Tremor.overturned).where(Tremor.id == t.id)):
                log.info("bot.skip", tremor=t.id, reason="overturned")
                return
            if self._stale(t):
                return
            context = await self._context(s, t)
            teams = [
                S.TeamInfo.model_validate(x) for x in (await s.execute(select(Team))).scalars()
            ]
        text = compose(t, context)
        names = {
            "scorer": t.scorer.name if t.scorer else None,
            "assist1": t.assists[0].name if t.assists else None,
            "assist2": t.assists[1].name if len(t.assists) > 1 else None,
        }
        if mode == "live" and not await self._can_spend(POST_COST + UPLOAD_COST):
            return
        # The row goes in before X is called, so a duplicate message or a
        # retry after an unclear failure can never post the goal twice.
        async with session_scope(self.engine) as s:
            await s.merge(
                BotPost(tremor_id=t.id, post_id=None, mode=mode, text=text, deleted=False, **names)
            )
        if mode == "dry_run":
            log.info("bot.post", mode=mode, tremor=t.id, text=text)
            return
        window = _Window()
        png = await self._card(t, teams)
        media_id = None
        if png is not None:
            try:
                media_id = await self._retry(
                    "upload", lambda: self.x.upload_media(png, alt_text(t)), window
                )
                await self._spend(UPLOAD_COST)
            except GaveUp:
                log.warning("bot.text_only", tremor=t.id)
        if self._stale(t):
            return
        try:
            post_id = await self._retry(
                "post", lambda: self.x.post(text, media_id=media_id), window
            )
        except GaveUp:
            return
        async with session_scope(self.engine) as s:
            row = await s.get(BotPost, t.id)
            if row is not None:
                row.post_id = post_id
        await self._spend(POST_COST)
        log.info("bot.post", mode=mode, tremor=t.id, post=post_id, text=text)

    def _stale(self, t: S.Tremor) -> bool:
        if self.now() - t.created_at > STALE_AFTER:
            log.info("bot.skip", tremor=t.id, reason="stale")
            return True
        return False

    async def _card(self, t: S.Tremor, teams: list[S.TeamInfo]) -> bytes | None:
        try:
            return await asyncio.to_thread(render_png, tremor_og(t, teams))
        except Exception as exc:
            log.warning("bot.card_failed", tremor=t.id, error=str(exc))
            return None

    async def _context(self, s: Any, t: S.Tremor) -> str | None:
        regular = (
            select(Tremor.magnitude)
            .join(Game, Game.id == Tremor.game_id)
            .where(
                Game.game_type == REGULAR_SEASON,
                Tremor.overturned.is_(False),
                Tremor.id != t.id,
            )
        )
        night = list(
            (
                await s.execute(
                    regular.where(
                        Tremor.night_date == t.night_date, Tremor.created_at < t.created_at
                    )
                )
            ).scalars()
        )
        higher = await s.scalar(
            select(func.count()).select_from(
                regular.where(Tremor.season == t.season, Tremor.magnitude > t.magnitude).subquery()
            )
        )
        return context_clause(t.magnitude, night, int(higher or 0) + 1)

    # ------------------------------------------------------------------
    # Fixes

    async def _reversal(self, tremor_id: int) -> None:
        async with session_scope(self.engine) as s:
            row = await s.get(BotPost, tremor_id)
            if row is None or row.deleted:
                return
            post_id, row_mode = row.post_id, row.mode
        # A live post that is now false is deleted whatever the mode
        # (deleting is free), as long as the keys are there.
        if row_mode == "live" and post_id and self.settings.x_keys_present:
            try:
                await self._retry("delete", lambda: self.x.delete(post_id), _Window())
            except GaveUp:
                return
        log.info("bot.delete", tremor=tremor_id, post=post_id, mode=row_mode)
        async with session_scope(self.engine) as s:
            row = await s.get(BotPost, tremor_id)
            if row is not None:
                row.deleted = True

    async def _correction(self, tremor_id: int, changes: dict[str, Any]) -> None:
        mode = await self.mode()
        async with session_scope(self.engine) as s:
            row = await s.get(BotPost, tremor_id)
            if row is None or row.deleted:
                return
            before = {k: getattr(row, k) for k in CREDIT_KEYS}
            post_id, row_mode = row.post_id, row.mode
        text = correction(changes, before)
        if not text:
            return
        if row_mode == "live" and post_id:
            if mode != "live" or not await self._can_spend(POST_COST):
                log.warning("bot.correction_skipped", tremor=tremor_id, mode=mode, text=text)
                return
            try:
                reply = await self._retry(
                    "reply", lambda: self.x.post(text, reply_to=post_id), _Window()
                )
            except GaveUp:
                return
            await self._spend(POST_COST)
            log.info("bot.correction", tremor=tremor_id, post=reply, text=text)
        else:
            log.info("bot.correction", tremor=tremor_id, mode=row_mode, text=text)
        async with session_scope(self.engine) as s:
            row = await s.get(BotPost, tremor_id)
            if row is not None:
                for k in CREDIT_KEYS:
                    if k in changes:
                        v = changes[k]
                        setattr(
                            row, k, v.name if isinstance(v, S.PlayerRef) else (v or {}).get("name")
                        )
