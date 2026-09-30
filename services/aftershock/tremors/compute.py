"""Tremors, magnitude, PPA, stakes, and rooting guides (section 11 of the brief)."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np

from aftershock.config import Settings, get_settings
from aftershock.ml.strength import OUTCOMES
from aftershock.sim.backend import SimBackend, SimOutput
from aftershock.sim.inputs import SimInputs

HOME_WIN = (0, 1, 2)
AWAY_WIN = (3, 4, 5)
MAGNITUDE_FILE = "magnitude-1.0.0.json"


@dataclass(frozen=True)
class MagnitudeScale:
    """M = clamp(a + b * log10(1 + 10000 * S), 0, 10), S = total shift."""

    a: float = 0.0
    b: float = 2.0

    def __call__(self, total_shift: float) -> float:
        m = self.a + self.b * math.log10(1.0 + 10000.0 * max(total_shift, 0.0))
        return float(min(10.0, max(0.0, m)))


def magnitude_scale(settings: Settings | None = None) -> MagnitudeScale:
    s = settings or get_settings()
    return _load_scale(str(s.ml_dir / "artifacts" / MAGNITUDE_FILE))


@lru_cache(maxsize=4)
def _load_scale(path: str) -> MagnitudeScale:
    p = Path(path)
    if p.exists():
        data = json.loads(p.read_text())
        return MagnitudeScale(float(data["a"]), float(data["b"]))
    return MagnitudeScale()


@dataclass
class TremorCalc:
    deltas: dict[str, dict[str, float]]
    total_shift: float
    magnitude: float
    ppa: float
    cpa: float
    before: SimOutput
    after: SimOutput


def deltas_between(before: SimOutput, after: SimOutput) -> dict[str, dict[str, float]]:
    out = {}
    for i, team in enumerate(after.teams):
        out[team] = {
            "d_playoffs": float(after.metrics["p_playoffs"][i] - before.metrics["p_playoffs"][i]),
            "d_division": float(after.metrics["p_division"][i] - before.metrics["p_division"][i]),
            "d_cup": float(after.metrics["p_cup"][i] - before.metrics["p_cup"][i]),
            "p_playoffs_after": float(after.metrics["p_playoffs"][i]),
        }
    return out


def compute_tremor(
    backend: SimBackend,
    before_inputs: SimInputs,
    after_inputs: SimInputs,
    *,
    n_sims: int,
    seed: int,
    scoring_team: str,
    playoffs: bool = False,
    scale: MagnitudeScale | None = None,
) -> TremorCalc:
    """Run the before/after pair with the same seed and measure the goal's effect.

    Because every draw is keyed by (seed, sim, game, stream), the two runs see
    identical randomness everywhere except where the goal changed the scoring
    game's probabilities, so the difference is the goal alone.
    """
    before = backend.run(before_inputs, n_sims, seed)
    after = backend.run(after_inputs, n_sims, seed)
    d = deltas_between(before, after)
    shift = float(sum(abs(v["d_playoffs"]) for v in d.values()))
    if playoffs:
        # In the playoffs, playoff odds are settled; the shift is on Cup odds.
        shift = float(sum(abs(v["d_cup"]) for v in d.values()))
    mag = (scale or magnitude_scale())(shift)
    own = d.get(scoring_team, {"d_playoffs": 0.0, "d_cup": 0.0})
    return TremorCalc(
        deltas=d,
        total_shift=shift,
        magnitude=mag,
        ppa=0.0 if playoffs else own["d_playoffs"],
        cpa=own["d_cup"],
        before=before,
        after=after,
    )


def outcome_probs(inputs: SimInputs, focus_pos: int) -> np.ndarray:
    return np.asarray(inputs.probs[int(inputs.focus[focus_pos])], dtype=np.float64)


def stakes(sim: SimOutput) -> dict[int, float]:
    """Leverage of each focus game, keyed by focus position.

    L = sum over teams and outcomes k of P(k) * |P(team makes playoffs | k) -
    P(team makes playoffs)|, with P(k) and the conditionals from simulation.
    """
    cond = sim.conditional()
    oc = np.asarray(cond["outcome_counts"], dtype=np.float64)
    pc = np.asarray(cond["playoffs_counts"], dtype=np.float64)
    base = sim.metrics["p_playoffs"]
    out: dict[int, float] = {}
    for j in range(oc.shape[0]):
        n = oc[j].sum()
        if n == 0:
            out[j] = 0.0
            continue
        total = 0.0
        for k in range(6):
            if oc[j, k] == 0:
                continue
            p_k = oc[j, k] / n
            total += p_k * float(np.abs(pc[j, k] / oc[j, k] - base).sum())
        out[j] = total
    return out


def rooting_guide(
    sim: SimOutput,
    team: str,
    games: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Rooting lines for ``team`` over the focus games.

    ``games`` holds one dict per focus position with keys game_id, start_utc,
    home, away. A line is kept only when the home-versus-away difference is
    larger than two standard errors of its Monte Carlo estimate.
    """
    cond = sim.conditional()
    oc = np.asarray(cond["outcome_counts"], dtype=np.float64)
    pc = np.asarray(cond["playoffs_counts"], dtype=np.float64)
    t = sim.teams.index(team)
    lines = []
    for j, g in enumerate(games):
        n_h = oc[j, list(HOME_WIN)].sum()
        n_a = oc[j, list(AWAY_WIN)].sum()
        if n_h == 0 or n_a == 0:
            continue
        p_h = pc[j, list(HOME_WIN), t].sum() / n_h
        p_a = pc[j, list(AWAY_WIN), t].sum() / n_a
        diff = float(p_h - p_a)
        se = math.sqrt(p_h * (1 - p_h) / n_h + p_a * (1 - p_a) / n_a)
        if abs(diff) <= 2 * se:
            continue
        per_k = {OUTCOMES[k]: pc[j, k, t] / oc[j, k] for k in range(6) if oc[j, k] > 0}
        best = max(per_k, key=lambda k: per_k[k])
        worst = min(per_k, key=lambda k: per_k[k])
        lines.append(
            {
                "game_id": g["game_id"],
                "start_utc": g["start_utc"],
                "home": g["home"],
                "away": g["away"],
                "involves_team": team in (g["home"], g["away"]),
                "impact": diff,
                "stderr": se,
                "root_for": g["home"] if diff > 0 else g["away"],
                "best_outcome": best,
                "best_outcome_p": float(per_k[best]),
                "worst_outcome": worst,
                "worst_outcome_p": float(per_k[worst]),
            }
        )
    lines.sort(key=lambda r: (r["involves_team"], -abs(r["impact"])))
    return lines
