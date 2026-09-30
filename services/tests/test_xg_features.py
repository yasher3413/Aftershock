from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

import pytest

from aftershock.ml.xg_features import attempt_team, shot_distance_angle, xg_rows
from aftershock.nhl.parse import SHOT_TYPES, parse_play_by_play

Fixture = Callable[[str], Any]


def test_distance_and_angle() -> None:
    assert shot_distance_angle(89, 0) == (0.0, 0.0)
    d, a = shot_distance_angle(69, 0)
    assert d == pytest.approx(20) and a == pytest.approx(0)
    d, a = shot_distance_angle(69, 20)
    assert d == pytest.approx(math.hypot(20, 20)) and a == pytest.approx(45)
    _, behind = shot_distance_angle(95, 5)
    assert behind > 90


@pytest.mark.parametrize("name", ["pbp_regulation_en", "pbp_overtime", "pbp_shootout"])
def test_row_count_matches_eligible_attempts(fixture: Fixture, name: str) -> None:
    g = parse_play_by_play(fixture(name))
    rows = xg_rows(g)
    expected = sum(
        1
        for p in g.plays
        if p.type in SHOT_TYPES
        and p.period_type != "SO"
        and p.situation_code not in {"1010", "0101"}
        and p.x is not None
    )
    assert len(rows) == expected
    assert sum(r["is_goal"] for r in rows) == sum(
        1 for p in g.plays if p.type == "goal" and p.period_type != "SO"
    )


def test_goals_are_close_and_score_state_is_pre_shot(fixture: Fixture) -> None:
    g = parse_play_by_play(fixture("pbp_regulation_en"))
    rows = xg_rows(g)
    goals = [r for r in rows if r["is_goal"]]
    assert sorted(r["distance"] for r in goals)[len(goals) // 2] < 40
    # The first goal of the game is always scored at a tied score.
    first = min(goals, key=lambda r: r["t_game_s"])
    assert first["score_state"] == 0
    assert all(-3 <= r["score_state"] <= 3 for r in rows)


def test_empty_net_flag(fixture: Fixture) -> None:
    g = parse_play_by_play(fixture("pbp_regulation_en"))
    rows = xg_rows(g)
    en_goal_ids = {p.event_id for p in g.plays if p.type == "goal" and p.goalie_id is None}
    flagged = {r["event_id"] for r in rows if r["empty_net_against"] and r["is_goal"]}
    assert en_goal_ids and en_goal_ids <= flagged


def test_penalty_shots_excluded_by_default(fixture: Fixture) -> None:
    g = parse_play_by_play(fixture("pbp_penalty_shot"))
    assert not any(r["penalty_shot"] for r in xg_rows(g))
    assert any(r["penalty_shot"] for r in xg_rows(g, include_penalty_shots=True))


def test_blocked_shot_belongs_to_shooter(fixture: Fixture) -> None:
    g = parse_play_by_play(fixture("pbp_overtime"))
    home, away = g.meta.home.id, g.meta.away.id
    for p in g.plays:
        if p.type == "blocked-shot" and p.reason == "blocked":
            assert attempt_team(p, home, away) != p.owner_team_id
