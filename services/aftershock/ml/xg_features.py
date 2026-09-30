"""Expected-goals features for unblocked shot attempts.

One row per unblocked shot attempt (shot on goal, missed shot, goal), taken
outside the shootout and not a penalty shot, with located coordinates. All
geometry is in the shooting team's frame: the target net is at (89, 0).

No shooter or goalie identity is used.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from aftershock.nhl.parse import SHOT_TYPES, ParsedGame, Play, home_attack_signs

NET_X = 89.0
PENALTY_SHOT_CODES = frozenset({"1010", "0101"})
REBOUND_WINDOW_S = 3
RUSH_WINDOW_S = 4
NEUTRAL_OR_DEFENSIVE_MAX_X = 25.0

SHOT_TYPE_LEVELS = (
    "wrist",
    "snap",
    "slap",
    "backhand",
    "tip-in",
    "deflected",
    "wrap-around",
    "poke",
    "bat",
    "between-legs",
    "cradle",
    "other",
)
PREV_TYPE_LEVELS = (
    "faceoff",
    "hit",
    "giveaway",
    "takeaway",
    "shot-on-goal",
    "missed-shot",
    "blocked-shot",
    "goal",
    "penalty",
    "delayed-penalty",
    "stoppage",
    "period-start",
    "other",
)
MANPOWER_LEVELS = (
    "5v5",
    "5v4",
    "4v5",
    "5v3",
    "3v5",
    "4v4",
    "3v3",
    "4v3",
    "3v4",
    "6v5",
    "6v4",
    "5v6",
    "4v6",
    "6v3",
    "other",
)

FEATURES = (
    "distance",
    "angle",
    "shot_type",
    "rebound",
    "rush",
    "since_prev_s",
    "dist_from_prev",
    "prev_type",
    "prev_same_team",
    "manpower",
    "own_skaters",
    "opp_skaters",
    "empty_net_against",
    "score_state",
    "period",
    "is_home",
)
CATEGORICAL = ("shot_type", "prev_type", "manpower")


def shot_distance_angle(x: float, y: float) -> tuple[float, float]:
    """Distance (ft) and angle (degrees) to the net at (89, 0).

    The angle is measured from the goal line's normal, so a shot from straight
    in front is 0 and shots from behind the goal line exceed 90.
    """
    dx = NET_X - x
    return math.hypot(dx, y), math.degrees(math.atan2(abs(y), dx))


def attempt_team(p: Play, home_id: int, away_id: int) -> int | None:
    """Team that took a shot attempt. Blocked shots are owned by the blocker,
    except ``teammate-blocked`` ones, which are owned by the shooting team."""
    if p.owner_team_id is None:
        return None
    if p.type == "blocked-shot" and p.reason != "teammate-blocked":
        return away_id if p.owner_team_id == home_id else home_id
    return p.owner_team_id


def is_penalty_shot(p: Play) -> bool:
    return p.situation_code in PENALTY_SHOT_CODES and p.period_type != "SO"


def _level(value: str | None, levels: tuple[str, ...]) -> str:
    return value if value in levels else "other"


@dataclass(slots=True)
class _Frame:
    """Converts raw rink coordinates into a given team's attacking frame."""

    signs: dict[int, int]
    home_id: int

    def xy(self, p: Play, team_id: int) -> tuple[float, float] | None:
        if p.x is None or p.y is None:
            return None
        s = self.signs.get(p.period, 1)
        if team_id != self.home_id:
            s = -s
        return p.x * s, p.y * s


def xg_rows(game: ParsedGame, *, include_penalty_shots: bool = False) -> list[dict[str, Any]]:
    """Feature rows for every eligible unblocked attempt in a game."""
    meta = game.meta
    home_id, away_id = meta.home.id, meta.away.id
    frame = _Frame(home_attack_signs(game.plays, home_id), home_id)
    rows: list[dict[str, Any]] = []
    home_goals = away_goals = 0
    attempts: list[tuple[int, int, int]] = []  # (period, t_game_s, team)
    prev: Play | None = None
    for p in game.plays:
        if p.period_type == "SO":
            break
        if prev is not None and prev.period != p.period:
            prev = None
        team = attempt_team(p, home_id, away_id)
        if p.type in SHOT_TYPES and team is not None:
            loc = frame.xy(p, team)
            ps = is_penalty_shot(p)
            if loc is not None and (include_penalty_shots or not ps):
                x, y = loc
                dist, ang = shot_distance_angle(x, y)
                is_home = team == home_id
                sit = p.situation
                own_sk, opp_sk, _, opp_goalie = (
                    sit.for_team(is_home) if sit is not None else (5, 5, True, True)
                )
                diff = (home_goals - away_goals) * (1 if is_home else -1)
                rebound = any(
                    per == p.period and tm == team and 0 <= p.t_game_s - t <= REBOUND_WINDOW_S
                    for per, t, tm in attempts[-6:]
                )
                since_prev = float(p.t_game_s - prev.t_game_s) if prev is not None else math.nan
                prev_loc = frame.xy(prev, team) if prev is not None else None
                dist_prev = math.hypot(x - prev_loc[0], y - prev_loc[1]) if prev_loc else math.nan
                rush = (
                    prev is not None
                    and prev_loc is not None
                    and since_prev <= RUSH_WINDOW_S
                    and prev_loc[0] < NEUTRAL_OR_DEFENSIVE_MAX_X
                )
                rows.append(
                    {
                        "game_id": meta.id,
                        "event_id": p.event_id,
                        "season": meta.season,
                        "game_type": meta.game_type,
                        "t_game_s": p.t_game_s,
                        "team_id": team,
                        "is_goal": int(p.type == "goal"),
                        "penalty_shot": int(ps),
                        "x": x,
                        "y": y,
                        "distance": dist,
                        "angle": ang,
                        "shot_type": _level(p.shot_type, SHOT_TYPE_LEVELS),
                        "rebound": int(rebound),
                        "rush": int(rush),
                        "since_prev_s": since_prev,
                        "dist_from_prev": dist_prev,
                        "prev_type": _level(prev.type if prev else None, PREV_TYPE_LEVELS),
                        "prev_same_team": int(
                            prev is not None and prev.owner_team_id == p.owner_team_id
                        ),
                        "manpower": _level(f"{own_sk}v{opp_sk}", MANPOWER_LEVELS),
                        "own_skaters": own_sk,
                        "opp_skaters": opp_sk,
                        "empty_net_against": int(not opp_goalie),
                        "score_state": max(-3, min(3, diff)),
                        "period": min(p.period, 4),
                        "is_home": int(is_home),
                    }
                )
        if (p.type in SHOT_TYPES or p.type == "blocked-shot") and team is not None:
            attempts.append((p.period, p.t_game_s, team))
        if p.type == "goal" and p.home_score is not None and p.away_score is not None:
            home_goals, away_goals = p.home_score, p.away_score
        prev = p
    return rows


def rows_for_games(games: Iterable[ParsedGame]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for g in games:
        out.extend(xg_rows(g))
    return out
