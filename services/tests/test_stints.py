from typing import Any

import pytest

from aftershock.ml.stints import Shot, build_stints, toi

GOALIES = {30, 31}


def shift(pid: int, team: str, start: str, end: str, period: int = 1) -> dict[str, Any]:
    return {
        "typeCode": 517,
        "playerId": pid,
        "teamAbbrev": team,
        "period": period,
        "startTime": start,
        "endTime": end,
    }


def full(
    skaters_home: list[int], skaters_away: list[int], end: str = "01:00"
) -> list[dict[str, Any]]:
    rows = [shift(30, "TOR", "00:00", end), shift(31, "MTL", "00:00", end)]
    rows += [shift(p, "TOR", "00:00", end) for p in skaters_home]
    rows += [shift(p, "MTL", "00:00", end) for p in skaters_away]
    return rows


def test_stints_split_on_changes_and_carry_xg() -> None:
    shifts = full([2, 3, 4, 5], [21, 22, 23, 24, 25])
    shifts += [shift(1, "TOR", "00:00", "00:30"), shift(6, "TOR", "00:30", "01:00")]
    shots = [Shot(event_id=7, period=1, t_period_s=20, team="TOR", goal=False)]
    st = build_stints(1, shifts, shots, {7: 0.12}, "TOR", GOALIES)
    assert [s.dur_s for s in st] == [30, 30]
    assert st[0].home_xg == pytest.approx(0.12)
    assert st[0].away_xg == 0.0
    assert st[0].home == (1, 2, 3, 4, 5)
    assert st[1].home == (2, 3, 4, 5, 6)
    assert st[0].away == (21, 22, 23, 24, 25)


def test_goal_counts_and_shot_at_change_belongs_to_earlier_stint() -> None:
    shifts = full([2, 3, 4, 5], [21, 22, 23, 24, 25])
    shifts += [shift(1, "TOR", "00:00", "00:30"), shift(6, "TOR", "00:30", "01:00")]
    shots = [Shot(event_id=9, period=1, t_period_s=30, team="MTL", goal=True)]
    st = build_stints(1, shifts, shots, {9: 0.3}, "TOR", GOALIES)
    assert st[0].away_goals == 1 and st[0].away_xg == pytest.approx(0.3)
    assert st[1].away_goals == 0


def test_identical_neighbours_merge() -> None:
    shifts = full([1, 2, 3, 4, 5], [21, 22, 23, 24])
    shifts += [shift(25, "MTL", "00:00", "00:30"), shift(25, "MTL", "00:30", "01:00")]
    st = build_stints(1, shifts, [], {}, "TOR", GOALIES)
    assert [s.dur_s for s in st] == [60]


def test_power_play_time_is_not_a_stint_and_counts_as_pp() -> None:
    shifts = full([11, 2, 3, 4, 5], [21, 22, 23, 24])
    assert build_stints(1, shifts, [], {}, "TOR", GOALIES) == []
    t = toi(shifts, GOALIES)
    assert t[11].pp_s == 60 and t[11].ev_s == 0 and t[11].total_s == 60
    assert t[21].pp_s == 0 and t[21].total_s == 60
    assert 30 not in t


def test_goalie_pulled_is_not_5v5() -> None:
    shifts = [s for s in full([1, 2, 3, 4, 5], [21, 22, 23, 24, 25]) if s["playerId"] != 31]
    shifts.append(shift(26, "MTL", "00:00", "01:00"))
    assert build_stints(1, shifts, [], {}, "TOR", GOALIES) == []


def test_even_strength_time() -> None:
    t = toi(full([1, 2, 3, 4, 5], [21, 22, 23, 24, 25]), GOALIES)
    assert t[1].ev_s == 60 and t[1].team == "TOR"
