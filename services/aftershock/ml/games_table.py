"""Per-game summary rows shared by the team-strength and win-probability models.

One row per finished regular-season or playoff game: teams, dates, how it
ended, goals in regulation and after, and expected goals by team (outside the
shootout). Built from the raw cache with a given xG model version.
"""

from __future__ import annotations

import gzip
import json
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any

import polars as pl
import structlog

from aftershock.config import Settings, get_settings
from aftershock.ml.xg import XgModel
from aftershock.ml.xg_features import xg_rows
from aftershock.nhl.parse import FINISHED_STATES, REG_GAME_S, ParsedGame, parse_play_by_play

log = structlog.get_logger(__name__)

_MODEL: XgModel | None = None


def _init(version: str) -> None:
    global _MODEL
    _MODEL = XgModel.load(version=version)


def game_summary(game: ParsedGame, xg: dict[int, float]) -> dict[str, Any]:
    meta = game.meta
    home, away = meta.home.id, meta.away.id
    reg = {home: 0, away: 0}
    ot = {home: 0, away: 0}
    xg_reg = {home: 0.0, away: 0.0}
    xg_all = {home: 0.0, away: 0.0}
    shooter_team: dict[int, int] = {}
    for r in xg_rows(game, include_penalty_shots=True):
        shooter_team[int(r["event_id"])] = int(r["team_id"])
    end_s = REG_GAME_S
    for p in game.plays:
        if p.period_type == "SO":
            continue
        end_s = max(end_s, p.t_game_s)
        team = shooter_team.get(p.event_id)
        if team is not None and p.event_id in xg:
            xg_all[team] += xg[p.event_id]
            if p.period <= 3:
                xg_reg[team] += xg[p.event_id]
        if p.type == "goal" and p.owner_team_id in reg:
            if p.period <= 3:
                reg[p.owner_team_id] += 1
            else:
                ot[p.owner_team_id] += 1
    return {
        "game_id": meta.id,
        "season": meta.season,
        "game_type": meta.game_type,
        "game_date": meta.game_date,
        "start_utc": meta.start_utc,
        "home": meta.home.abbrev,
        "away": meta.away.abbrev,
        "home_score": meta.home.score,
        "away_score": meta.away.score,
        "last_period_type": meta.last_period_type,
        "home_reg_goals": reg[home],
        "away_reg_goals": reg[away],
        "home_ot_goals": ot[home],
        "away_ot_goals": ot[away],
        "home_xg_reg": xg_reg[home],
        "away_xg_reg": xg_reg[away],
        "home_xg": xg_all[home],
        "away_xg": xg_all[away],
        "minutes": max(60.0, end_s / 60.0),
    }


def _summarize(path: str) -> dict[str, Any] | None:
    assert _MODEL is not None
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        game = parse_play_by_play(json.load(fh))
    if game.meta.state not in FINISHED_STATES or game.meta.game_type not in (2, 3):
        return None
    return game_summary(game, _MODEL.game_xg(game))


def build_games_table(xg_version: str, settings: Settings | None = None, workers: int = 6) -> Path:
    s = settings or get_settings()
    files = sorted(str(p) for p in (s.raw_cache_dir / "play-by-play").glob("*.json.gz"))
    rows: list[dict[str, Any]] = []
    with ProcessPoolExecutor(
        max_workers=workers, initializer=_init, initargs=(xg_version,)
    ) as pool:
        for row in pool.map(_summarize, files, chunksize=32):
            if row is not None:
                rows.append(row)
    out = s.data_dir / "features" / f"games_{xg_version}.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    df = pl.DataFrame(rows, infer_schema_length=None).sort(["start_utc", "game_id"])
    df.write_parquet(out)
    log.info("games_table.built", rows=len(df), path=str(out))
    return out


def load_games_table(xg_version: str, settings: Settings | None = None) -> pl.DataFrame:
    s = settings or get_settings()
    return pl.read_parquet(s.data_dir / "features" / f"games_{xg_version}.parquet")
