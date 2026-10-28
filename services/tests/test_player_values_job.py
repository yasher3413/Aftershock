from aftershock.jobs.player_values import GOALIE_GAMES, free_agents, group, lineup
from aftershock.ml.player_value import PlayerValue

GAMES = list(range(1, 11))  # the team's games, in order


def test_fresh_trade_counts_in_new_lineup() -> None:
    # 3 last played in game 11 for his old team; he is on this roster now.
    got = lineup(GAMES, last_game={1: 10, 2: 9, 3: 11}, roster={1, 2, 3})
    assert got == {1, 2, 3}


def test_injured_roster_player_is_not_in_lineup() -> None:
    # 4 played until game 5 and has missed the last five.
    assert lineup(GAMES, {1: 10, 4: 5}, {1, 4}) == {1}


def test_player_who_left_is_not_in_lineup() -> None:
    assert lineup(GAMES, {1: 10, 9: 10}, roster={1}) == {1}


def test_early_season_uses_the_games_there_are() -> None:
    assert lineup([1, 2], {1: 1, 2: 2}, {1, 2}) == {1, 2}


def test_free_agents_exclude_rostered() -> None:
    vals = {1: PlayerValue(1, "F"), 2: PlayerValue(2, "D")}
    assert free_agents(vals, rostered={1}) == {2}


def test_position_groups() -> None:
    assert [group(p) for p in ("C", "L", "R", "D", "G")] == ["F", "F", "F", "D", "G"]


def test_roster_seasons() -> None:
    from aftershock.jobs.player_values import roster_seasons

    assert roster_seasons(20262027) == [20242025, 20252026, 20262027]


def test_backup_goalie_counts_over_a_longer_stretch() -> None:
    games = list(range(1, 11))
    assert lineup(games, {1: 10, 2: 4}, {1, 2}, recent=GOALIE_GAMES) == {1, 2}
    assert lineup(games, {1: 10, 2: 4}, {1, 2}) == {1}
