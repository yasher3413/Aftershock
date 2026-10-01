from __future__ import annotations

import copy
from collections.abc import Callable
from typing import Any

from aftershock.live.diff import ChangedPlay, GameDiffer, NewPlay, RemovedPlay
from aftershock.live.source import ReplayGame, ReplaySource, wall_offset_s

Fixture = Callable[[str], Any]


def test_replay_frames_reveal_each_goal_once(fixture: Fixture) -> None:
    final = fixture("pbp_regulation_en")
    game = ReplayGame(final)
    differ = GameDiffer(game.game_id)
    goals_seen: list[int] = []
    last_doc: dict[str, Any] = {}
    for _, doc in game.frames():
        res = differ.apply(doc)
        goals_seen.extend(p.event_id for p in res.new_goals)
        assert res.discrepancy is None, res.discrepancy
        last_doc = doc
    expected = [p["eventId"] for p in game.plays if p["typeDescKey"] == "goal"]
    assert goals_seen == expected
    assert last_doc["gameState"] == final["gameState"]


def test_partial_snapshot_score_and_clock(fixture: Fixture) -> None:
    game = ReplayGame(fixture("pbp_overtime"))
    goal_idx = next(i for i, p in enumerate(game.plays) if p["typeDescKey"] == "goal")
    doc = game.at_index(goal_idx + 1)
    d = game.plays[goal_idx]["details"]
    assert doc["homeTeam"]["score"] == d["homeScore"]
    assert doc["awayTeam"]["score"] == d["awayScore"]
    assert doc["gameState"] == "LIVE"
    assert "gameOutcome" not in doc
    before = game.at_index(goal_idx)
    assert before["homeTeam"]["score"] + before["awayTeam"]["score"] == (
        d["homeScore"] + d["awayScore"] - 1
    )


def test_scorer_correction_is_an_attribution_change(fixture: Fixture) -> None:
    final = fixture("pbp_regulation_en")
    differ = GameDiffer(final["id"])
    differ.apply(final)
    corrected = copy.deepcopy(final)
    goal = next(p for p in corrected["plays"] if p["typeDescKey"] == "goal")
    goal["details"]["scoringPlayerId"] = 1234567
    res = differ.apply(corrected)
    assert len(res.changes) == 1
    change = res.changes[0]
    assert isinstance(change, ChangedPlay)
    assert change.is_attribution_change
    assert "scoringPlayerId" in change.changed_fields
    assert res.changed_goals and not res.new_goals and not res.removed_goals


def test_disappearing_goal_is_removed_and_score_decreases(fixture: Fixture) -> None:
    game = ReplayGame(fixture("pbp_regulation_en"))
    goal_idx = next(i for i, p in enumerate(game.plays) if p["typeDescKey"] == "goal")
    differ = GameDiffer(game.game_id)
    differ.apply(game.at_index(goal_idx + 3))
    reverted = game.at_index(goal_idx + 3)
    removed_id = reverted["plays"][goal_idx]["eventId"]
    del reverted["plays"][goal_idx]
    reverted["homeTeam"]["score"] = game.at_index(goal_idx)["homeTeam"]["score"]
    reverted["awayTeam"]["score"] = game.at_index(goal_idx)["awayTeam"]["score"]
    res = differ.apply(reverted)
    assert [p.event_id for p in res.removed_goals] == [removed_id]
    assert res.score_decreased
    assert isinstance(res.changes[0], RemovedPlay)


def test_goal_changed_into_shot_counts_as_removal(fixture: Fixture) -> None:
    final = fixture("pbp_regulation_en")
    differ = GameDiffer(final["id"])
    differ.apply(final)
    edited = copy.deepcopy(final)
    goal = next(p for p in edited["plays"] if p["typeDescKey"] == "goal")
    goal["typeDescKey"] = "shot-on-goal"
    res = differ.apply(edited)
    assert [p.event_id for p in res.removed_goals] == [goal["eventId"]]


def test_score_discrepancy_reported(fixture: Fixture) -> None:
    final = copy.deepcopy(fixture("pbp_regulation_en"))
    final["homeTeam"]["score"] += 1
    res = GameDiffer(final["id"]).apply(final)
    assert res.discrepancy is not None


def test_unchanged_snapshot_has_no_changes(fixture: Fixture) -> None:
    final = fixture("pbp_overtime")
    differ = GameDiffer(final["id"])
    first = differ.apply(final)
    assert all(isinstance(c, NewPlay) for c in first.changes)
    again = differ.apply(copy.deepcopy(final))
    assert again.changes == [] and not again.state_changed


def test_wall_offsets_are_monotone_and_realistic() -> None:
    end_reg = wall_offset_s(3, "REG", 1200, 2)
    assert 2.4 * 3600 < end_reg < 2.6 * 3600
    assert wall_offset_s(2, "REG", 0, 2) > wall_offset_s(1, "REG", 1200, 2)
    assert wall_offset_s(4, "OT", 10, 2) > end_reg
    assert wall_offset_s(5, "SO", 0, 2, so_index=1) > wall_offset_s(4, "OT", 300, 2)


def test_replay_source_interleaves_games_by_wall_time(fixture: Fixture) -> None:
    a, b = fixture("pbp_overtime"), fixture("pbp_shootout")
    src = ReplaySource([a, b])
    times = [s.at for s in src.timeline()]
    assert times == sorted(times)
    assert {s.game_id for s in src.timeline()} == {a["id"], b["id"]}


async def test_live_source_polls_a_watched_game_once_more_after_it_ends() -> None:
    from aftershock.live.source import LiveSource

    class FakeClient:
        def __init__(self) -> None:
            self.state = "LIVE"
            self.pbp_calls = 0

        async def score(self, day: object = None) -> dict[str, object]:
            return {"currentDate": "2099-01-01", "games": [{"id": 1, "gameState": self.state}]}

        async def play_by_play(self, gid: int, use_cache: bool = True) -> dict[str, object]:
            self.pbp_calls += 1
            return {"id": gid, "gameState": self.state, "plays": []}

    client = FakeClient()
    src = LiveSource(client, live_interval=0.0, score_interval=0.0)  # type: ignore[arg-type]
    it = src.snapshots()
    first = await it.__anext__()
    assert first.raw["gameState"] == "LIVE"
    client.state = "FINAL"
    last = await it.__anext__()
    assert last.raw["gameState"] == "FINAL"
    assert 1 not in src._watched
    await it.aclose()  # type: ignore[attr-defined]


async def test_live_source_polls_finished_games_it_was_told_to_watch_once() -> None:
    from aftershock.live.source import LiveSource

    class FakeClient:
        pbp_calls = 0

        async def score(self, day: object = None) -> dict[str, object]:
            return {"currentDate": "2099-01-01", "games": [{"id": 7, "gameState": "FINAL"}]}

        async def play_by_play(self, gid: int, use_cache: bool = True) -> dict[str, object]:
            FakeClient.pbp_calls += 1
            return {"id": gid, "gameState": "FINAL", "plays": []}

    src = LiveSource(FakeClient(), live_interval=0.0, score_interval=0.0, watch=[7])  # type: ignore[arg-type]
    it = src.snapshots()
    first = await it.__anext__()
    assert first.game_id == 7 and 7 not in src._watched
    await it.aclose()  # type: ignore[attr-defined]
    assert FakeClient.pbp_calls == 1
