"""On-ice Playoff Probability Added from NHL shift charts.

Every skater on the ice for a goal shares in it: skaters of the scoring team
are credited with their team's change in playoff odds, and skaters of the
team scored on are charged with theirs. Goalies are excluded. A skater is on
the ice when a shift in that period starts before the goal and ends at or
after it.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

import structlog
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert

from aftershock.db.models import Player, Tremor, TremorOnIce
from aftershock.db.session import session_scope
from aftershock.nhl.client import NhlClient
from aftershock.nhl.parse import mmss_to_seconds

log = structlog.get_logger(__name__)
SHIFT = 517


def on_ice(
    shifts: list[dict[str, Any]], period: int, t_period_s: int, goalies: set[int]
) -> dict[str, set[int]]:
    """Skaters on the ice per team at a moment."""
    out: dict[str, set[int]] = defaultdict(set)
    for s in shifts:
        if s.get("typeCode") != SHIFT or s.get("period") != period:
            continue
        pid = int(s["playerId"])
        if pid in goalies:
            continue
        start = mmss_to_seconds(s.get("startTime"))
        end = mmss_to_seconds(s.get("endTime"))
        if start < t_period_s <= end:
            out[str(s["teamAbbrev"])].add(pid)
    return out


async def run_on_ice(season: int) -> dict[str, int]:
    async with session_scope() as s:
        done = {
            r[0]
            for r in (
                await s.execute(
                    text(
                        "SELECT DISTINCT t.game_id FROM tremor_on_ice o "
                        "JOIN tremors t ON t.id = o.tremor_id "
                        "WHERE t.season = :s"
                    ),
                    {"s": season},
                )
            ).all()
        }
        tremors = list(
            (
                await s.execute(
                    select(Tremor).where(Tremor.season == season, Tremor.shootout.is_(False))
                )
            ).scalars()
        )
        goalies = {
            int(r[0])
            for r in (await s.execute(select(Player.id).where(Player.position == "G"))).all()
        }
    by_game: dict[int, list[Tremor]] = defaultdict(list)
    for t in tremors:
        if t.game_id not in done:
            by_game[t.game_id].append(t)
    rows = 0
    async with NhlClient() as client:
        for i, (gid, ts) in enumerate(sorted(by_game.items())):
            body = await client.shiftcharts(gid)
            shifts = body.get("data", [])
            batch = []
            for t in ts:
                ice = on_ice(shifts, t.period, t.t_period_s, goalies | {t.goalie_id or 0})
                for team, players in ice.items():
                    batch += [
                        {"tremor_id": t.id, "player_id": p, "team": team, "scored": team == t.team}
                        for p in players
                    ]
            if batch:
                async with session_scope() as s:
                    await s.execute(insert(TremorOnIce).values(batch).on_conflict_do_nothing())
                rows += len(batch)
            if i % 100 == 0:
                log.info("onice.progress", season=season, games=i, total=len(by_game))
    async with session_scope() as s:
        await s.execute(text("REFRESH MATERIALIZED VIEW player_onice_ppa"))
    return {"games": len(by_game), "rows": rows}
