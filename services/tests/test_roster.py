import math
from datetime import date, timedelta

import pytest

from aftershock.ml.player_value import PlayerValue
from aftershock.sim.roster import (
    Injury,
    Sign,
    Spot,
    Trade,
    Window,
    check_shape,
    encode_moves,
    parse_moves,
    team_deltas,
)

TODAY = date(2026, 11, 1)
LEAGUE = 2.95


def team(abbrev: str, base: int) -> tuple[list[Spot], dict[int, PlayerValue]]:
    """12 forwards (base..base+11, best first), 6 defence, 2 goalies."""
    spots: list[Spot] = []
    values: dict[int, PlayerValue] = {}
    for i in range(12):
        pid = base + i
        spots.append(Spot(pid, abbrev, "F", True, 18.0 - i * 0.6, 2.0, 0.0))
        values[pid] = PlayerValue(pid, "F", off60=0.1 - i * 0.01, ev_toi_pg=18.0 - i * 0.6)
    for i in range(6):
        pid = base + 20 + i
        spots.append(Spot(pid, abbrev, "D", True, 22.0 - i, 1.0, 0.0))
        values[pid] = PlayerValue(pid, "D", def60=-0.05 + i * 0.01, ev_toi_pg=22.0 - i)
    for i, share in enumerate((0.7, 0.3)):
        pid = base + 30 + i
        spots.append(Spot(pid, abbrev, "G", True, 0.0, 0.0, share))
        values[pid] = PlayerValue(pid, "G", gsax_per_shot=0.004 - i * 0.004)
    return spots, values


@pytest.fixture
def league() -> tuple[dict[str, list[Spot]], dict[int, PlayerValue]]:
    tor, tv = team("TOR", 100)
    mtl, mv = team("MTL", 200)
    star = PlayerValue(100, "F", off60=0.5, def60=0.0, ev_toi_pg=18.0)
    fa = PlayerValue(900, "F", off60=0.3, ev_toi_pg=16.0)
    return {"TOR": tor, "MTL": mtl}, {**tv, **mv, 100: star, 900: fa}


def test_fourth_liner_swap_is_near_zero(league) -> None:
    rosters, values = league
    w = team_deltas([Trade(111, "MTL"), Trade(211, "TOR")], rosters, values, LEAGUE, TODAY)
    assert all(abs(x.d_off) < 0.005 and abs(x.d_def) < 0.005 for x in w)


def test_star_out_lowers_offense_and_returns_after_window(league) -> None:
    rosters, values = league
    (w,) = team_deltas([Injury(100, 4)], rosters, values, LEAGUE, TODAY)
    assert (w.team, w.start, w.end) == ("TOR", TODAY, TODAY + timedelta(days=28))
    assert -0.08 < w.d_off < -0.02
    assert abs(w.d_def) < 0.01


def test_rest_of_season_injury_has_no_end(league) -> None:
    rosters, values = league
    (w,) = team_deltas([Injury(100, None)], rosters, values, LEAGUE, TODAY)
    assert w.end is None


def test_trade_moves_both_teams_opposite_ways(league) -> None:
    rosters, values = league
    w = {x.team: x for x in team_deltas([Trade(100, "MTL")], rosters, values, LEAGUE, TODAY)}
    assert w["TOR"].d_off < 0 < w["MTL"].d_off


def test_signing_helps_only_the_signing_team(league) -> None:
    rosters, values = league
    (w,) = team_deltas([Sign(900, "MTL")], rosters, values, LEAGUE, TODAY)
    assert w.team == "MTL" and w.d_off > 0


def test_better_goalie_takes_the_starters_share(league) -> None:
    rosters, values = league
    values[999] = PlayerValue(999, "G", gsax_per_shot=0.02)
    (w,) = team_deltas([Sign(999, "TOR")], rosters, values, LEAGUE, TODAY)
    assert w.d_def < -0.01


def test_injury_after_season_end_is_harmless(league) -> None:
    rosters, values = league
    (w,) = team_deltas([Injury(100, 8)], rosters, values, LEAGUE, TODAY + timedelta(days=300))
    assert w.end is not None


def test_shape_limits(league) -> None:
    rosters, _ = league
    msg = check_shape(rosters, [Trade(130, "MTL"), Trade(131, "MTL")])
    assert msg == "TOR would have 0 goalies; a team needs at least 2."
    assert check_shape(rosters, [Trade(111, "MTL"), Trade(211, "TOR")]) is None


def test_encoding_is_canonical() -> None:
    a = encode_moves(parse_moves("t5-MTL_i9-4"))
    assert a == encode_moves(parse_moves("i9-4_t5-MTL")) == "i9-4_t5-MTL"
    assert parse_moves("i9-0") == [Injury(9, None)]
    assert parse_moves("s7-TOR") == [Sign(7, "TOR")]


@pytest.mark.parametrize(
    "bad", ["", "x5-TOR", "i9-3", "t5-tor", "t5-MTL_t5-TOR", "_".join(f"i{i}-1" for i in range(21))]
)
def test_bad_encodings_are_refused(bad: str) -> None:
    with pytest.raises(ValueError):
        parse_moves(bad)


def test_window_type() -> None:
    assert Window("TOR", TODAY, None, 0.0, 0.0).end is None


def test_shape_uses_a_free_agents_own_position(league) -> None:
    rosters, values = league
    values[901] = PlayerValue(901, "G", games=40)
    values[902] = PlayerValue(902, "D", games=40)
    values[903] = PlayerValue(903, "G", games=40)
    # TOR has 2 goalies: a third is fine, a fourth is not.
    assert check_shape(rosters, [Sign(901, "TOR")], values) is None
    msg = check_shape(rosters, [Sign(901, "TOR"), Sign(903, "TOR")], values)
    assert msg == "TOR would have 4 goalies; a team can carry at most 3."
    # A defenceman is not counted as a forward.
    assert check_shape(rosters, [Sign(902, "TOR")], values) is None


def test_goalie_value_is_not_scaled_like_skaters(league) -> None:
    from aftershock.sim.roster import SHOTS_AGAINST_PG

    rosters, values = league
    values[999] = PlayerValue(999, "G", gsax_per_shot=0.02)
    (w,) = team_deltas([Sign(999, "TOR")], rosters, values, LEAGUE, TODAY)
    # The newcomer takes the starter's 0.7; the old starter the backup's 0.3.
    d_ga = -((0.02 - 0.004) * 0.7 + (0.004 - 0.0) * 0.3) * SHOTS_AGAINST_PG
    assert w.d_def == pytest.approx(math.log(1 + d_ga / LEAGUE))
    assert SHOTS_AGAINST_PG == 43.0
