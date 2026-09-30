from __future__ import annotations

import statistics
from collections.abc import Callable
from typing import Any

import pytest

from aftershock.nhl.parse import (
    SHOT_TYPES,
    Situation,
    game_seconds,
    home_attack_signs,
    mmss_to_seconds,
    parse_play_by_play,
    parse_scheduled_game,
    parse_standings,
)

Fixture = Callable[[str], Any]


def test_mmss() -> None:
    assert mmss_to_seconds("00:00") == 0
    assert mmss_to_seconds("09:51") == 591
    assert mmss_to_seconds("20:00") == 1200
    assert mmss_to_seconds(None) == 0


def test_game_seconds_regular_and_playoff_overtime() -> None:
    assert game_seconds(1, "REG", 0, 2) == 0
    assert game_seconds(3, "REG", 1200, 2) == 3600
    assert game_seconds(4, "OT", 120, 2) == 3720
    assert game_seconds(5, "SO", 0, 2) == 3900
    assert game_seconds(5, "OT", 60, 3) == 3600 + 1200 + 60


@pytest.mark.parametrize(
    ("code", "expected"),
    [
        ("1551", Situation(True, 5, 5, True)),
        ("1451", Situation(True, 4, 5, True)),
        ("0651", Situation(False, 6, 5, True)),
        ("1010", Situation(True, 0, 1, False)),
    ],
)
def test_situation_code(code: str, expected: Situation) -> None:
    assert Situation.parse(code) == expected


def test_situation_code_rejects_garbage() -> None:
    assert Situation.parse(None) is None
    assert Situation.parse("15") is None
    assert Situation.parse("abcd") is None


def test_situation_for_team() -> None:
    sit = Situation.parse("0651")
    assert sit is not None
    assert sit.for_team(is_home=False) == (6, 5, False, True)
    assert sit.for_team(is_home=True) == (5, 6, True, False)


def test_regulation_game_with_empty_net_goal(fixture: Fixture) -> None:
    g = parse_play_by_play(fixture("pbp_regulation_en"))
    assert g.meta.game_type == 2
    assert g.meta.last_period_type == "REG"
    assert g.meta.is_finished
    goals = [p for p in g.plays if p.type == "goal"]
    assert goals
    last = goals[-1]
    assert (last.home_score, last.away_score) == (g.meta.home.score, g.meta.away.score)
    en = [p for p in goals if p.goalie_id is None]
    assert en, "fixture was chosen for its empty-net goal"
    for p in en:
        sit = p.situation
        assert sit is not None
        _, _, _, opp_goalie = sit.for_team(p.owner_team_id == g.meta.home.id)
        assert not opp_goalie


def test_overtime_game(fixture: Fixture) -> None:
    g = parse_play_by_play(fixture("pbp_overtime"))
    assert g.meta.last_period_type == "OT"
    ot_goals = [p for p in g.plays if p.type == "goal" and p.period_type == "OT"]
    assert len(ot_goals) == 1
    assert 3600 < ot_goals[0].t_game_s <= 3900


def test_shootout_game(fixture: Fixture) -> None:
    g = parse_play_by_play(fixture("pbp_shootout"))
    assert g.meta.last_period_type == "SO"
    so = [p for p in g.plays if p.is_shootout]
    assert any(p.type == "shootout-complete" for p in so)
    assert all(p.t_game_s == 3900 for p in so)
    # Shootout goals do not carry a game score change in regulation terms.
    reg_goals = [p for p in g.plays if p.type == "goal" and not p.is_shootout]
    last = reg_goals[-1]
    assert last.home_score == last.away_score


def test_penalty_shot_uses_one_on_one_situation(fixture: Fixture) -> None:
    g = parse_play_by_play(fixture("pbp_penalty_shot"))
    ps = [p for p in g.plays if p.type in SHOT_TYPES and p.situation_code in {"1010", "0101"}]
    assert len(ps) >= 1
    assert all(not p.is_shootout for p in ps)


def test_overturned_goal_leaves_challenge_and_no_goal(fixture: Fixture) -> None:
    g = parse_play_by_play(fixture("pbp_overturned_goal"))
    chlg = [p for p in g.plays if p.type == "stoppage" and (p.reason or "").startswith("chlg-")]
    assert chlg
    stop = chlg[0]
    near_goals = [p for p in g.plays if p.type == "goal" and abs(p.t_game_s - stop.t_game_s) <= 5]
    assert near_goals == []


@pytest.mark.parametrize(
    "name",
    ["pbp_regulation_en", "pbp_overtime", "pbp_shootout", "pbp_penalty_shot", "pbp_legacy_2015"],
)
def test_normalized_goals_cluster_near_the_net(fixture: Fixture, name: str) -> None:
    g = parse_play_by_play(fixture(name))
    xs = [p.x_norm for p in g.plays if p.type == "goal" and p.x_norm is not None]
    assert xs
    assert statistics.median(xs) > 50
    for p in g.plays:
        if p.type in SHOT_TYPES and p.zone == "O" and p.x_norm is not None:
            assert p.x_norm > 0


def test_legacy_game_infers_direction_without_defending_side(fixture: Fixture) -> None:
    g = parse_play_by_play(fixture("pbp_legacy_2015"))
    assert all(p.home_defending_side is None for p in g.plays)
    signs = home_attack_signs(g.plays, g.meta.home.id)
    assert signs[1] == -signs[2] == signs[3]


def test_inference_matches_explicit_side(fixture: Fixture) -> None:
    g = parse_play_by_play(fixture("pbp_overtime"))
    truth = home_attack_signs(g.plays, g.meta.home.id)
    for p in g.plays:
        p.home_defending_side = None
    assert home_attack_signs(g.plays, g.meta.home.id) == truth


def test_schedule_and_standings(fixture: Fixture) -> None:
    sched = fixture("schedule_2026-09-30")
    games = [parse_scheduled_game(g) for day in sched["gameWeek"] for g in day["games"]]
    assert games
    assert all(g.season == 20262027 for g in games)
    rows = parse_standings(fixture("standings_2026-04-16"))
    assert len(rows) == 32
    for r in rows:
        assert r.points == 2 * r.w + r.otl
        assert r.gp == r.w + r.l + r.otl
        assert r.rw <= r.row <= r.w


def test_club_schedule_has_84_regular_season_games(fixture: Fixture) -> None:
    body = fixture("club_schedule_TOR_20262027")
    assert sum(1 for g in body["games"] if g["gameType"] == 2) == 84
