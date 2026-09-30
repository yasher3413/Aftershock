from __future__ import annotations

from datetime import date

import numpy as np
import pytest

from aftershock.ml.strength import (
    RatingEngine,
    StrengthParams,
    poisson_pmf,
    scoreline_table,
    six_way,
)


def test_poisson_pmf_sums_to_one() -> None:
    for lam in (0.5, 2.9, 6.0):
        p = poisson_pmf(lam)
        assert p.sum() == pytest.approx(1.0)
        assert (p >= 0).all()


def test_tie_inflation_raises_tie_probability() -> None:
    base = np.trace(scoreline_table(3.0, 2.8, 1.0))
    inflated = np.trace(scoreline_table(3.0, 2.8, 1.3))
    assert inflated > base
    assert scoreline_table(3.0, 2.8, 1.3).sum() == pytest.approx(1.0)


def test_six_way_is_a_distribution() -> None:
    params = StrengthParams()
    pre = six_way(3.1, 2.7, params)
    assert sum(pre.p) == pytest.approx(1.0)
    assert all(v >= 0 for v in pre.p)
    assert pre.p_home_win > 0.5


def test_playoff_has_no_shootout() -> None:
    pre = six_way(3.0, 3.0, StrengthParams(), playoff=True)
    assert pre.p[2] == 0 and pre.p[5] == 0
    assert sum(pre.p) == pytest.approx(1.0)


def test_equal_teams_home_ice_favors_home() -> None:
    engine = RatingEngine(StrengthParams(home_ice=1.05))
    assert engine.predict("AAA", "BBB", None).p_home_win > 0.5
    engine = RatingEngine(StrengthParams(home_ice=1.0, p_home_so=0.5))
    assert engine.predict("AAA", "BBB", None).p_home_win == pytest.approx(0.5)


def test_ratings_move_toward_performance_and_stay_centered() -> None:
    engine = RatingEngine(StrengthParams(home_ice=1.0))
    engine.start_season(20252026)
    for i in range(20):
        engine.update(
            "AAA",
            "BBB",
            date(2025, 10, 1 + i),
            home_goals=5,
            away_goals=1,
            home_xg=4.0,
            away_xg=1.5,
            minutes=60,
        )
    a, b = engine.team("AAA"), engine.team("BBB")
    assert a.off > 0 > b.off
    assert a.defense < 0 < b.defense
    assert a.off + b.off == pytest.approx(0.0, abs=1e-12)
    assert engine.predict("AAA", "BBB", None).p_home_win > 0.7


def test_back_to_back_lowers_expected_goals() -> None:
    engine = RatingEngine(StrengthParams(fatigue=0.05))
    engine.start_season(20252026)
    engine.update(
        "AAA",
        "CCC",
        date(2025, 10, 1),
        home_goals=3,
        away_goals=3,
        home_xg=3,
        away_xg=3,
        minutes=65,
    )
    rested = RatingEngine(StrengthParams(fatigue=0.05))
    rested.ratings = {k: type(v)(v.off, v.defense, None) for k, v in engine.ratings.items()}
    lam_tired, _ = engine.expected_goals("AAA", "BBB", date(2025, 10, 2))
    lam_rested, _ = rested.expected_goals("AAA", "BBB", date(2025, 10, 2))
    assert lam_tired < lam_rested


def test_new_season_regresses_ratings() -> None:
    engine = RatingEngine(StrengthParams(regress=0.4))
    engine.start_season(20242025)
    engine.team("AAA").off = 0.2
    engine.start_season(20252026)
    assert engine.team("AAA").off == pytest.approx(0.12)


def test_reliability_handles_constant_predictions() -> None:
    import math

    from aftershock.ml.metrics import reliability

    rel = reliability(np.array([0.0, 1.0, 1.0]), np.array([0.5, 0.5, 0.5]))
    assert not math.isnan(rel["ece"])
    assert rel["ece"] == pytest.approx(abs(0.5 - 2 / 3))
