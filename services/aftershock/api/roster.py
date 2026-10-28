"""The Roster Lab's api helpers: which moves are allowed, what each player
is worth over the rest of the season, and which players a result comes from.

Only players dressing lately can be traded or taken out (the team ratings
already reflect anyone who is out), only free agents can be signed, and one
run moves players between at most two teams.
"""

from __future__ import annotations

import math
from datetime import date, datetime
from typing import Any

from aftershock.ml.player_value import PlayerValue
from aftershock.sim.roster import (
    VALUE_SCALE,
    Injury,
    Move,
    Sign,
    Spot,
    Trade,
    Window,
    check_shape,
    team_deltas,
    team_goals,
)
from aftershock.sim.roster_lab import EASTERN, game_date

MAX_TEAMS = 2
RATE_LIMIT = 30  # saved moves per address per window
RATE_WINDOW_S = 600


def today() -> date:
    return datetime.now(EASTERN).date()


def validate(
    moves: list[Move], rosters: dict[str, list[Spot]], values: dict[int, PlayerValue]
) -> str | None:
    """Why the moves cannot run, in words, or None."""
    spot = {s.player_id: s for spots in rosters.values() for s in spots}
    teams: set[str] = set()

    def name(pid: int) -> str:
        return values[pid].name if pid in values else f"Player {pid}"

    for mv in moves:
        s = spot.get(mv.player_id)
        if isinstance(mv, Sign):
            if mv.to not in rosters:
                return f"There is no team {mv.to}."
            if s is not None:
                return f"{name(mv.player_id)} is on {s.team}; trade for him instead."
            if mv.player_id not in values:
                return f"{name(mv.player_id)} has not played in the NHL since 2024-25."
            teams.add(mv.to)
            continue
        if s is None:
            return f"{name(mv.player_id)} is not on an NHL roster."
        if not s.in_lineup:
            return (
                f"{name(mv.player_id)} has not been playing lately, so moving him changes nothing."
            )
        teams.add(s.team)
        if isinstance(mv, Trade):
            if mv.to not in rosters:
                return f"There is no team {mv.to}."
            if mv.to == s.team:
                return f"{name(mv.player_id)} is already on {s.team}."
            teams.add(mv.to)
    if len(teams) > MAX_TEAMS:
        return "The Roster Lab moves players between two teams at a time."
    return check_shape(rosters, moves)


def future_games(boot: dict[str, Any]) -> dict[str, list[date]]:
    """Each team's remaining game dates."""
    out: dict[str, list[date]] = {t: [] for t in boot["teams"]}
    for g in boot["games"]:
        if g["status"] == "future":
            d = game_date(g)
            out[g["home"]].append(d)
            out[g["away"]].append(d)
    return out


def _goals(w: Window, league_avg: float, dates: list[date]) -> float:
    """Goal difference a window adds over the games inside it."""
    n = sum(1 for d in dates if w.start <= d and (w.end is None or d < w.end))
    return n * league_avg * ((math.exp(w.d_off) - 1) - (math.exp(w.d_def) - 1))


def worth(
    team: str,
    rosters: dict[str, list[Spot]],
    values: dict[int, PlayerValue],
    games_left: int,
) -> dict[int, float]:
    """Each dressing player's goal difference for his team over its
    remaining games: the team with him less the team without him."""
    lineup = [s for s in rosters[team] if s.in_lineup]
    gf, ga = team_goals(lineup, lineup, values)
    out: dict[int, float] = {}
    for s in lineup:
        rest = [x for x in lineup if x.player_id != s.player_id]
        gf2, ga2 = team_goals(rest, lineup, values)
        out[s.player_id] = games_left * ((gf - ga) - (gf2 - ga2))
    return out


def free_agent_worth(v: PlayerValue, games_left: float) -> float:
    """A free agent's goal difference over a typical team's remaining games
    at his usual minutes."""
    per_game = (v.off60 - v.def60) * v.ev_toi_pg / 60 + v.finish_per_shot * v.shots_per60 * (
        v.ev_toi_pg + v.pp_toi_pg
    ) / 60
    if v.position == "G":
        per_game = v.gsax_per_shot * 40.0 * 0.5
    return VALUE_SCALE * games_left * per_game


def why(
    moves: list[Move],
    rosters: dict[str, list[Spot]],
    values: dict[int, PlayerValue],
    league_avg: float,
    day: date,
    games: dict[str, list[date]],
) -> dict[str, list[dict[str, Any]]]:
    """For each team a result changes, each move's goal difference for it
    over the rest of the season, largest first."""
    out: dict[str, list[dict[str, Any]]] = {}
    for mv in moves:
        for w in team_deltas([mv], rosters, values, league_avg, day):
            g = _goals(w, league_avg, games.get(w.team, []))
            name = values[mv.player_id].name if mv.player_id in values else str(mv.player_id)
            kind = (
                "injury" if isinstance(mv, Injury) else "sign" if isinstance(mv, Sign) else "trade"
            )
            out.setdefault(w.team, []).append(
                {"player_id": mv.player_id, "name": name, "move": kind, "goals": round(g, 2)}
            )
    for rows in out.values():
        rows.sort(key=lambda r: -abs(r["goals"]))
    return out


def describe(
    moves: list[Move], rosters: dict[str, list[Spot]], values: dict[int, PlayerValue]
) -> list[dict[str, Any]]:
    """The moves in words-ready form, in canonical order."""
    team = {s.player_id: s.team for spots in rosters.values() for s in spots}
    out = []
    for mv in moves:
        out.append(
            {
                "player_id": mv.player_id,
                "name": values[mv.player_id].name if mv.player_id in values else str(mv.player_id),
                "move": "injury"
                if isinstance(mv, Injury)
                else "sign"
                if isinstance(mv, Sign)
                else "trade",
                "from_team": team.get(mv.player_id),
                "to_team": None if isinstance(mv, Injury) else mv.to,
                "weeks": mv.weeks if isinstance(mv, Injury) else None,
            }
        )
    return out


def headline(moves: list[dict[str, Any]]) -> str:
    """ "TOR gets Quinn Hughes, VAN gets Matthew Knies" for trades and
    signings; injuries read "Auston Matthews out 4 weeks"."""
    gets: dict[str, list[str]] = {}
    out: list[str] = []
    for m in moves:
        if m["move"] == "injury":
            length = (
                "for the season"
                if m["weeks"] is None
                else f"{m['weeks']} week{'s' if m['weeks'] != 1 else ''}"
            )
            out.append(f"{m['name']} out {length}")
        else:
            gets.setdefault(m["to_team"], []).append(m["name"])
    parts = [f"{t} gets {' and '.join(names)}" for t, names in gets.items()]
    return ", ".join(parts + out)
