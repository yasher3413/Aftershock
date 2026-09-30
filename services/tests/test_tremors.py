from __future__ import annotations

from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from aftershock.sim.backend import StubBackend
from aftershock.sim.inputs import STATUS_FUTURE, SeasonSchedule, SimInputs
from aftershock.tremors.compute import (
    MagnitudeScale,
    compute_tremor,
    rooting_guide,
    stakes,
)

TEAMS = [f"T{i:02d}" for i in range(20)]
CONF = {t: ("E" if i < 10 else "W") for i, t in enumerate(TEAMS)}


def make_inputs(n_rounds: int = 6) -> SimInputs:
    pairs = []
    rng = np.random.default_rng(0)
    for _ in range(n_rounds):
        order = rng.permutation(len(TEAMS))
        pairs.extend((int(order[i]), int(order[i + 1])) for i in range(0, len(TEAMS), 2))
    n = len(pairs)
    start = datetime(2026, 10, 1, tzinfo=UTC)
    sch = SeasonSchedule(
        season=20262027,
        config="test",
        teams=TEAMS,
        game_ids=np.arange(1, n + 1, dtype=np.int64),
        home=np.array([p[0] for p in pairs], dtype=np.uint16),
        away=np.array([p[1] for p in pairs], dtype=np.uint16),
        start_utc=[start + timedelta(hours=i) for i in range(n)],
    )
    probs = np.tile(np.array([0.39, 0.06, 0.04, 0.37, 0.08, 0.06], dtype=np.float32), (n, 1))
    return SimInputs(
        schedule=sch,
        status=np.full(n, STATUS_FUTURE, dtype=np.uint8),
        home_goals=np.zeros(n, dtype=np.uint8),
        away_goals=np.zeros(n, dtype=np.uint8),
        end=np.zeros(n, dtype=np.uint8),
        live_home=np.zeros(n, dtype=np.uint8),
        live_away=np.zeros(n, dtype=np.uint8),
        probs=probs,
        lam=np.tile(np.array([3.0, 2.8], dtype=np.float32), (n, 1)),
        playoff_p=np.full((20, 20), 0.5, dtype=np.float32),
        tie_theta=1.2,
        focus=np.arange(0, 8, dtype=np.uint32),
    )


def test_magnitude_scale() -> None:
    m = MagnitudeScale(a=0.5, b=2.0)
    assert m(0.0) == 0.5
    assert m(1e9) == 10.0
    assert m(0.02) > m(0.002)


def test_identical_inputs_give_exactly_zero_deltas() -> None:
    backend = StubBackend(CONF)
    inp = make_inputs()
    calc = compute_tremor(backend, inp, inp.copy(), n_sims=2000, seed=7, scoring_team="T00")
    assert all(v["d_playoffs"] == 0 for v in calc.deltas.values())
    assert calc.total_shift == 0


def test_goal_isolation_moves_only_through_the_scoring_game() -> None:
    backend = StubBackend(CONF)
    before = make_inputs()
    after = before.copy()
    g = 3
    home = TEAMS[int(before.schedule.home[g])]
    after.probs[g] = [0.9, 0.03, 0.02, 0.03, 0.01, 0.01]
    calc = compute_tremor(backend, before, after, n_sims=4000, seed=11, scoring_team=home)
    assert calc.ppa > 0
    assert calc.ppa == calc.deltas[home]["d_playoffs"]
    # Conservation: the playoff field has fixed size, so the shift nets to zero.
    assert sum(v["d_playoffs"] for v in calc.deltas.values()) == pytest.approx(0, abs=1e-9)
    assert calc.total_shift > 0
    # With common random numbers, only sims where game g's outcome flipped differ.
    b = backend.run(before, 4000, 11)
    a = backend.run(after, 4000, 11)
    assert np.array_equal(b.metrics["p_playoffs"], calc.before.metrics["p_playoffs"])
    assert np.array_equal(a.metrics["p_playoffs"], calc.after.metrics["p_playoffs"])


def test_stakes_and_rooting_guide() -> None:
    backend = StubBackend(CONF)
    inp = make_inputs(n_rounds=4)
    sim = backend.run(inp, 6000, 3)
    lev = stakes(sim)
    assert set(lev) == set(range(len(inp.focus)))
    assert all(v >= 0 for v in lev.values())
    g0 = int(inp.focus[0])
    team = TEAMS[int(inp.schedule.home[g0])]
    games = [
        {
            "game_id": int(inp.schedule.game_ids[g]),
            "start_utc": inp.schedule.start_utc[g],
            "home": TEAMS[int(inp.schedule.home[g])],
            "away": TEAMS[int(inp.schedule.away[g])],
        }
        for g in inp.focus
    ]
    lines = rooting_guide(sim, team, games)
    own = [line for line in lines if line["involves_team"]]
    assert own and own[0]["root_for"] == team and own[0]["impact"] > 0
    assert all(abs(line["impact"]) > 2 * line["stderr"] for line in lines)
    # Games involving the team are listed after the others.
    flags = [line["involves_team"] for line in lines]
    assert flags == sorted(flags)


def test_reweighting_recovers_the_full_rerun() -> None:
    backend = StubBackend(CONF)
    inp = make_inputs()
    base = backend.run(inp, 20000, 5)
    new = np.array([[0.6, 0.05, 0.03, 0.22, 0.05, 0.05]], dtype=np.float32)
    rw = base.reweight(np.array([0], dtype=np.uint32), new)
    changed = inp.copy()
    changed.probs[int(inp.focus[0])] = new[0]
    rerun = backend.run(changed, 20000, 5)
    assert np.abs(rw["p_playoffs"] - rerun.metrics["p_playoffs"]).max() < 0.02
    assert 0.3 * 20000 < rw["ess"] <= 20000
