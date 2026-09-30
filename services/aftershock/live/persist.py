"""Write engine effects to Postgres. Persist first, publish second."""

from __future__ import annotations

import json
from typing import Any

import numpy as np
from sqlalchemy import text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from aftershock.db.models import (
    ConditionalTable,
    Game,
    Play,
    RootingGuide,
    ShotXg,
    SimRun,
    TeamOdds,
    Tremor,
    WpTimeline,
)
from aftershock.ingest.load import content_hash, game_state_values
from aftershock.live.diff import ChangedPlay, DiffResult, NewPlay, RemovedPlay
from aftershock.live.engine import OddsSnapshot, TremorRecord
from aftershock.ml.strength import OUTCOMES
from aftershock.ml.xg import MODEL_VERSION as XG_VERSION
from aftershock.nhl.parse import GameMeta
from aftershock.nhl.parse import Play as ParsedPlay
from aftershock.sim.backend import SEED_SLOTS, SimOutput

WP_VERSION = "wp-1.0.0"


async def save_game_state(session: AsyncSession, meta: GameMeta) -> None:
    await session.execute(update(Game).where(Game.id == meta.id).values(**game_state_values(meta)))


def _play_row(game_id: int, p: ParsedPlay, abbrev: dict[int, str]) -> dict[str, Any]:
    return {
        "game_id": game_id,
        "event_id": p.event_id,
        "sort_order": p.sort_order,
        "period": p.period,
        "period_type": p.period_type,
        "t_period_s": p.t_period_s,
        "t_game_s": p.t_game_s,
        "situation_code": p.situation_code,
        "type": p.type,
        "owner_team": abbrev.get(p.owner_team_id) if p.owner_team_id is not None else None,
        "x": p.x,
        "y": p.y,
        "x_norm": p.x_norm,
        "y_norm": p.y_norm,
        "zone": p.zone,
        "shot_type": p.shot_type,
        "shooter_id": p.shooter_id,
        "scorer_id": p.scorer_id,
        "assist1_id": p.assist1_id,
        "assist2_id": p.assist2_id,
        "goalie_id": p.goalie_id,
        "home_score": p.home_score,
        "away_score": p.away_score,
        "penalty_minutes": p.penalty_minutes,
        "raw": p.raw,
        "content_hash": content_hash(p.raw),
        "deleted": False,
    }


async def save_plays(
    session: AsyncSession, diff: DiffResult, normalized: dict[int, ParsedPlay]
) -> None:
    """Insert new plays, update changed ones, and mark removed ones deleted.

    ``normalized`` maps event ids to plays from the fully parsed game, which
    carry normalized coordinates.
    """
    meta = diff.meta
    abbrev = {meta.home.id: meta.home.abbrev, meta.away.id: meta.away.abbrev}
    rows = []
    for c in diff.changes:
        if isinstance(c, NewPlay | ChangedPlay):
            rows.append(_play_row(meta.id, normalized.get(c.play.event_id, c.play), abbrev))
    for i in range(0, len(rows), 500):
        stmt = insert(Play).values(rows[i : i + 500])
        cols = [k for k in rows[0] if k not in ("game_id", "event_id")]
        await session.execute(
            stmt.on_conflict_do_update(
                index_elements=["game_id", "event_id"],
                set_={**{c: stmt.excluded[c] for c in cols}, "updated_at": text("now()")},
            )
        )
    removed = [c.play.event_id for c in diff.changes if isinstance(c, RemovedPlay)]
    if removed:
        await session.execute(
            update(Play)
            .where(Play.game_id == meta.id, Play.event_id.in_(removed))
            .values(deleted=True)
        )


async def save_xg(session: AsyncSession, game_id: int, xg: dict[int, float]) -> None:
    if not xg:
        return
    rows = [
        {"game_id": game_id, "event_id": e, "xg": v, "model_version": XG_VERSION}
        for e, v in xg.items()
    ]
    stmt = insert(ShotXg).values(rows)
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=["game_id", "event_id"], set_={"xg": stmt.excluded.xg}
        )
    )


async def save_wp(
    session: AsyncSession, game_id: int, points: list[tuple[int, int | None, dict[str, float]]]
) -> None:
    for t, event_id, wp in points:
        session.add(
            WpTimeline(
                game_id=game_id,
                t_game_s=t,
                event_id=event_id,
                model_version=WP_VERSION,
                **{f"p_{k}": float(wp[k]) for k in OUTCOMES},
            )
        )


def odds_rows(run_id: int, out: SimOutput) -> list[dict[str, Any]]:
    rows = []
    for i, team in enumerate(out.teams):
        hist = out.points_hist[i]
        nz = np.flatnonzero(hist)
        rows.append(
            {
                "sim_run_id": run_id,
                "team": team,
                **{
                    k: float(out.metrics[k][i])
                    for k in (
                        "p_playoffs",
                        "p_division",
                        "p_top3_div",
                        "p_wildcard",
                        "p_presidents",
                        "p_conf_first",
                        "p_round2",
                        "p_conf_final",
                        "p_final",
                        "p_cup",
                        "p_last",
                        "exp_points",
                    )
                },
                "points_hist": {str(int(x)): int(hist[x]) for x in nz},
                "seed_dist": {
                    slot: float(out.seed_dist[i][j]) for j, slot in enumerate(SEED_SLOTS)
                },
            }
        )
    return rows


async def save_run(
    session: AsyncSession, snap: OddsSnapshot, season: int, *, with_odds: bool = True
) -> int:
    run = SimRun(
        season=season,
        trigger=snap.trigger,
        trigger_ref=snap.trigger_ref,
        n_sims=snap.output.n_sims,
        seed=snap.output.seed,
        state_hash=snap.inputs.state_hash(),
        duration_ms=snap.output.duration_ms,
        as_of=snap.at,
    )
    session.add(run)
    await session.flush()
    if with_odds:
        await session.execute(insert(TeamOdds).values(odds_rows(run.id, snap.output)))
    return int(run.id)


async def save_conditional(
    session: AsyncSession,
    run_id: int,
    out: SimOutput,
    game_ids: list[int],
    stakes: dict[int, float],
    guides: dict[str, list[dict[str, Any]]],
) -> None:
    cond = out.conditional()
    oc = np.asarray(cond["outcome_counts"])
    n = oc.sum(axis=1, keepdims=True)
    pc = np.asarray(cond["playoffs_counts"], dtype=np.float64)
    cc = np.asarray(cond["cup_counts"], dtype=np.float64)
    with np.errstate(invalid="ignore", divide="ignore"):
        p_play = np.where(oc[..., None] > 0, pc / oc[..., None], np.nan)
        p_cup = np.where(oc[..., None] > 0, cc / oc[..., None], np.nan)
    data = {
        "teams": out.teams,
        "games": [
            {
                "game_id": gid,
                "stakes": stakes.get(j, 0.0),
                "p_outcome": (oc[j] / max(int(n[j][0]), 1)).tolist(),
                "p_playoffs": [
                    [None if np.isnan(v) else round(float(v), 5) for v in row] for row in p_play[j]
                ],
                "p_cup": [
                    [None if np.isnan(v) else round(float(v), 5) for v in row] for row in p_cup[j]
                ],
            }
            for j, gid in enumerate(game_ids)
        ],
    }
    session.add(ConditionalTable(sim_run_id=run_id, data=json.loads(json.dumps(data))))
    for team, lines in guides.items():
        session.add(
            RootingGuide(
                sim_run_id=run_id,
                team=team,
                data={"lines": json.loads(json.dumps(lines, default=str))},
            )
        )


def tremor_row(
    rec: TremorRecord,
    run_before: int | None,
    run_after: int | None,
    lat: float | None,
    lon: float | None,
) -> dict[str, Any]:
    c = rec.calc
    return {
        "season": rec.season,
        "game_id": rec.game_id,
        "event_id": rec.event_id,
        "team": rec.team,
        "opponent": rec.opponent,
        "scorer_id": rec.scorer_id,
        "assist1_id": rec.assist1_id,
        "assist2_id": rec.assist2_id,
        "goalie_id": rec.goalie_id,
        "period": rec.period,
        "period_type": rec.period_type,
        "t_period_s": rec.t_period_s,
        "t_game_s": rec.t_game_s,
        "shootout": rec.shootout,
        "score_before": rec.score_before,
        "score_after": rec.score_after,
        "wp_before": rec.wp_before,
        "wp_after": rec.wp_after,
        "deltas": c.deltas,
        "total_shift": c.total_shift,
        "magnitude": c.magnitude,
        "ppa": c.ppa,
        "cpa": c.cpa,
        "origin_venue": rec.venue,
        "origin_lat": lat,
        "origin_lon": lon,
        "sim_run_before": run_before,
        "sim_run_after": run_after,
        "overturned": rec.overturned,
        "night_date": rec.night_date,
        "created_at": rec.at,
    }


async def save_tremor(session: AsyncSession, row: dict[str, Any]) -> int:
    stmt = insert(Tremor).values(row)
    cols = [k for k in row if k not in ("game_id", "event_id", "created_at")]
    res = await session.execute(
        stmt.on_conflict_do_update(
            index_elements=["game_id", "event_id"],
            set_={
                **{c: stmt.excluded[c] for c in cols},
                "overturned": False,
                "updated_at": text("now()"),
            },
        ).returning(Tremor.id)
    )
    return int(res.scalar_one())


async def mark_overturned(session: AsyncSession, tremor_id: int) -> None:
    await session.execute(
        update(Tremor)
        .where(Tremor.id == tremor_id)
        .values(overturned=True, updated_at=text("now()"))
    )


async def update_attribution(
    session: AsyncSession, tremor_id: int, changes: dict[str, Any]
) -> None:
    await session.execute(
        update(Tremor).where(Tremor.id == tremor_id).values(**changes, updated_at=text("now()"))
    )


async def refresh_ppa_view(session: AsyncSession) -> None:
    await session.execute(text("REFRESH MATERIALIZED VIEW CONCURRENTLY player_ppa_season"))
