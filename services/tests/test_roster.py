import math
from dataclasses import replace
from datetime import date, timedelta

import pytest

from aftershock.ml.player_value import PlayerValue
from aftershock.sim.roster import (
    Injury,
    Spot,
    Trade,
    Window,
    bumped,
    check_shape,
    encode_moves,
    parse_moves,
    team_deltas,
    team_goals,
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


def test_better_goalie_takes_the_starters_share(league) -> None:
    rosters, values = league
    values[230] = PlayerValue(230, "G", gsax_per_shot=0.02)
    w = {x.team: x for x in team_deltas([Trade(230, "TOR")], rosters, values, LEAGUE, TODAY)}
    assert w["TOR"].d_def < -0.01


def test_injury_after_season_end_is_harmless(league) -> None:
    rosters, values = league
    (w,) = team_deltas([Injury(100, 8)], rosters, values, LEAGUE, TODAY + timedelta(days=300))
    assert w.end is not None


def test_shape_limits(league) -> None:
    rosters, _ = league
    msg = check_shape(rosters, [Trade(130, "MTL"), Trade(131, "MTL")])
    assert msg == "TOR would have 0 goalies; a team needs at least 2."
    assert check_shape(rosters, [Trade(111, "MTL"), Trade(211, "TOR")]) is None


def test_uneven_trades_are_allowed(league) -> None:
    rosters, _ = league
    three = [Trade(109, "MTL"), Trade(110, "MTL"), Trade(111, "MTL")]
    # TOR keeps 9 forwards, too few to dress; MTL taking 15 is fine.
    assert check_shape(rosters, three) == "TOR would have 9 forwards; a team needs at least 12."
    rosters["TOR"] += [Spot(150 + i, "TOR", "F", True, 8.0, 0.0, 0.0) for i in range(3)]
    assert check_shape(rosters, three) is None


def test_extra_players_bump_the_least_used(league) -> None:
    rosters, values = league
    # MTL's 12th forward (211, fewest minutes) makes way for TOR's best.
    assert bumped(rosters, values, [Trade(100, "MTL")]) == {"MTL": [211]}
    # A one-for-one swap bumps nobody, and injured players are not "bumped".
    assert bumped(rosters, values, [Trade(111, "MTL"), Trade(211, "TOR")]) == {}
    assert bumped(rosters, values, [Injury(100, 4)]) == {}


def test_the_weakest_sits_not_the_least_used(league) -> None:
    rosters, values = league
    # A power-play star with few even-strength minutes keeps his place.
    values[211] = replace(values[211], off60=0.5)
    assert bumped(rosters, values, [Trade(100, "MTL")]) == {"MTL": [210]}


def test_today_the_most_used_dress_and_an_injury_brings_in_the_extra(league) -> None:
    rosters, values = league
    regulars = list(rosters["TOR"])
    # A struggling regular, and a 13th forward who sat with the fewest minutes.
    values[105] = replace(values[105], off60=-0.5)
    extra = Spot(112, "TOR", "F", True, 8.0, 0.0, 0.0)
    values[112] = PlayerValue(112, "F", off60=0.05, ev_toi_pg=8.0)
    rosters["TOR"] = [*regulars, extra]
    lineup = rosters["TOR"]
    assert team_goals(lineup, lineup, values) == team_goals(regulars, regulars, values)
    (w,) = team_deltas([Injury(100, None)], rosters, values, LEAGUE, TODAY)
    after = [s for s in lineup if s.player_id != 100]
    gf = team_goals(after, regulars, values)[0] - team_goals(regulars, regulars, values)[0]
    assert w.d_off == pytest.approx(math.log(1 + gf / LEAGUE))


def test_encoding_is_canonical() -> None:
    a = encode_moves(parse_moves("t5-MTL_i9-4"))
    assert a == encode_moves(parse_moves("i9-4_t5-MTL")) == "i9-4_t5-MTL"
    assert parse_moves("i9-0") == [Injury(9, None)]


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "x5-TOR",
        "s7-TOR",
        "i9-3",
        "t5-tor",
        "t5-MTL_t5-TOR",
        "_".join(f"i{i}-1" for i in range(21)),
    ],
)
def test_bad_encodings_are_refused(bad: str) -> None:
    with pytest.raises(ValueError):
        parse_moves(bad)


def test_window_type() -> None:
    assert Window("TOR", TODAY, None, 0.0, 0.0).end is None


def test_goalie_value_is_not_scaled_like_skaters(league) -> None:
    from aftershock.sim.roster import SHOTS_AGAINST_PG

    rosters, values = league
    values[230] = PlayerValue(230, "G", gsax_per_shot=0.02)
    w = {x.team: x for x in team_deltas([Trade(230, "TOR")], rosters, values, LEAGUE, TODAY)}["TOR"]
    # The newcomer takes the starter's 0.7; the old starter the backup's 0.3.
    d_ga = -((0.02 - 0.004) * 0.7 + (0.004 - 0.0) * 0.3) * SHOTS_AGAINST_PG
    assert w.d_def == pytest.approx(math.log(1 + d_ga / LEAGUE))
    assert SHOTS_AGAINST_PG == 43.0
