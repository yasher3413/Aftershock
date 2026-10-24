"""A new season moves each team's points pace partway to its betting line."""

from __future__ import annotations

import pytest

from aftershock.ml.strength import RatingEngine, StrengthParams, TeamRating


def engine(weight: float) -> RatingEngine:
    e = RatingEngine(
        params=StrengthParams(regress=0.0, market_weight=weight),
        market={2: {"AAA": 110.0, "BBB": 90.0, "CCC": 100.0}},
    )
    e.season = 1
    for t in ("AAA", "BBB", "CCC"):
        e.ratings[t] = TeamRating()
    return e


def test_paces_move_halfway_toward_the_lines_relative_to_the_league() -> None:
    e = engine(0.5)
    even = e.points_per_game("CCC")
    e.start_season(2)
    # Equal teams, so the model's pace is the league average for all three;
    # halfway toward a +10 / -10 line is +5 / -5 points over 82 games.
    assert e.points_per_game("AAA") * 82 == pytest.approx(even * 82 + 5, abs=0.05)
    assert e.points_per_game("BBB") * 82 == pytest.approx(even * 82 - 5, abs=0.05)
    assert e.points_per_game("CCC") * 82 == pytest.approx(even * 82, abs=0.05)


def test_no_weight_or_no_lines_changes_nothing() -> None:
    e = engine(0.0)
    e.start_season(2)
    assert e.ratings["AAA"].off == 0.0
    e = engine(0.5)
    e.start_season(3)  # no lines for this season
    assert e.ratings["AAA"].off == 0.0
