from datetime import date, timedelta
from typing import Any

import pytest

from aftershock.sim.roster import Window
from aftershock.sim.roster_lab import apply_windows, game_date, run_roster_lab
from tests.roster_fixtures import N_FINAL, gold_boot

core = pytest.importorskip("aftershock_core")


@pytest.fixture(scope="module")
def boot() -> dict[str, Any]:
    return gold_boot()


def first_future(boot: dict[str, Any]) -> date:
    return game_date(boot["games"][N_FINAL])


def tor_games(b: dict[str, Any], start: date, days: int) -> list[dict[str, Any]]:
    end = start + timedelta(days=days)
    return [
        g
        for g in b["games"]
        if g["status"] == "future"
        and "TOR" in (g["home"], g["away"])
        and start <= game_date(g) < end
    ]


def test_no_moves_changes_nothing(boot: dict[str, Any]) -> None:
    r = run_roster_lab(boot, [])
    assert all(t.playoffs_before == t.playoffs_after for t in r.teams)
    assert len(r.teams) == 32


def test_window_only_touches_games_inside_it(boot: dict[str, Any]) -> None:
    d1 = first_future(boot)
    out = apply_windows(boot, [Window("TOR", d1, d1 + timedelta(days=7), 0.1, 0.0)])
    inside_new, inside_old = tor_games(out, d1, 7), tor_games(boot, d1, 7)
    later_new, later_old = (
        tor_games(out, d1 + timedelta(days=7), 60),
        tor_games(boot, d1 + timedelta(days=7), 60),
    )
    assert inside_new and later_new
    assert all(a["lam"] != b["lam"] for a, b in zip(inside_new, inside_old, strict=True))
    assert all(a["lam"] == b["lam"] for a, b in zip(later_new, later_old, strict=True))
    assert out["playoff_p"] == boot["playoff_p"]  # the change is over by the playoffs


def test_rest_of_season_change_reaches_the_playoffs(boot: dict[str, Any]) -> None:
    d1 = first_future(boot)
    out = apply_windows(boot, [Window("TOR", d1, None, 0.1, -0.1)])
    i = boot["teams"].index("TOR")
    assert out["playoff_p"][i][(i + 1) % 32] > boot["playoff_p"][i][(i + 1) % 32]


def test_home_rate_moves_with_home_offense_and_away_defense(boot: dict[str, Any]) -> None:
    d1 = first_future(boot)
    out = apply_windows(boot, [Window("TOR", d1, None, 0.1, 0.0)])
    g_new, g_old = tor_games(out, d1, 400)[0], tor_games(boot, d1, 400)[0]
    k = 0 if g_new["home"] == "TOR" else 1
    assert g_new["lam"][k] == pytest.approx(g_old["lam"][k] * 2.718281828**0.1, rel=1e-6)
    assert g_new["lam"][1 - k] == pytest.approx(g_old["lam"][1 - k])


def test_stronger_team_gains(boot: dict[str, Any]) -> None:
    r = run_roster_lab(boot, [Window("TOR", first_future(boot), None, 0.08, -0.08)])
    tor = next(t for t in r.teams if t.team == "TOR")
    assert tor.playoffs_after > tor.playoffs_before
    assert tor.points_after > tor.points_before
    assert tor.cup_after > tor.cup_before


def test_same_input_same_numbers(boot: dict[str, Any]) -> None:
    w = [Window("TOR", first_future(boot), None, 0.05, 0.0)]
    assert run_roster_lab(boot, w) == run_roster_lab(boot, w)
