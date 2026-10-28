"""What a player is worth to his team, in goals.

Skaters: regularized adjusted plus-minus (RAPM) at five on five. Each stint
gives two rows, one per side attacking: the attackers' offense columns and
the defenders' defense columns are 1, the target is the attacking side's xG
per 60, and the row is weighted by its minutes. A ridge penalty shrinks
players with few minutes toward average. Offense is xG for per 60 the
player adds; defense is xG against per 60 he adds, so a good defender is
negative, the same sign as the team ratings in ``ml/strength.py``.

Finishing (goals above expected per shot) and goalie goals saved above
expected per shot are shrunk toward zero by a prior number of shots.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

import numpy as np
import scipy.sparse as sp
from sklearn.linear_model import Ridge

from aftershock.ml.stints import Stint

MODEL_VERSION = "roster-1.0.0"
ALPHAS = (100.0, 300.0, 1000.0, 3000.0, 10000.0)


@dataclass
class PlayerValue:
    player_id: int
    position: str  # F, D, or G
    off60: float = 0.0
    def60: float = 0.0
    finish_per_shot: float = 0.0
    shots_per60: float = 0.0
    gsax_per_shot: float = 0.0
    ev_toi_pg: float = 0.0  # minutes
    pp_toi_pg: float = 0.0
    games: int = 0
    name: str = ""
    last_team: str | None = None


def _design(stints: list[Stint]) -> tuple[sp.csr_matrix, np.ndarray, np.ndarray, list[int]]:
    players = sorted({p for s in stints for p in (*s.home, *s.away)})
    col = {p: i for i, p in enumerate(players)}
    n = len(players)
    rows: list[int] = []
    cols: list[int] = []
    y = np.empty(2 * len(stints))
    w = np.empty(2 * len(stints))
    for k, s in enumerate(stints):
        minutes = s.dur_s / 60
        for r, (att, dfn, xg) in enumerate(
            ((s.home, s.away, s.home_xg), (s.away, s.home, s.away_xg))
        ):
            i = 2 * k + r
            rows += [i] * 10
            cols += [col[p] for p in att] + [n + col[p] for p in dfn]
            y[i] = xg * 3600 / s.dur_s
            w[i] = minutes
    x = sp.csr_matrix((np.ones(len(rows)), (rows, cols)), shape=(2 * len(stints), 2 * n))
    return x, y, w, players


def fit_rapm(stints: list[Stint], alpha: float) -> dict[int, tuple[float, float]]:
    """Per skater (offense, defense) in xG per 60 at five on five."""
    x, y, w, players = _design(stints)
    model = Ridge(alpha=alpha, solver="sparse_cg", max_iter=5000, tol=1e-6)
    model.fit(x, y, sample_weight=w)
    n = len(players)
    return {p: (float(model.coef_[i]), float(model.coef_[n + i])) for i, p in enumerate(players)}


def choose_alpha(stints: list[Stint], alphas: tuple[float, ...] = ALPHAS, folds: int = 5) -> float:
    """The penalty with the lowest weighted error on held-out games."""
    x, y, w, _ = _design(stints)
    games = np.repeat([s.game_id for s in stints], 2)
    fold = np.searchsorted(np.unique(games), games) % folds
    best, best_err = alphas[0], float("inf")
    for a in alphas:
        err = 0.0
        for f in range(folds):
            tr, te = fold != f, fold == f
            m = Ridge(alpha=a, solver="sparse_cg", max_iter=5000, tol=1e-6)
            m.fit(x[tr], y[tr], sample_weight=w[tr])
            err += float(np.sum(w[te] * (y[te] - m.predict(x[te])) ** 2))
        if err < best_err:
            best, best_err = a, err
    return best


def _shrunk_rate(rows: list[tuple[int, float, bool]], prior: float, sign: int) -> dict[int, float]:
    total: dict[int, float] = defaultdict(float)
    count: dict[int, int] = defaultdict(int)
    for pid, xg, goal in rows:
        total[pid] += sign * (float(goal) - xg)
        count[pid] += 1
    return {p: total[p] / (count[p] + prior) for p in total}


def finishing(shots: list[tuple[int, float, bool]], prior_shots: float = 200.0) -> dict[int, float]:
    """Goals above expected per shot, from (shooter, xg, goal)."""
    return _shrunk_rate(shots, prior_shots, 1)


def goalie_gsax(
    shots_against: list[tuple[int, float, bool]], prior_shots: float = 1500.0
) -> dict[int, float]:
    """Goals saved above expected per shot faced, from (goalie, xg, goal)."""
    return _shrunk_rate(shots_against, prior_shots, -1)
