from __future__ import annotations

from collections.abc import Callable
from typing import Any

from aftershock.ml.wp_features import GameStateTracker, regulation_target, wp_rows
from aftershock.nhl.parse import parse_play_by_play

Fixture = Callable[[str], Any]
PRE = (0.4, 0.37, 0.23)


def test_tracker_reaches_final_regulation_score(fixture: Fixture) -> None:
    g = parse_play_by_play(fixture("pbp_regulation_en"))
    tracker = GameStateTracker(g.meta.home.id)
    for p in g.plays:
        tracker.apply(p)
    assert (tracker.state.home_score, tracker.state.away_score) == (
        g.meta.home.score,
        g.meta.away.score,
    )


def test_targets(fixture: Fixture) -> None:
    reg = parse_play_by_play(fixture("pbp_regulation_en"))
    expected = 0 if reg.meta.home.score > reg.meta.away.score else 1  # type: ignore[operator]
    assert regulation_target(reg) == expected
    assert regulation_target(parse_play_by_play(fixture("pbp_overtime"))) == 2
    assert regulation_target(parse_play_by_play(fixture("pbp_shootout"))) == 2


def test_rows_cover_grid_and_events(fixture: Fixture) -> None:
    g = parse_play_by_play(fixture("pbp_regulation_en"))
    rows = wp_rows(g, PRE)
    n_events = sum(1 for p in g.plays if p.period <= 3)
    assert len(rows) == n_events + 121
    assert abs(sum(r["weight"] for r in rows) - 1.0) < 1e-9
    assert rows[-1]["secs_left"] == 0
    assert all(r["pre_tie"] == PRE[2] for r in rows)


def test_power_play_clock_counts_down(fixture: Fixture) -> None:
    g = parse_play_by_play(fixture("pbp_overtime"))
    tracker = GameStateTracker(g.meta.home.id)
    seen_pp = False
    for p in g.plays:
        st = tracker.apply(p)
        sit = st.situation
        diff = sit.home_skaters - sit.away_skaters
        active = diff != 0 and sit.home_goalie and sit.away_goalie and p.period <= 3
        if active and st.pp_secs_left != 0:
            seen_pp = True
            assert (st.pp_secs_left > 0) == (diff > 0)
            assert abs(st.pp_secs_left) <= 300
    assert seen_pp
