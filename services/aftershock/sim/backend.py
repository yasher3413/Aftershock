"""Simulator backends.

``RustBackend`` wraps the ``aftershock_core`` extension (the real
simulator). ``StubBackend`` is a small numpy Monte Carlo with the same
interface and common random numbers, used by tests that exercise the tremor
pipeline without the compiled extension. The stub ignores tiebreakers and
divisions: playoffs are the top eight per conference by points.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

import numpy as np
from numpy.typing import NDArray

from aftershock.sim.inputs import STATUS_FINAL, SeasonSchedule, SimInputs

METRICS = (
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
    "p_bottom3",
    "exp_points",
)
SEED_SLOTS = ("div1", "div2", "div3", "wc1", "wc2", "out")


@dataclass
class SimOutput:
    teams: list[str]
    metrics: dict[str, NDArray[np.float64]]
    points_hist: NDArray[np.int64]
    seed_dist: NDArray[np.float64]
    duration_ms: float
    n_sims: int
    seed: int
    focus: NDArray[np.uint32]
    _conditional: Callable[[], dict[str, Any]]
    _reweight: Callable[[NDArray[np.uint32], NDArray[np.float32]], dict[str, Any]]

    def conditional(self) -> dict[str, Any]:
        """Counts: outcome_counts [f,6], playoffs_counts [f,6,t], cup_counts [f,6,t]."""
        return self._conditional()

    def reweight(self, games: NDArray[np.uint32], new_probs: NDArray[np.float32]) -> dict[str, Any]:
        """Importance-reweighted p_playoffs, p_division, p_cup and the effective sample size.

        ``games`` are positions within ``focus``.
        """
        return self._reweight(games, new_probs)

    def team_metric(self, name: str) -> dict[str, float]:
        return {t: float(v) for t, v in zip(self.teams, self.metrics[name], strict=True)}


class SimBackend(Protocol):
    def run(self, inputs: SimInputs, n_sims: int, seed: int) -> SimOutput: ...


# ----------------------------------------------------------------------
# Rust


class RustBackend:
    def __init__(self) -> None:
        import aftershock_core  # compiled extension, built with `make native`

        self._core = aftershock_core
        self._sims: dict[tuple[str, int, int], Any] = {}

    def _simulator(self, sch: SeasonSchedule) -> Any:
        key = (sch.config, sch.n, int(sch.game_ids.sum()))
        if key not in self._sims:
            self._sims[key] = self._core.Simulator(sch.config, sch.home, sch.away)
        return self._sims[key]

    def run(self, inputs: SimInputs, n_sims: int, seed: int) -> SimOutput:
        sim = self._simulator(inputs.schedule)
        res = sim.run(
            inputs.status,
            inputs.home_goals,
            inputs.away_goals,
            inputs.end,
            inputs.live_home,
            inputs.live_away,
            inputs.probs,
            inputs.lam,
            inputs.playoff_p,
            float(inputs.tie_theta),
            int(n_sims),
            int(seed),
            inputs.focus,
        )
        return SimOutput(
            teams=inputs.schedule.teams,
            metrics={k: np.asarray(v, dtype=np.float64) for k, v in res.metrics.items()},
            points_hist=np.asarray(res.points_hist, dtype=np.int64),
            seed_dist=np.asarray(res.seed_dist, dtype=np.float64),
            duration_ms=float(res.duration_ms),
            n_sims=n_sims,
            seed=seed,
            focus=inputs.focus,
            _conditional=res.conditional,
            _reweight=res.reweight,
        )


def default_backend() -> SimBackend:
    return RustBackend()


# ----------------------------------------------------------------------
# Stub


def _uniforms(seed: int, n_sims: int, n_games: int, stream: int) -> NDArray[np.float64]:
    """Counter-style uniforms: a pure function of (seed, sim, game, stream)."""
    sims = np.arange(n_sims, dtype=np.uint64)[:, None]
    games = np.arange(n_games, dtype=np.uint64)[None, :]
    with np.errstate(over="ignore"):
        z = (
            np.uint64(seed) * np.uint64(0x9E3779B97F4A7C15)
            + sims * np.uint64(0xBF58476D1CE4E5B9)
            + games * np.uint64(0x94D049BB133111EB)
            + np.uint64(stream) * np.uint64(0xD6E8FEB86659FD93)
        )
        z = (z ^ (z >> np.uint64(30))) * np.uint64(0xBF58476D1CE4E5B9)
        z = (z ^ (z >> np.uint64(27))) * np.uint64(0x94D049BB133111EB)
        z = z ^ (z >> np.uint64(31))
    return (z >> np.uint64(11)).astype(np.float64) / float(1 << 53)


class StubBackend:
    def __init__(self, conferences: dict[str, str] | None = None) -> None:
        self.conferences = conferences or {}

    def run(self, inputs: SimInputs, n_sims: int, seed: int) -> SimOutput:
        started = time.perf_counter()
        sch = inputs.schedule
        t = len(sch.teams)
        n = sch.n
        u = _uniforms(seed, n_sims, n, 1)
        cum = np.cumsum(inputs.probs.astype(np.float64), axis=1)
        cum[:, -1] = 1.0
        outcome = np.empty((n_sims, n), dtype=np.int8)
        for g in range(n):
            if inputs.status[g] == STATUS_FINAL:
                home_won = inputs.home_goals[g] > inputs.away_goals[g]
                code = int(inputs.end[g])
                k = {0: 0, 1: 1, 2: 2, 3: 0}[code] if home_won else {0: 3, 1: 4, 2: 5, 3: 3}[code]
                outcome[:, g] = k
            else:
                outcome[:, g] = np.searchsorted(cum[g], u[:, g], side="right")
        home_pts = np.choose(np.clip(outcome, 0, 5), [2, 2, 2, 0, 1, 1])
        away_pts = np.choose(np.clip(outcome, 0, 5), [0, 1, 1, 2, 2, 2])
        points = np.zeros((n_sims, t), dtype=np.int64)
        for g in range(n):
            points[:, sch.home[g]] += home_pts[:, g]
            points[:, sch.away[g]] += away_pts[:, g]
        # Break ties by a fixed team order so the stub stays deterministic.
        score = points * 1000 - np.arange(t)[None, :]
        confs = sorted({self.conferences.get(team, "all") for team in sch.teams})
        playoffs = np.zeros((n_sims, t), dtype=bool)
        for c in confs:
            members = np.array(
                [i for i, team in enumerate(sch.teams) if self.conferences.get(team, "all") == c]
            )
            k = min(8, len(members))
            order = np.argsort(-score[:, members], axis=1)[:, :k]
            playoffs[np.arange(n_sims)[:, None], members[order]] = True
        best = np.argmax(score, axis=1)
        # Champion: a uniformly random playoff team, from its own random stream.
        pick = _uniforms(seed, n_sims, 1, 2)[:, 0]
        counts = playoffs.sum(axis=1)
        nth = np.minimum((pick * counts).astype(int), counts - 1)
        champion = np.array([np.flatnonzero(playoffs[s])[nth[s]] for s in range(n_sims)])
        cup = np.zeros((n_sims, t), dtype=bool)
        cup[np.arange(n_sims), champion] = True
        pres = np.zeros((n_sims, t), dtype=bool)
        pres[np.arange(n_sims), best] = True
        metrics = {name: np.zeros(t) for name in METRICS}
        metrics["p_playoffs"] = playoffs.mean(axis=0)
        metrics["p_cup"] = cup.mean(axis=0)
        metrics["p_presidents"] = pres.mean(axis=0)
        metrics["exp_points"] = points.mean(axis=0).astype(np.float64)
        max_pts = int(points.max()) + 1
        hist = np.zeros((t, max_pts), dtype=np.int64)
        for i in range(t):
            hist[i] = np.bincount(points[:, i], minlength=max_pts)
        focus = inputs.focus
        focus_out = outcome[:, focus] if len(focus) else np.zeros((n_sims, 0), dtype=np.int8)
        base_probs = inputs.probs[focus].astype(np.float64) if len(focus) else np.zeros((0, 6))

        def conditional() -> dict[str, Any]:
            f = len(focus)
            oc = np.zeros((f, 6), dtype=np.int64)
            pc = np.zeros((f, 6, t), dtype=np.int64)
            cc = np.zeros((f, 6, t), dtype=np.int64)
            for j in range(f):
                for k in range(6):
                    m = focus_out[:, j] == k
                    oc[j, k] = int(m.sum())
                    pc[j, k] = playoffs[m].sum(axis=0)
                    cc[j, k] = cup[m].sum(axis=0)
            return {"outcome_counts": oc, "playoffs_counts": pc, "cup_counts": cc}

        def reweight(games: NDArray[np.uint32], new_probs: NDArray[np.float32]) -> dict[str, Any]:
            w = np.ones(n_sims)
            for j, g in enumerate(games):
                k = focus_out[:, g].astype(int)
                w *= new_probs[j][k] / np.maximum(base_probs[g][k], 1e-12)
            ws = w.sum()
            return {
                "p_playoffs": (w[:, None] * playoffs).sum(axis=0) / ws,
                "p_division": np.zeros(t),
                "p_cup": (w[:, None] * cup).sum(axis=0) / ws,
                "ess": float(ws**2 / (w**2).sum()),
            }

        return SimOutput(
            teams=sch.teams,
            metrics=metrics,
            points_hist=hist,
            seed_dist=np.zeros((t, 6)),
            duration_ms=(time.perf_counter() - started) * 1000,
            n_sims=n_sims,
            seed=seed,
            focus=focus,
            _conditional=conditional,
            _reweight=reweight,
        )
