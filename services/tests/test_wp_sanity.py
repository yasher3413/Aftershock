"""Sanity properties the win-probability model must satisfy (brief section 8.3)."""

from __future__ import annotations

import pytest

from aftershock.ml.strength import StrengthParams, six_way
from aftershock.ml.wp import WinProbModel
from aftershock.ml.wp_features import GameState
from aftershock.nhl.parse import Situation

EVEN = Situation(True, 5, 5, True)


@pytest.fixture(scope="module")
def model() -> WinProbModel:
    return WinProbModel.load()


@pytest.fixture(scope="module")
def pregame() -> object:
    return six_way(3.1, 2.9, StrengthParams(tie_theta=1.5))


def state(t: float, home: int, away: int, sit: Situation = EVEN) -> GameState:
    return GameState(t_game_s=t, period=3, home_score=home, away_score=away, situation=sit)


def home_win(p: dict[str, float]) -> float:
    return p["home_reg"] + p["home_ot"] + p["home_so"]


def test_up_three_with_five_minutes_left(model: WinProbModel, pregame: object) -> None:
    p = model.six_way(state(3600 - 300, 4, 1), pregame)  # type: ignore[arg-type]
    assert p["home_reg"] > 0.98


def test_tied_with_one_second_left(model: WinProbModel, pregame: object) -> None:
    p = model.six_way(state(3599, 2, 2), pregame)  # type: ignore[arg-type]
    tied = sum(p[k] for k in ("home_ot", "home_so", "away_ot", "away_so"))
    assert tied > 0.97


def test_empty_net_lowers_leaders_odds(model: WinProbModel, pregame: object) -> None:
    pulled = Situation(False, 6, 5, True)  # away goalie pulled for an extra attacker
    en = model.six_way(state(3540, 3, 2, pulled), pregame)  # type: ignore[arg-type]
    even = model.six_way(state(3540, 3, 2), pregame)  # type: ignore[arg-type]
    assert home_win(en) < home_win(even)


def test_probabilities_sum_to_one(model: WinProbModel, pregame: object) -> None:
    for t in (0, 900, 2400, 3500, 3600):
        for diff in (-3, -1, 0, 1, 3):
            p = model.six_way(state(t, max(diff, 0), max(-diff, 0)), pregame)  # type: ignore[arg-type]
            assert sum(p.values()) == pytest.approx(1.0)
            assert all(0 <= v <= 1 for v in p.values())


def test_monotonic_in_score_differential(model: WinProbModel, pregame: object) -> None:
    for t in (300, 1800, 3000, 3500):
        probs = [
            home_win(model.six_way(state(t, 3 + d, 3), pregame))  # type: ignore[arg-type]
            for d in range(-3, 4)
        ]
        assert probs == sorted(probs), (t, probs)
        away = [
            model.six_way(state(t, 3 + d, 3), pregame)["away_reg"]  # type: ignore[arg-type]
            for d in range(-3, 4)
        ]
        assert away == sorted(away, reverse=True), (t, away)
