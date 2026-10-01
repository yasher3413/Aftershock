"""Discipline and defense: penalties, drawn penalties, giveaways, takeaways.

Read from the cached raw play-by-play (the stored plays do not keep the
players involved). Each event is tied to the goal it led to, if any, and to
that goal's Playoff Probability Added for the player's team:

- A power-play goal against a penalized team is charged to the oldest active
  penalty of that team. A minor ends at the first such goal, a double minor
  at the second, and a major runs its full length. Coincidental penalties
  (4 on 4) do not qualify, because the goal's own strength must show a power
  play. The player who drew the penalty is credited with the same goal.
- A giveaway is costly when the other team scores within 10 seconds in the
  same period.

Regular season only, as the NHL defines these stats.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import structlog
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert

from aftershock.db.models import PlayerEvent
from aftershock.db.session import session_scope
from aftershock.nhl.client import NhlClient
from aftershock.nhl.parse import mmss_to_seconds

log = structlog.get_logger(__name__)

GIVEAWAY_WINDOW_S = 10
# Penalty types that put a team short-handed.
SHORT_HANDED = {"MIN", "MAJ", "BEN"}


@dataclass
class Goal:
    event_id: int
    team: str
    period: int
    t_game_s: int
    strength: int  # scoring team skaters minus opponent skaters (pulled goalies removed)


@dataclass
class Penalty:
    event_id: int
    team: str
    t_game_s: int
    minutes: int
    goals_left: float
    row: dict[str, Any]
    drawn: dict[str, Any] | None = None
    goals: list[int] = field(default_factory=list)


def t_game(period: int, mmss: str | None) -> int:
    return (period - 1) * 1200 + mmss_to_seconds(mmss)


def strength(code: str | None, scoring_home: bool) -> int | None:
    """Skater advantage of the scoring team from an NHL situation code (away
    goalie, away skaters, home skaters, home goalie); None if unknown or a
    penalty shot."""
    if not code or len(code) != 4 or not code.isdigit() or code in ("1010", "0101"):
        return None
    ag, ask, hsk, hg = (int(c) for c in code)
    away = ask - (ag == 0)
    home = hsk - (hg == 0)
    return home - away if scoring_home else away - home


def extract(doc: dict[str, Any], season: int) -> tuple[list[dict[str, Any]], list[Goal]]:
    """Player events of one game (without costs) and its goals."""
    home_id = doc["homeTeam"]["id"]
    abbrev = {
        doc["homeTeam"]["id"]: doc["homeTeam"]["abbrev"],
        doc["awayTeam"]["id"]: doc["awayTeam"]["abbrev"],
    }
    gid = int(doc["id"])
    rows: list[dict[str, Any]] = []
    goals: list[Goal] = []
    for p in doc.get("plays", []):
        kind = p.get("typeDescKey")
        pd = p.get("periodDescriptor", {})
        if pd.get("periodType") == "SO":
            continue
        period = int(pd.get("number", 0))
        d = p.get("details", {}) or {}
        owner = d.get("eventOwnerTeamId")
        team = abbrev.get(owner)
        if team is None:
            continue
        base = {
            "game_id": gid,
            "event_id": int(p["eventId"]),
            "season": season,
            "team": team,
            "period": period,
            "t_game_s": t_game(period, p.get("timeInPeriod")),
        }
        if kind == "goal":
            s = strength(p.get("situationCode"), owner == home_id)
            if s is not None:
                goals.append(Goal(base["event_id"], team, period, base["t_game_s"], s))
        elif kind == "penalty":
            # Bench minors are served by a player but charged to the team.
            who = d.get("committedByPlayerId")
            if who:
                rows.append(
                    {
                        **base,
                        "kind": "penalty",
                        "player_id": int(who),
                        "minutes": int(d.get("duration") or 0),
                        "detail": f"{d.get('typeCode', '')}:{d.get('descKey', '')}"[:64],
                    }
                )
            if d.get("drawnByPlayerId"):
                other = next(t for i, t in abbrev.items() if i != owner)
                rows.append(
                    {
                        **base,
                        "kind": "drawn",
                        "player_id": int(d["drawnByPlayerId"]),
                        "team": other,
                        "minutes": int(d.get("duration") or 0),
                        "detail": f"{d.get('typeCode', '')}:{d.get('descKey', '')}"[:64],
                    }
                )
        elif kind in ("giveaway", "takeaway") and d.get("playerId"):
            rows.append({**base, "kind": kind, "player_id": int(d["playerId"])})
    return rows, goals


def attribute(
    rows: list[dict[str, Any]], goals: list[Goal], ppa: dict[tuple[int, str], tuple[int, float]]
) -> None:
    """Fill ``tremor_id`` and ``ppa`` on penalty, drawn, and giveaway rows.

    ``ppa`` maps (event_id, team) to (tremor id, that team's change in playoff
    odds from the goal)."""
    penalties: list[Penalty] = []
    drawn_by_event = {r["event_id"]: r for r in rows if r["kind"] == "drawn"}
    for r in rows:
        if r["kind"] != "penalty":
            continue
        code = (r.get("detail") or "").split(":")[0]
        if code not in SHORT_HANDED or r["minutes"] <= 0:
            continue
        left = float("inf") if r["minutes"] >= 5 else r["minutes"] // 2
        penalties.append(
            Penalty(
                r["event_id"],
                r["team"],
                r["t_game_s"],
                r["minutes"],
                left,
                r,
                drawn_by_event.get(r["event_id"]),
            )
        )
    for g in sorted(goals, key=lambda g: g.t_game_s):
        if g.strength <= 0:
            continue
        active = [
            p
            for p in penalties
            if p.team != g.team
            and p.goals_left > 0
            and p.t_game_s < g.t_game_s <= p.t_game_s + p.minutes * 60
        ]
        if not active:
            continue
        pen = min(active, key=lambda p: (p.t_game_s, p.event_id))
        pen.goals_left -= 1
        hit = ppa.get((g.event_id, pen.team))
        if hit is None:
            continue
        tid, d_pen = hit
        r = pen.row
        r["tremor_id"] = r.get("tremor_id") or tid
        r["ppa"] = (r.get("ppa") or 0.0) + d_pen
        if pen.drawn is not None:
            got = ppa.get((g.event_id, pen.drawn["team"]))
            if got is not None:
                pen.drawn["tremor_id"] = pen.drawn.get("tremor_id") or got[0]
                pen.drawn["ppa"] = (pen.drawn.get("ppa") or 0.0) + got[1]
    for r in rows:
        if r["kind"] != "giveaway":
            continue
        scored = next(
            (
                g
                for g in goals
                if g.team != r["team"]
                and g.period == r["period"]
                and r["t_game_s"] <= g.t_game_s <= r["t_game_s"] + GIVEAWAY_WINDOW_S
            ),
            None,
        )
        if scored is not None and (hit := ppa.get((scored.event_id, r["team"]))) is not None:
            r["tremor_id"], r["ppa"] = hit


async def run_discipline(season: int, *, refresh_views: bool = True) -> dict[str, int]:
    async with session_scope() as s:
        games = [
            int(g)
            for (g,) in (
                await s.execute(
                    text(
                        "SELECT id FROM games WHERE season = :s AND game_type = 2 "
                        "AND state IN ('FINAL', 'OFF') ORDER BY id"
                    ),
                    {"s": season},
                )
            ).all()
        ]
        done = {
            int(g)
            for (g,) in (
                await s.execute(
                    text("SELECT DISTINCT game_id FROM player_events WHERE season = :s"),
                    {"s": season},
                )
            ).all()
        }
    stats = {"games": 0, "rows": 0, "missing": 0}
    async with NhlClient() as client:
        for gid in games:
            if gid in done:
                continue
            doc = client.read_cache("play-by-play", str(gid))
            if doc is None:
                doc = await client.play_by_play(gid)
            if doc is None:
                stats["missing"] += 1
                continue
            rows, goals = extract(doc, season)
            async with session_scope() as s:
                ppa = {
                    (int(e), team): (int(tid), float(v))
                    for tid, e, team, v in (
                        await s.execute(
                            text(
                                "SELECT t.id, t.event_id, d.key, (d.value ->> 'd_playoffs')::float "
                                "FROM tremors t, jsonb_each(t.deltas) d "
                                "WHERE t.game_id = :g AND NOT t.overturned"
                            ),
                            {"g": gid},
                        )
                    ).all()
                }
                attribute(rows, goals, ppa)
                if rows:
                    stmt = insert(PlayerEvent).values(
                        [
                            {"tremor_id": None, "ppa": None, "minutes": None, "detail": None, **r}
                            for r in rows
                        ]
                    )
                    await s.execute(
                        stmt.on_conflict_do_update(
                            index_elements=["game_id", "event_id", "kind"],
                            set_={
                                c: stmt.excluded[c]
                                for c in (
                                    "player_id",
                                    "team",
                                    "minutes",
                                    "detail",
                                    "tremor_id",
                                    "ppa",
                                )
                            },
                        )
                    )
            stats["games"] += 1
            stats["rows"] += len(rows)
            if stats["games"] % 200 == 0:
                log.info("discipline.progress", season=season, games=stats["games"])
    if refresh_views:
        async with session_scope() as s:
            await s.execute(text("REFRESH MATERIALIZED VIEW player_discipline_season"))
            await s.execute(text("REFRESH MATERIALIZED VIEW player_plus_minus"))
    log.info("discipline.done", season=season, **stats)
    return stats


STABILITY_SQL = {
    "penalty_minutes": (
        "SELECT player_id, game_id, coalesce(minutes, 0) FROM player_events "
        "WHERE season = :s AND kind = 'penalty'"
    ),
    "penalties_drawn": (
        "SELECT player_id, game_id, 1 FROM player_events WHERE season = :s AND kind = 'drawn'"
    ),
    "penalty_ppa": (
        "SELECT player_id, game_id, coalesce(ppa, 0) FROM player_events "
        "WHERE season = :s AND kind = 'penalty'"
    ),
    "giveaways": (
        "SELECT player_id, game_id, 1 FROM player_events WHERE season = :s AND kind = 'giveaway'"
    ),
    "costly_giveaway_ppa": (
        "SELECT player_id, game_id, coalesce(ppa, 0) FROM player_events "
        "WHERE season = :s AND kind = 'giveaway'"
    ),
    "takeaways": (
        "SELECT player_id, game_id, 1 FROM player_events WHERE season = :s AND kind = 'takeaway'"
    ),
    "ppa_plus_minus": (
        "SELECT o.player_id, t.game_id, (t.deltas -> o.team ->> 'd_playoffs')::float "
        "FROM tremor_on_ice o JOIN tremors t ON t.id = o.tremor_id "
        "JOIN games g ON g.id = t.game_id "
        "WHERE t.season = :s AND g.game_type = 2 AND NOT t.overturned AND NOT t.shootout"
    ),
}


async def stability(season: int, min_games: int = 40) -> dict[str, dict[str, float]]:
    """Split-half reliability: each stat summed over a player's odd-numbered
    games against his even-numbered games (by game id order within the team's
    schedule), correlated across players with at least ``min_games`` games of
    on-ice data. High means the stat describes the player; near zero, luck."""
    import numpy as np

    async with session_scope() as s:
        played = (
            await s.execute(
                text(
                    "SELECT DISTINCT o.player_id, t.game_id FROM tremor_on_ice o "
                    "JOIN tremors t ON t.id = o.tremor_id JOIN games g ON g.id = t.game_id "
                    "WHERE t.season = :s AND g.game_type = 2"
                ),
                {"s": season},
            )
        ).all()
        games: dict[int, list[int]] = {}
        for p, g in played:
            games.setdefault(int(p), []).append(int(g))
        half = {
            p: {g: i % 2 for i, g in enumerate(sorted(gs))}
            for p, gs in games.items()
            if len(gs) >= min_games
        }
        out: dict[str, dict[str, float]] = {}
        for name, sql in STABILITY_SQL.items():
            sums: dict[int, list[float]] = {p: [0.0, 0.0] for p in half}
            for p, g, v in (await s.execute(text(sql), {"s": season})).all():
                h = half.get(int(p), {}).get(int(g))
                if h is not None:
                    sums[int(p)][h] += float(v or 0)
            a = np.array([v[0] for v in sums.values()])
            b = np.array([v[1] for v in sums.values()])
            r = float(np.corrcoef(a, b)[0, 1]) if a.std() > 0 and b.std() > 0 else 0.0
            out[name] = {"split_half_r": round(r, 3), "players": len(sums)}
    return out
