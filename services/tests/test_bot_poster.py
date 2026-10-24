from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine

from aftershock.api import schemas as S
from aftershock.bot import poster as P
from aftershock.bot.poster import GoalBot
from aftershock.bot.text import correction
from aftershock.bot.x import XError
from aftershock.config import Settings
from aftershock.db.models import BotPost, Game, Tremor
from aftershock.db.session import session_scope
from aftershock.ingest.load import seed_reference
from tests.test_hub import FakeRedis
from tests.test_share import tremor

pytestmark = pytest.mark.db

NOW = datetime(2026, 10, 24, 1, 0, tzinfo=UTC)
NIGHT = date(2026, 10, 23)
KEYS = dict(x_api_key="k", x_api_secret="s", x_access_token="t", x_access_secret="a")


class FakeX:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.fail: list[XError] = []  # raised by post(), first to last
        self.n = 0

    async def upload_media(self, png: bytes, alt: str) -> str:
        self.calls.append(("upload", alt))
        return "m1"

    async def post(
        self, text: str, *, media_id: str | None = None, reply_to: str | None = None
    ) -> str:
        if self.fail:
            raise self.fail.pop(0)
        self.n += 1
        self.calls.append(("post", {"text": text, "media_id": media_id, "reply_to": reply_to}))
        return f"p{self.n}"

    async def delete(self, post_id: str) -> None:
        self.calls.append(("delete", post_id))

    def kinds(self) -> list[str]:
        return [k for k, _ in self.calls]


def goal(tid: int, game_id: int = 2026020100, mag: float = 6.4, **kw: Any) -> S.Tremor:
    return tremor().model_copy(
        update={
            "id": tid,
            "game_id": game_id,
            "event_id": tid,
            "season": 20262027,
            "night_date": NIGHT,
            "magnitude": mag,
            "goalie": S.PlayerRef(id=7, name="Juuse Saros"),
            "created_at": NOW - timedelta(seconds=30),
            **kw,
        }
    )


async def add_game(engine: AsyncEngine, game_id: int = 2026020100, game_type: int = 2) -> None:
    async with session_scope(engine) as s:
        s.add(
            Game(
                id=game_id,
                season=20262027,
                game_type=game_type,
                night_date=NIGHT,
                start_utc=NOW - timedelta(hours=2),
                home="MTL",
                away="NSH",
                venue="Centre Bell",
                state="LIVE",
            )
        )


async def add_tremor(engine: AsyncEngine, t: S.Tremor, overturned: bool = False) -> None:
    async with session_scope(engine) as s:
        s.add(
            Tremor(
                id=t.id,
                season=t.season,
                game_id=t.game_id,
                event_id=t.event_id,
                team=t.team,
                opponent=t.opponent,
                period=t.period,
                period_type=t.period_type,
                t_period_s=t.t_period_s,
                t_game_s=t.t_game_s,
                score_before=t.score_before.model_dump(),
                score_after=t.score_after.model_dump(),
                wp_before=t.wp_before.model_dump(),
                wp_after=t.wp_after.model_dump(),
                deltas={},
                total_shift=t.total_shift,
                magnitude=t.magnitude,
                ppa=t.ppa,
                cpa=t.cpa,
                overturned=overturned,
                night_date=t.night_date,
                created_at=t.created_at,
            )
        )


@pytest.fixture
async def world(db_engine: AsyncEngine) -> AsyncIterator[AsyncEngine]:
    async with session_scope(db_engine) as s:
        await seed_reference(s)
    await add_game(db_engine)
    yield db_engine


@pytest.fixture(autouse=True)
def card(monkeypatch: pytest.MonkeyPatch) -> None:
    # Cairo may be missing on the test machine; the card's content is tested elsewhere.
    monkeypatch.setattr(P, "render_png", lambda svg: b"\x89PNG")


def make(
    engine: AsyncEngine, mode: str = "live", redis: FakeRedis | None = None, **kw: Any
) -> tuple[GoalBot, FakeX, FakeRedis]:
    x, r = FakeX(), redis or FakeRedis()
    settings = Settings(x_bot_mode=mode, **{**KEYS, **kw})  # type: ignore[arg-type]
    bot = GoalBot(settings, r, x, now=lambda: NOW, engine=engine)  # type: ignore[arg-type]
    return bot, x, r


async def run(bot: GoalBot, *items: tuple[str, Any]) -> None:
    bot.start()
    for kind, arg in items:
        if kind == "goal":
            bot.enqueue_goal(arg)
        elif kind == "reverse":
            bot.enqueue_reversal(arg)
        else:
            bot.enqueue_correction(*arg)
    await bot.drain()
    await bot.stop()


async def rows(engine: AsyncEngine) -> list[BotPost]:
    async with session_scope(engine) as s:
        return list((await s.execute(select(BotPost))).scalars())


async def test_live_goal_posts_once_with_card(world: AsyncEngine) -> None:
    t = goal(1)
    await add_tremor(world, t)
    bot, x, r = make(world)
    await run(bot, ("goal", t), ("goal", t))
    assert x.kinds() == ["upload", "post"]
    assert x.calls[1][1]["media_id"] == "m1" and x.calls[1][1]["text"].startswith("🚨 ")
    [row] = await rows(world)
    assert (row.tremor_id, row.post_id, row.mode, row.scorer) == (
        1,
        "p1",
        "live",
        "Cole Caufield & Co",
    )
    assert int(r.kv["aftershock:bot:spend:2026-10"]) == 20


async def test_skips(world: AsyncEngine) -> None:
    await add_game(world, 2026030100, game_type=3)
    await add_game(world, 2026010100, game_type=1)
    goals = [
        goal(2, game_id=2026030100),
        goal(3, game_id=2026010100),
        goal(4),
        goal(5, created_at=NOW - timedelta(minutes=16)),
    ]
    for t in goals:
        await add_tremor(world, t, overturned=t.id == 4)
    bot, x, _ = make(world)
    await run(bot, *[("goal", t) for t in goals])
    assert x.calls == [] and await rows(world) == []


async def test_dry_run_records_without_calling_x(world: AsyncEngine) -> None:
    t = goal(6)
    await add_tremor(world, t)
    bot, x, _ = make(world, mode="dry_run")
    await run(bot, ("goal", t))
    assert x.calls == []
    [row] = await rows(world)
    assert (row.mode, row.post_id) == ("dry_run", None) and row.text.startswith("🚨 ")


async def test_off_does_nothing(world: AsyncEngine) -> None:
    t = goal(7)
    await add_tremor(world, t)
    bot, x, _ = make(world, mode="off")
    await run(bot, ("goal", t))
    assert x.calls == [] and await rows(world) == []
    # Live without every key is off too.
    bot, x, _ = make(world, mode="live", x_access_secret="")
    await run(bot, ("goal", t))
    assert x.calls == [] and await rows(world) == []


async def test_redis_mode_overrides_setting(world: AsyncEngine) -> None:
    t = goal(8)
    await add_tremor(world, t)
    r = FakeRedis()
    await r.set("aftershock:bot:mode", "dry_run")
    bot, _, _ = make(world, mode="live", redis=r)
    assert await bot.mode() == "dry_run"
    await r.set("aftershock:bot:mode", "off")
    assert await bot.mode() == "off"
    await r.set("aftershock:bot:mode", "nonsense")
    assert await bot.mode() == "live"


async def test_reversal_deletes_and_correction_replies(world: AsyncEngine) -> None:
    t = goal(9, assists=[S.PlayerRef(id=2, name="Nick Suzuki")])
    u = goal(10, mag=3.0)
    await add_tremor(world, t)
    await add_tremor(world, u)
    bot, x, _ = make(world)
    changes = {"scorer": {"id": 5, "name": "Morgan Rielly"}, "goalie": None}
    await run(bot, ("goal", t), ("goal", u), ("fix", (9, changes)), ("reverse", 10))
    expected = correction(changes, {"scorer": "Cole Caufield & Co", "assist1": "Nick Suzuki"})
    reply = x.calls[4][1]
    assert reply == {"text": expected, "media_id": None, "reply_to": "p1"}
    assert x.calls[5] == ("delete", "p2")
    by_id = {row.tremor_id: row for row in await rows(world)}
    assert by_id[9].scorer == "Morgan Rielly" and by_id[9].assist1 == "Nick Suzuki"
    assert by_id[10].deleted and not by_id[9].deleted


async def test_reversal_or_correction_without_post_is_ignored(world: AsyncEngine) -> None:
    bot, x, _ = make(world)
    await run(bot, ("reverse", 99), ("fix", (99, {"scorer": {"id": 5, "name": "A B"}})))
    assert x.calls == []
    # A goalie-only correction says nothing.
    t = goal(11)
    await add_tremor(world, t)
    bot, x, _ = make(world)
    await run(bot, ("goal", t), ("fix", (11, {"goalie": {"id": 8, "name": "C D"}})))
    assert x.kinds() == ["upload", "post"]


async def test_cap_stops_posting(world: AsyncEngine) -> None:
    t = goal(12)
    await add_tremor(world, t)
    r = FakeRedis()
    await r.set("aftershock:bot:spend:2026-10", "39990")
    bot, x, _ = make(world, redis=r)
    await run(bot, ("goal", t))
    assert x.calls == [] and await rows(world) == []


async def test_retry_then_give_up(world: AsyncEngine, monkeypatch: pytest.MonkeyPatch) -> None:
    waits: list[float] = []

    async def fake_sleep(s: float) -> None:
        waits.append(s)

    monkeypatch.setattr(P.asyncio, "sleep", fake_sleep)
    a, b, c = goal(13), goal(14), goal(15)
    for t in (a, b, c):
        await add_tremor(world, t)
    bot, x, _ = make(world)
    # a: two rate limits, then posts. b: never recovers. c: posts.
    x.fail = [XError(429, "slow"), XError(503, "down")] + [XError(503, "down")] * 50
    bot.start()
    bot.enqueue_goal(a)
    await bot.drain()
    assert [k for k, v in x.calls if k == "post"] == []  # still failing at this point
    await bot.stop()
    assert waits[:3] == [2, 4, 8] and sum(waits) <= P.RETRY_WINDOW_S
    x.fail = [XError(429, "slow")]
    waits.clear()
    await run(bot, ("goal", b), ("goal", c))
    assert waits == [2]
    assert [v["text"] is not None for k, v in x.calls if k == "post"] == [True, True]
    x2 = FakeX()
    x2.fail = [XError(403, "forbidden")]
    bot2 = GoalBot(
        Settings(x_bot_mode="live", **KEYS), FakeRedis(), x2, now=lambda: NOW, engine=world
    )  # type: ignore[arg-type]
    waits.clear()
    await run(bot2, ("goal", goal(16)))
    assert waits == []  # not retryable: given up at once


async def test_restart_does_not_double_post(world: AsyncEngine) -> None:
    t = goal(17)
    await add_tremor(world, t)
    bot, x, _ = make(world)
    await run(bot, ("goal", t))
    again, x2, _ = make(world)
    await run(again, ("goal", t))
    assert x.kinds() == ["upload", "post"] and x2.calls == []


async def test_card_failure_posts_text_only(
    world: AsyncEngine, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(svg: str) -> bytes:
        raise P.CairoUnavailable("no cairo")

    monkeypatch.setattr(P, "render_png", broken)
    t = goal(18)
    await add_tremor(world, t)
    bot, x, r = make(world)
    await run(bot, ("goal", t))
    assert x.kinds() == ["post"] and x.calls[0][1]["media_id"] is None
    assert int(r.kv["aftershock:bot:spend:2026-10"]) == 15


async def test_context_uses_tonight_and_season(world: AsyncEngine) -> None:
    earlier = [goal(20, mag=4.0), goal(21, mag=5.0)]
    for e in earlier:
        await add_tremor(world, e.model_copy(update={"created_at": NOW - timedelta(minutes=5)}))
    # Three bigger goals earlier in the season keep it out of the season's top 3.
    for i, m in enumerate((9.0, 8.5, 8.0)):
        await add_tremor(
            world,
            goal(30 + i, mag=m, night_date=date(2026, 10, 10), created_at=NOW - timedelta(days=13)),
        )
    t = goal(22, mag=6.0)
    await add_tremor(world, t)
    bot, _, _ = make(world, mode="dry_run")
    await run(bot, ("goal", t))
    [row] = [r for r in await rows(world) if r.tremor_id == 22]
    assert "Magnitude 6.0, the biggest goal of the night" in row.text
    big = goal(23, mag=8.7)
    await add_tremor(world, big)
    await run(bot, ("goal", big))
    [row] = [r for r in await rows(world) if r.tremor_id == 23]
    assert "Magnitude 8.7, the 2nd-biggest goal of the season" in row.text
