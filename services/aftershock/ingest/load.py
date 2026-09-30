"""Load the raw cache into Postgres.

The fetch step (``ingest.fetch``) fills ``data/raw``; this module turns it into
rows. Loading is idempotent: games and players are upserted, and a game's
plays are replaced wholesale, so rerunning a season is safe.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import structlog
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from aftershock.config import Settings, get_settings
from aftershock.db.models import Game, Player, Team, TeamSeason, Venue
from aftershock.nhl.parse import GameMeta, ParsedGame, ScheduledGame, parse_standings

log = structlog.get_logger(__name__)

PLAY_COLUMNS = (
    "game_id",
    "event_id",
    "sort_order",
    "period",
    "period_type",
    "t_period_s",
    "t_game_s",
    "situation_code",
    "type",
    "owner_team",
    "x",
    "y",
    "x_norm",
    "y_norm",
    "zone",
    "shot_type",
    "shooter_id",
    "scorer_id",
    "assist1_id",
    "assist2_id",
    "goalie_id",
    "home_score",
    "away_score",
    "penalty_minutes",
    "raw",
    "content_hash",
    "deleted",
    "first_seen_at",
    "updated_at",
)


def content_hash(raw: dict[str, Any]) -> str:
    """Stable short hash of one play's JSON, used to detect corrections."""
    return hashlib.sha1(json.dumps(raw, sort_keys=True).encode()).hexdigest()[:16]


def load_json_config(settings: Settings, name: str) -> Any:
    return json.loads((settings.config_dir / name).read_text())


@dataclass
class VenueResolver:
    """Maps a venue name to coordinates, falling back to the home arena."""

    venues: dict[str, dict[str, Any]]
    arenas: dict[str, str]
    _warned: set[str]

    @classmethod
    def from_config(cls, settings: Settings | None = None) -> VenueResolver:
        s = settings or get_settings()
        venues = {v["name"]: v for v in load_json_config(s, "venues.json")["venues"]}
        arenas = {t["abbrev"]: t["arena"] for t in load_json_config(s, "teams.json")["teams"]}
        return cls(venues, arenas, set())

    def resolve(self, name: str | None, home: str) -> dict[str, Any] | None:
        if name and name in self.venues:
            return self.venues[name]
        if name and name not in self._warned:
            self._warned.add(name)
            log.warning("venue.unknown", venue=name, home=home, fallback="home arena")
        arena = self.arenas.get(home)
        return self.venues.get(arena) if arena else None


async def seed_reference(session: AsyncSession, settings: Settings | None = None) -> None:
    """Upsert the 32 current teams and every known venue from config."""
    s = settings or get_settings()
    teams = load_json_config(s, "teams.json")["teams"]
    stmt = insert(Team).values(
        [
            {
                k: t[k]
                for k in (
                    "abbrev",
                    "nhl_id",
                    "name",
                    "conference",
                    "division",
                    "arena",
                    "lat",
                    "lon",
                    "color_primary",
                    "color_secondary",
                )
            }
            for t in teams
        ]
    )
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=["abbrev"],
            set_={
                c: stmt.excluded[c]
                for c in (
                    "nhl_id",
                    "name",
                    "conference",
                    "division",
                    "arena",
                    "lat",
                    "lon",
                    "color_primary",
                    "color_secondary",
                )
            },
        )
    )
    venues = load_json_config(s, "venues.json")["venues"]
    vstmt = insert(Venue).values(venues)
    await session.execute(
        vstmt.on_conflict_do_update(
            index_elements=["name"],
            set_={c: vstmt.excluded[c] for c in ("city", "country", "lat", "lon", "home_team")},
        )
    )


async def load_team_seasons(
    session: AsyncSession, season: int, standings_raw: dict[str, Any], ids: dict[str, int]
) -> None:
    rows = parse_standings(standings_raw)
    if not rows:
        return
    stmt = insert(TeamSeason).values(
        [
            {
                "season": season,
                "abbrev": r.team,
                "nhl_id": ids.get(r.team),
                "conference": r.conference,
                "division": r.division,
            }
            for r in rows
        ]
    )
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=["season", "abbrev"],
            set_={
                "conference": stmt.excluded.conference,
                "division": stmt.excluded.division,
                "nhl_id": stmt.excluded.nhl_id,
            },
        )
    )


def _game_row(g: ScheduledGame) -> dict[str, Any]:
    return {
        "id": g.id,
        "season": g.season,
        "game_type": g.game_type,
        "night_date": g.game_date,
        "start_utc": g.start_utc,
        "home": g.home.abbrev,
        "away": g.away.abbrev,
        "venue": g.venue,
        "neutral_site": g.neutral_site,
        "state": g.state,
        "schedule_state": g.schedule_state,
        "home_score": g.home.score,
        "away_score": g.away.score,
        "last_period_type": g.last_period_type,
    }


async def upsert_games(session: AsyncSession, games: Sequence[ScheduledGame]) -> None:
    """Insert or refresh schedule-level fields for many games."""
    for i in range(0, len(games), 500):
        chunk = [_game_row(g) for g in games[i : i + 500]]
        stmt = insert(Game).values(chunk)
        await session.execute(
            stmt.on_conflict_do_update(
                index_elements=["id"],
                set_={
                    c: stmt.excluded[c]
                    for c in (
                        "night_date",
                        "start_utc",
                        "home",
                        "away",
                        "venue",
                        "neutral_site",
                        "state",
                        "schedule_state",
                        "home_score",
                        "away_score",
                        "last_period_type",
                    )
                },
            )
        )


def game_state_values(meta: GameMeta) -> dict[str, Any]:
    """Live-state columns of ``games`` from a play-by-play header."""
    return {
        "state": meta.state,
        "schedule_state": meta.schedule_state,
        "period": meta.period,
        "period_type": meta.period_type,
        "clock_seconds": meta.clock_seconds,
        "in_intermission": meta.in_intermission,
        "home_score": meta.home.score,
        "away_score": meta.away.score,
        "home_sog": meta.home.sog,
        "away_sog": meta.away.sog,
        "last_period_type": meta.last_period_type,
    }


def play_records(parsed: ParsedGame, *, keep_raw: bool) -> list[tuple[Any, ...]]:
    meta = parsed.meta
    abbrev = {meta.home.id: meta.home.abbrev, meta.away.id: meta.away.abbrev}
    now = datetime.now(UTC)
    out: list[tuple[Any, ...]] = []
    for p in parsed.plays:
        out.append(
            (
                meta.id,
                p.event_id,
                p.sort_order,
                p.period,
                p.period_type,
                p.t_period_s,
                p.t_game_s,
                p.situation_code,
                p.type,
                abbrev.get(p.owner_team_id) if p.owner_team_id is not None else None,
                p.x,
                p.y,
                p.x_norm,
                p.y_norm,
                p.zone,
                p.shot_type,
                p.shooter_id,
                p.scorer_id,
                p.assist1_id,
                p.assist2_id,
                p.goalie_id,
                p.home_score,
                p.away_score,
                p.penalty_minutes,
                json.dumps(p.raw) if keep_raw else None,
                content_hash(p.raw),
                False,
                now,
                now,
            )
        )
    return out


async def replace_plays(
    conn: AsyncConnection, games: Iterable[ParsedGame], *, keep_raw: bool
) -> int:
    """Replace all plays of the given games using COPY. Returns rows written."""
    games = list(games)
    if not games:
        return 0
    from aftershock.db.models import Play

    await conn.execute(delete(Play).where(Play.game_id.in_([g.meta.id for g in games])))
    records = [r for g in games for r in play_records(g, keep_raw=keep_raw)]
    raw_conn = await conn.get_raw_connection()
    driver = raw_conn.driver_connection
    assert driver is not None
    await driver.copy_records_to_table("plays", records=records, columns=PLAY_COLUMNS)
    return len(records)


async def update_game_states(session: AsyncSession, metas: Iterable[GameMeta]) -> None:
    for meta in metas:
        game = await session.get(Game, meta.id)
        if game is None:
            continue
        for k, v in game_state_values(meta).items():
            setattr(game, k, v)


def player_rows(parsed: ParsedGame) -> list[dict[str, Any]]:
    meta = parsed.meta
    abbrev = {meta.home.id: meta.home.abbrev, meta.away.id: meta.away.abbrev}
    rows = []
    for pid, r in parsed.roster.items():
        first = (r.get("firstName") or {}).get("default", "")
        last = (r.get("lastName") or {}).get("default", "")
        rows.append(
            {
                "id": pid,
                "name": f"{first} {last}".strip(),
                "position": r.get("positionCode"),
                "shoots_catches": None,
                "current_team": abbrev.get(int(r["teamId"])) if r.get("teamId") else None,
                "sweater": r.get("sweaterNumber"),
            }
        )
    return rows


async def upsert_players(session: AsyncSession, rows: list[dict[str, Any]]) -> None:
    """Upsert players; later rows (later games) win for team and number."""
    latest: dict[int, dict[str, Any]] = {}
    for r in rows:
        latest[r["id"]] = r
    items = list(latest.values())
    for i in range(0, len(items), 1000):
        stmt = insert(Player).values(items[i : i + 1000])
        await session.execute(
            stmt.on_conflict_do_update(
                index_elements=["id"],
                set_={
                    "name": stmt.excluded.name,
                    "position": stmt.excluded.position,
                    "current_team": stmt.excluded.current_team,
                    "sweater": stmt.excluded.sweater,
                },
            )
        )


async def season_game_ids(session: AsyncSession, season: int) -> list[int]:
    res = await session.execute(select(Game.id).where(Game.season == season).order_by(Game.id))
    return list(res.scalars())
