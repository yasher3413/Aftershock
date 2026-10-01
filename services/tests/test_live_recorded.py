"""Live-engine checks on real recorded play-by-play (tests/fixtures/nhl/live)."""

from __future__ import annotations

import collections
import gzip
import json
from pathlib import Path
from typing import Any

from aftershock.config import REPO_ROOT
from aftershock.live.diff import ChangedPlay, GameDiffer, NewPlay
from aftershock.live.persist import play_rows
from aftershock.nhl.parse import parse_play_by_play

LIVE = REPO_ROOT / "tests" / "fixtures" / "nhl" / "live"


def snapshots(game_id: int) -> list[dict[str, Any]]:
    out = []
    for f in sorted((LIVE / str(game_id)).glob("*.json.gz")):
        with gzip.open(f, "rt", encoding="utf-8") as fh:
            out.append(json.load(fh))
    return out


def test_a_shot_the_feed_turns_into_a_goal_saves_once() -> None:
    """2026-09-30, NYI at TOR: event 160 was posted as a shot, then changed to
    a goal. The diff reports it as a change and as a new goal; the play rows
    must still hold it once, or the upsert fails and the goal is lost."""
    differ = GameDiffer(2026020008)
    turned = False
    for doc in snapshots(2026020008):
        res = differ.apply(doc)
        normalized = {p.event_id: p for p in parse_play_by_play(doc).plays}
        ids = [r["event_id"] for r in play_rows(res, normalized)]
        assert len(ids) == len(set(ids))
        kinds = collections.defaultdict(set)
        for c in res.changes:
            kinds[c.play.event_id].add(type(c))
        turned |= any({ChangedPlay, NewPlay} <= k for k in kinds.values())
    assert turned, "the recording no longer contains the shot-to-goal change"


def test_recorded_goals_match_the_scoreboard() -> None:
    for game_dir in sorted(p for p in LIVE.iterdir() if p.is_dir()):
        differ = GameDiffer(int(game_dir.name))
        for doc in snapshots(int(game_dir.name)):
            res = differ.apply(doc)
            assert res.discrepancy is None, (game_dir.name, res.discrepancy)


def test_fixture_dirs_exist() -> None:
    assert any(Path(LIVE).iterdir())
