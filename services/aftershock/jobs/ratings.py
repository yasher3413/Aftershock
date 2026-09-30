"""Compute team ratings and pregame probabilities and store them.

Replays every finished game since 2015-16 through the rating engine. Each
game's pregame row uses only ratings as of that morning. After each day, the
ratings are snapshotted into ``ratings``. Future games of the current season
are predicted from the latest ratings, with back-to-back flags from the
schedule.
"""

from __future__ import annotations

import gzip
import json
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from aftershock.config import Settings, get_settings
from aftershock.db.models import Game, GamePregame, Rating
from aftershock.db.session import session_scope
from aftershock.ml.games_table import game_summary, load_games_table
from aftershock.ml.strength import (
    Pregame,
    RatingEngine,
    StrengthParams,
    records_from_table,
)
from aftershock.ml.strength_fit import MODEL_VERSION, load_params
from aftershock.ml.xg import MODEL_VERSION as XG_VERSION
from aftershock.ml.xg import XgModel
from aftershock.nhl.parse import FINISHED_STATES, parse_play_by_play

log = structlog.get_logger(__name__)


def _missing_summaries(have: set[int], settings: Settings) -> list[dict[str, Any]]:
    """Summaries for finished games cached after the games table was built."""
    rows = []
    model: XgModel | None = None
    for path in sorted((settings.raw_cache_dir / "play-by-play").glob("*.json.gz")):
        gid = int(path.name.split(".")[0])
        if gid in have or str(gid)[4:6] not in ("02", "03"):
            continue
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            game = parse_play_by_play(json.load(fh))
        if game.meta.state not in FINISHED_STATES:
            continue
        model = model or XgModel.load(settings)
        rows.append(game_summary(game, model.game_xg(game)))
    return rows


def all_game_rows(settings: Settings | None = None) -> list[dict[str, Any]]:
    s = settings or get_settings()
    try:
        df = load_games_table(XG_VERSION, s)
        rows = list(df.iter_rows(named=True))
    except FileNotFoundError:
        rows = []
    rows.extend(_missing_summaries({int(r["game_id"]) for r in rows}, s))
    rows.sort(key=lambda r: (r["start_utc"], r["game_id"]))
    return rows


def pregame_row(game_id: int, pre: Pregame) -> dict[str, Any]:
    p = pre.p
    return {
        "game_id": game_id,
        "p_home_reg": p[0],
        "p_home_ot": p[1],
        "p_home_so": p[2],
        "p_away_reg": p[3],
        "p_away_ot": p[4],
        "p_away_so": p[5],
        "exp_home_goals": pre.lam_home,
        "exp_away_goals": pre.lam_away,
        "model_version": MODEL_VERSION,
    }


def replay(
    rows: list[dict[str, Any]], params: StrengthParams
) -> tuple[RatingEngine, list[dict[str, Any]], list[dict[str, Any]]]:
    """(final engine, pregame rows, rating snapshots)."""
    engine = RatingEngine(params=params)
    pregames: list[dict[str, Any]] = []
    snaps: list[dict[str, Any]] = []
    games = records_from_table(rows)
    last_day: date | None = None
    for g in games:
        if last_day is not None and g.day != last_day:
            snaps.extend(_snapshot(engine, last_day))
        engine.start_season(g.season)
        pregames.append(
            pregame_row(g.game_id, engine.predict(g.home, g.away, g.day, playoff=g.game_type == 3))
        )
        engine.update(
            g.home,
            g.away,
            g.day,
            home_goals=g.home_goals,
            away_goals=g.away_goals,
            home_xg=g.home_xg,
            away_xg=g.away_xg,
            minutes=g.minutes,
        )
        last_day = g.day
    if last_day is not None:
        snaps.extend(_snapshot(engine, last_day))
    return engine, pregames, snaps


def _snapshot(engine: RatingEngine, day: date) -> list[dict[str, Any]]:
    # Ratings "as of" the morning after the games of ``day``.
    as_of = day + timedelta(days=1)
    return [
        {
            "as_of_date": as_of,
            "team": t,
            "off": r.off,
            "def_": r.defense,
            "model_version": MODEL_VERSION,
        }
        for t, r in engine.ratings.items()
    ]


def predict_future(engine: RatingEngine, future: list[Game]) -> list[dict[str, Any]]:
    """Pregame rows for unplayed games, flagging back-to-backs from the schedule."""
    played_on: dict[str, set[date]] = defaultdict(set)
    for g in future:
        played_on[g.home].add(g.night_date)
        played_on[g.away].add(g.night_date)
    out = []
    for g in future:
        engine.start_season(g.season)
        for team in (g.home, g.away):
            r = engine.team(team)
            yesterday = g.night_date - timedelta(days=1)
            r.last_game = yesterday if yesterday in played_on[team] else None
        pre = engine.predict(g.home, g.away, g.night_date, playoff=g.game_type == 3)
        out.append(pregame_row(g.id, pre))
    for r in engine.ratings.values():
        r.last_game = None
    return out


async def _upsert(table: Any, rows: list[dict[str, Any]], keys: list[str]) -> None:
    for i in range(0, len(rows), 2000):
        chunk = rows[i : i + 2000]
        async with session_scope() as s:
            stmt = insert(table).values(chunk)
            cols = [c for c in chunk[0] if c not in keys]
            await s.execute(
                stmt.on_conflict_do_update(
                    index_elements=keys, set_={c: stmt.excluded[c] for c in cols}
                )
            )


async def run_ratings(settings: Settings | None = None) -> dict[str, int]:
    s = settings or get_settings()
    params = load_params(s)
    rows = all_game_rows(s)
    engine, pregames, snaps = replay(rows, params)
    done = {r["game_id"] for r in pregames}
    async with session_scope() as sess:
        res = await sess.execute(
            select(Game)
            .where(Game.game_type.in_((2, 3)), Game.state.notin_(FINISHED_STATES))
            .order_by(Game.start_utc, Game.id)
        )
        future = [g for g in res.scalars() if g.id not in done]
    pregames.extend(predict_future(engine, future))
    snap_rows = [{("def" if k == "def_" else k): v for k, v in r.items()} for r in snaps]
    await _upsert(GamePregame, pregames, ["game_id"])
    await _upsert(Rating.__table__, snap_rows, ["as_of_date", "team"])
    log.info(
        "ratings.done",
        games=len(rows),
        pregames=len(pregames),
        snapshots=len(snaps),
        future=len(future),
    )
    return {"games": len(rows), "pregames": len(pregames), "snapshots": len(snaps)}
