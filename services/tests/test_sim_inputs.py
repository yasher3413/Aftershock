from __future__ import annotations

from datetime import UTC, datetime

import numpy as np

from aftershock.ml.strength import RatingEngine, StrengthParams
from aftershock.sim.backtest import shrunk
from aftershock.sim.inputs import STATUS_FINAL, SeasonSchedule, fill_future


def test_future_games_use_the_shrunk_simulation_ratings() -> None:
    engine = RatingEngine(params=StrengthParams())
    strong, weak = engine.team("CAR"), engine.team("TOR")
    strong.off, strong.defense = 0.3, -0.3
    weak.off, weak.defense = -0.3, 0.3
    sch = SeasonSchedule(
        season=20262027,
        config="test",
        teams=["CAR", "TOR"],
        game_ids=np.array([1, 2], dtype=np.int64),
        home=np.array([0, 0], dtype=np.uint16),
        away=np.array([1, 1], dtype=np.uint16),
        start_utc=[datetime(2026, 10, 1, tzinfo=UTC)] * 2,
    )
    status = np.array([STATUS_FINAL, 0], dtype=np.uint8)
    probs = np.zeros((2, 6), np.float32)
    lam = np.zeros((2, 2), np.float32)

    fill_future(sch, status, shrunk(engine, 0.5), probs, lam)

    assert probs[0].sum() == 0.0  # finals are left alone
    full = engine.predict("CAR", "TOR", None)
    half = shrunk(engine, 0.5).predict("CAR", "TOR", None)
    assert np.allclose(probs[1], half.p, atol=1e-6)
    assert 0.5 < half.p_home_win < full.p_home_win
