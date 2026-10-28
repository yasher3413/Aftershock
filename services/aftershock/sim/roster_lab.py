"""The Roster Lab's before and after: the season rerun with roster moves.

The moves arrive as rating changes per team over date windows
(``sim/roster.py``). Scoring rates are multiplicative in the ratings
(``ml/strength.py``), so a change scales the rates already in the What-If
bootstrap, which are the forecast's shrunk simulation rates: the change
lands after the usual shrinkage. Each changed game's six-way odds are
recomputed from its new rates, and a change that lasts the rest of the
season also reaches the playoff series odds. Both runs use the What-If
Lab's number of seasons and seed, so the same moves give the same numbers.
"""

from __future__ import annotations

import copy
import math
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from aftershock.ml.strength import StrengthParams, six_way
from aftershock.sim.roster import Window
from aftershock.sim.scenario_card import _run

EASTERN = ZoneInfo("America/New_York")


@dataclass(frozen=True)
class TeamLine:
    team: str
    playoffs_before: float
    playoffs_after: float
    cup_before: float
    cup_after: float
    points_before: float
    points_after: float


@dataclass(frozen=True)
class RosterResult:
    teams: list[TeamLine]  # every team, in the bootstrap's order


def game_date(g: dict[str, Any]) -> date:
    return datetime.fromisoformat(g["start_utc"]).astimezone(EASTERN).date()


def _params(boot: dict[str, Any]) -> StrengthParams:
    return StrengthParams(**boot["params"])


def apply_windows(boot: dict[str, Any], windows: list[Window]) -> dict[str, Any]:
    """A copy of the bootstrap with the windows' changes in its future games
    and, for changes that run to the end, in its playoff odds."""
    out = copy.deepcopy(boot)
    if not windows:
        return out
    params = _params(boot)
    by_team: dict[str, list[Window]] = {}
    for w in windows:
        by_team.setdefault(w.team, []).append(w)

    def delta(team: str, day: date) -> tuple[float, float]:
        for w in by_team.get(team, ()):
            if w.start <= day and (w.end is None or day < w.end):
                return w.d_off, w.d_def
        return 0.0, 0.0

    for g in out["games"]:
        if g["status"] != "future":
            continue
        day = game_date(g)
        ho, hd = delta(g["home"], day)
        ao, ad = delta(g["away"], day)
        if ho == hd == ao == ad == 0.0:
            continue
        lam_h = g["lam"][0] * math.exp(ho + ad)
        lam_a = g["lam"][1] * math.exp(ao + hd)
        g["lam"] = [lam_h, lam_a]
        g["probs"] = list(six_way(lam_h, lam_a, params).p)
    lasting = {w.team: (w.d_off, w.d_def) for w in windows if w.end is None}
    if lasting:
        teams = boot["teams"]
        ratings = {t: tuple(boot["ratings"][t]) for t in teams}
        league = float(boot["league_avg"])
        for i, a in enumerate(teams):
            for j, b in enumerate(teams):
                if i == j or (a not in lasting and b not in lasting):
                    continue
                ao_, ad_ = lasting.get(a, (0.0, 0.0))
                bo_, bd_ = lasting.get(b, (0.0, 0.0))
                lam_h = (
                    league * math.exp(ratings[a][0] + ao_ + ratings[b][1] + bd_) * params.home_ice
                )
                lam_a = league * math.exp(ratings[b][0] + bo_ + ratings[a][1] + ad_)
                out["playoff_p"][i][j] = six_way(lam_h, lam_a, params, playoff=True).p_home_win
    return out


def run_roster_lab(boot: dict[str, Any], windows: list[Window]) -> RosterResult:
    import aftershock_core

    before = _run(aftershock_core, boot, {})
    after = before if not windows else _run(aftershock_core, apply_windows(boot, windows), {})
    return RosterResult(
        teams=[
            TeamLine(
                team=t,
                playoffs_before=float(before["p_playoffs"][i]),
                playoffs_after=float(after["p_playoffs"][i]),
                cup_before=float(before["p_cup"][i]),
                cup_after=float(after["p_cup"][i]),
                points_before=float(before["exp_points"][i]),
                points_after=float(after["exp_points"][i]),
            )
            for i, t in enumerate(boot["teams"])
        ]
    )
