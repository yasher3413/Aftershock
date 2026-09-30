"""Smoke tests for the Rust simulator bindings (module ``aftershock_core``).

Build first: ``uv run maturin develop --release -m ../crates/aftershock-py/Cargo.toml``.
"""

from __future__ import annotations

import gzip
import json
from typing import Any

import numpy as np
import pytest

from aftershock.config import REPO_ROOT

core = pytest.importorskip("aftershock_core")

GOLD = REPO_ROOT / "tests" / "fixtures" / "gold"
END_CODES = {"REG": 0, "OT": 1, "SO": 2}


def load_gold(season: int) -> dict[str, Any]:
    with gzip.open(GOLD / f"{season}.json.gz", "rt", encoding="utf-8") as fh:
        return json.load(fh)


def season_arrays(config: str, season: int) -> dict[str, np.ndarray]:
    data = load_gold(season)
    teams = core.config_teams(config)
    idx = {t: i for i, t in enumerate(teams)}
    games = sorted(data["results"], key=lambda r: (r["date"], r["id"]))
    return {
        "home": np.array([idx[g["home"]] for g in games], dtype=np.uint16),
        "away": np.array([idx[g["away"]] for g in games], dtype=np.uint16),
        "home_goals": np.array([g["home_goals"] for g in games], dtype=np.uint8),
        "away_goals": np.array([g["away_goals"] for g in games], dtype=np.uint8),
        "end": np.array([END_CODES[g["end"]] for g in games], dtype=np.uint8),
        "official": data["official"],
        "teams": teams,
    }


def scenario(n_final: int = 1000) -> tuple[Any, dict[str, Any]]:
    """2025-26 schedule: the first ``n_final`` games final, the rest future."""
    a = season_arrays("nhl-2025-26", 20252026)
    n = len(a["home"])
    t = len(a["teams"])
    sim = core.Simulator("nhl-2025-26", a["home"], a["away"])
    status = np.zeros(n, dtype=np.uint8)
    status[:n_final] = 2
    probs = np.tile(np.array([0.40, 0.07, 0.04, 0.37, 0.07, 0.05], dtype=np.float32), (n, 1))
    lam = np.tile(np.array([3.1, 2.9], dtype=np.float32), (n, 1))
    playoff_p = np.full((t, t), 0.55, dtype=np.float32)
    focus = np.arange(n_final, n_final + 20, dtype=np.uint32)
    args = {
        "status": status,
        "home_goals": a["home_goals"],
        "away_goals": a["away_goals"],
        "end": a["end"],
        "live_home": np.zeros(n, dtype=np.uint8),
        "live_away": np.zeros(n, dtype=np.uint8),
        "probs": probs,
        "lam": lam,
        "playoff_p": playoff_p,
        "tie_theta": 1.2,
        "n_sims": 2000,
        "seed": 42,
        "focus": focus,
    }
    return sim, args


def test_run_shapes_and_probabilities() -> None:
    sim, args = scenario()
    res = sim.run(**args)
    t = len(sim.teams)
    assert res.n_sims == 2000
    assert res.duration_ms > 0
    metrics = res.metrics
    assert set(metrics) == {*core.METRICS, "exp_points"}
    for name, v in metrics.items():
        assert v.shape == (t,) and v.dtype == np.float64
        if name != "exp_points":
            assert np.all((v >= 0) & (v <= 1)), name
    assert metrics["p_cup"].sum() == pytest.approx(1.0)
    assert metrics["p_playoffs"].sum() == pytest.approx(16.0)
    assert metrics["p_division"].sum() == pytest.approx(4.0)
    assert res.points_hist.shape == (t, 2 * 82 + 1)
    assert res.points_hist.dtype == np.int64
    assert np.all(res.points_hist.sum(axis=1) == 2000)
    assert res.seed_dist.shape == (t, 6)
    np.testing.assert_allclose(res.seed_dist.sum(axis=1), 1.0)
    np.testing.assert_allclose(1.0 - res.seed_dist[:, 5], metrics["p_playoffs"])


def test_deterministic_for_fixed_seed() -> None:
    sim, args = scenario()
    a = sim.run(**args)
    b = sim.run(**args)
    for name in a.metrics:
        np.testing.assert_array_equal(a.metrics[name], b.metrics[name])
    np.testing.assert_array_equal(a.focus_outcomes, b.focus_outcomes)
    c = sim.run(**{**args, "seed": 43})
    assert not np.array_equal(a.focus_outcomes, c.focus_outcomes)


def test_team_sigma_keyword() -> None:
    sim, args = scenario()
    default = sim.run(**args)
    zero = sim.run(**args, team_sigma=0.0)
    for name in default.metrics:
        np.testing.assert_array_equal(default.metrics[name], zero.metrics[name])
    noisy = sim.run(**args, team_sigma=0.3)
    assert noisy.metrics["p_cup"].sum() == pytest.approx(1.0)
    assert noisy.metrics["p_playoffs"].sum() == pytest.approx(16.0)
    assert not np.array_equal(default.metrics["p_playoffs"], noisy.metrics["p_playoffs"])
    with pytest.raises(ValueError):
        sim.run(**args, team_sigma=-1.0)


def test_conditional_and_reweight() -> None:
    sim, args = scenario()
    res = sim.run(**args)
    t = len(sim.teams)
    cond = res.conditional()
    assert cond["outcome_counts"].shape == (20, 6)
    assert cond["playoffs_counts"].shape == (20, 6, t)
    assert cond["cup_counts"].shape == (20, 6, t)
    assert np.all(cond["outcome_counts"].sum(axis=1) == 2000)
    np.testing.assert_array_equal(cond["cup_counts"].sum(axis=2), cond["outcome_counts"])
    # Reweighting with the sampling probabilities changes nothing.
    same = res.reweight(np.array([0], dtype=np.uint32), args["probs"][1000:1001])
    np.testing.assert_allclose(same["p_playoffs"], res.metrics["p_playoffs"], atol=1e-12)
    assert same["ess"] == pytest.approx(2000.0)
    # Forcing a home regulation win matches the conditional table.
    forced = np.array([[1, 0, 0, 0, 0, 0]], dtype=np.float32)
    rw = res.reweight(np.array([0], dtype=np.uint32), forced)
    k0 = cond["outcome_counts"][0, 0]
    np.testing.assert_allclose(rw["p_playoffs"], cond["playoffs_counts"][0, 0] / k0, atol=1e-12)
    assert rw["ess"] == pytest.approx(k0)


def test_standings_match_gold_2025_26() -> None:
    a = season_arrays("nhl-2025-26", 20252026)
    s = core.standings(
        "nhl-2025-26", a["home"], a["away"], a["home_goals"], a["away_goals"], a["end"]
    )
    idx = {t: i for i, t in enumerate(a["teams"])}
    for o in a["official"]:
        i = idx[o["abbrev"]]
        assert s["points"][i] == o["points"], o["abbrev"]
        assert s["division_rank"][i] == o["division_seq"], o["abbrev"]
        assert s["league_rank"][i] == o["league_seq"], o["abbrev"]
    assert int(s["qualified"].sum()) == 16


def test_bad_input_raises() -> None:
    sim, args = scenario()
    with pytest.raises(ValueError):
        sim.run(**{**args, "probs": args["probs"][:10]})
