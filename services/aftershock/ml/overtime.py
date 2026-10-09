"""Overtime and shootout probabilities for live games.

Regular-season overtime is 5 minutes of 3-on-3 sudden death. Goals arrive as
competing exponential clocks: the home team scores at rate ``q * r`` and the
away team at ``(1 - q) * r`` per second, where ``r`` is the measured 3-on-3
goal rate and ``q`` is the home share from team strength. Whatever
probability is left when the clock runs out goes to the shootout.

Playoff overtime is 20-minute 5-on-5 periods until someone scores, so the
home team wins with probability ``q`` regardless of the clock.

The shootout is an exact dynamic program over the remaining rounds (3 rounds,
then sudden-death rounds) using the measured per-attempt conversion rate. A
team clinches as soon as the other cannot catch up in the remaining rounds.
"""

from __future__ import annotations

import math
from functools import lru_cache

SHOOTOUT_ROUNDS = 3


def overtime_probs(
    secs_left: float, q_home: float, rate_per_s: float, *, playoff: bool = False
) -> tuple[float, float, float]:
    """(P home wins in OT, P away wins in OT, P shootout) from this moment."""
    if playoff:
        return q_home, 1.0 - q_home, 0.0
    secs_left = max(0.0, secs_left)
    p_goal = 1.0 - math.exp(-rate_per_s * secs_left)
    return q_home * p_goal, (1.0 - q_home) * p_goal, 1.0 - p_goal


def rate_from_so_share(p_so_given_ot: float, ot_seconds: float = 300.0) -> float:
    """3-on-3 goal rate implied by the share of overtimes that reach a shootout."""
    return -math.log(max(min(p_so_given_ot, 0.999999), 1e-9)) / ot_seconds


def shootout_home_win_prob(
    home_goals: int,
    away_goals: int,
    home_attempts: int,
    away_attempts: int,
    *,
    home_shoots_first: bool,
    p_home: float,
    p_away: float | None = None,
) -> float:
    """P(home wins the shootout) from a mid-shootout state.

    Attempts alternate starting with the team that shoots first. The state
    must be reachable: the first shooter has taken the same number of
    attempts as the other team, or one more.
    """
    pa = p_home if p_away is None else p_away
    first_n, second_n = (
        (home_attempts, away_attempts) if home_shoots_first else (away_attempts, home_attempts)
    )
    if not (first_n == second_n or first_n == second_n + 1):
        raise ValueError("unreachable shootout state")
    fg, sg = (home_goals, away_goals) if home_shoots_first else (away_goals, home_goals)
    pf, ps = (p_home, pa) if home_shoots_first else (pa, p_home)
    p_first_wins = _first_wins(fg, sg, first_n, second_n, round(pf, 9), round(ps, 9))
    return p_first_wins if home_shoots_first else 1.0 - p_first_wins


def feed_shootout_home_win_prob(
    home_goals: int,
    away_goals: int,
    home_attempts: int,
    away_attempts: int,
    *,
    home_shoots_first: bool,
    p_home: float,
    p_away: float | None = None,
) -> float | None:
    """``shootout_home_win_prob`` for counts read from the live feed, which can
    list the first two attempts in the wrong order. If the counts are
    impossible with ``home_shoots_first``, the other team shot first. None if
    they are impossible either way."""
    for first in (home_shoots_first, not home_shoots_first):
        try:
            return shootout_home_win_prob(
                home_goals,
                away_goals,
                home_attempts,
                away_attempts,
                home_shoots_first=first,
                p_home=p_home,
                p_away=p_away,
            )
        except ValueError:
            continue
    return None


@lru_cache(maxsize=4096)
def _first_wins(fg: int, sg: int, fn: int, sn: int, pf: float, ps: float) -> float:
    """P(first shooter wins) from a state, by recursion over the next attempt."""
    if fn <= SHOOTOUT_ROUNDS and sn <= SHOOTOUT_ROUNDS:
        # Clinch checks during the first three rounds.
        f_left = SHOOTOUT_ROUNDS - fn
        s_left = SHOOTOUT_ROUNDS - sn
        if fg > sg + s_left:
            return 1.0
        if sg > fg + f_left:
            return 0.0
    if fn == sn and fn >= SHOOTOUT_ROUNDS:
        # A round is complete at or after round 3.
        if fg != sg:
            return 1.0 if fg > sg else 0.0
        # Tied: sudden death, closed form over whole rounds.
        win = pf * (1 - ps)
        lose = ps * (1 - pf)
        return win / (win + lose) if win + lose > 0 else 0.5
    if fn == sn:
        return pf * _first_wins(fg + 1, sg, fn + 1, sn, pf, ps) + (1 - pf) * _first_wins(
            fg, sg, fn + 1, sn, pf, ps
        )
    return ps * _first_wins(fg, sg + 1, fn, sn + 1, pf, ps) + (1 - ps) * _first_wins(
        fg, sg, fn, sn + 1, pf, ps
    )
