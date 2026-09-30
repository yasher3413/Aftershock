from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncEngine

from aftershock.db.models import Game, Play, Player, Team, Venue
from aftershock.db.session import session_scope
from aftershock.ingest.load import (
    VenueResolver,
    content_hash,
    player_rows,
    replace_plays,
    seed_reference,
    update_game_states,
    upsert_games,
    upsert_players,
)
from aftershock.nhl.parse import parse_play_by_play, parse_scheduled_game

pytestmark = pytest.mark.db
Fixture = Callable[[str], Any]


def test_content_hash_is_stable_and_order_independent() -> None:
    a = {"eventId": 1, "details": {"x": 1, "y": 2}}
    b = {"details": {"y": 2, "x": 1}, "eventId": 1}
    assert content_hash(a) == content_hash(b)
    assert content_hash(a) != content_hash({"eventId": 1, "details": {"x": 1, "y": 3}})


def test_venue_resolver_falls_back_to_home_arena() -> None:
    r = VenueResolver.from_config()
    assert r.resolve("Veikkaus Arena", "SEA")["country"] == "FI"  # type: ignore[index]
    fallback = r.resolve("Some Unknown Barn", "TOR")
    assert fallback is not None and fallback["name"] == "Scotiabank Arena"


async def test_seed_reference(db_engine: AsyncEngine) -> None:
    async with session_scope(db_engine) as s:
        await seed_reference(s)
        await seed_reference(s)  # idempotent
    async with session_scope(db_engine) as s:
        assert await s.scalar(select(func.count()).select_from(Team)) == 32
        assert (await s.scalar(select(func.count()).select_from(Venue)) or 0) >= 37


async def test_load_games_and_plays(db_engine: AsyncEngine, fixture: Fixture) -> None:
    sched = fixture("schedule_2026-09-30")
    games = [parse_scheduled_game(g) for day in sched["gameWeek"] for g in day["games"]]
    parsed = parse_play_by_play(fixture("pbp_overtime"))
    pbp_game = parse_scheduled_game(
        {
            **fixture("pbp_overtime"),
            "neutralSite": False,
        }
    )
    async with session_scope(db_engine) as s:
        await upsert_games(s, [*games, pbp_game])
        await upsert_games(s, [*games, pbp_game])
        conn = await s.connection()
        n = await replace_plays(conn, [parsed], keep_raw=False)
        n2 = await replace_plays(conn, [parsed], keep_raw=True)
        await update_game_states(s, [parsed.meta])
        await upsert_players(s, player_rows(parsed))
    assert n == n2 == len(parsed.plays)
    async with session_scope(db_engine) as s:
        assert await s.scalar(select(func.count()).select_from(Game)) == len(games) + 1
        count = await s.scalar(
            select(func.count()).select_from(Play).where(Play.game_id == parsed.meta.id)
        )
        assert count == len(parsed.plays)
        goal = (
            await s.execute(
                select(Play).where(Play.game_id == parsed.meta.id, Play.type == "goal").limit(1)
            )
        ).scalar_one()
        assert goal.raw is not None and goal.owner_team in {"FLA", "CAR"} | {
            parsed.meta.home.abbrev,
            parsed.meta.away.abbrev,
        }
        game = await s.get(Game, parsed.meta.id)
        assert game is not None and game.last_period_type == "OT"
        assert game.home_sog is not None
        assert (await s.scalar(select(func.count()).select_from(Player)) or 0) > 30
