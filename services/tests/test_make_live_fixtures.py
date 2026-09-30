from __future__ import annotations

import gzip
import importlib.util
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from aftershock.config import REPO_ROOT
from aftershock.live.diff import GameDiffer
from aftershock.live.source import ReplayGame

Fixture = Callable[[str], Any]


def _load_script() -> Any:
    spec = importlib.util.spec_from_file_location(
        "make_live_fixtures", REPO_ROOT / "scripts" / "make_live_fixtures.py"
    )
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_trimmed_recording_keeps_every_goal_change(
    fixture: Fixture, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    mod = _load_script()
    monkeypatch.setattr(mod, "OUT", tmp_path / "out")
    game = ReplayGame(fixture("pbp_regulation_en"))
    rec = tmp_path / "rec" / str(game.game_id)
    rec.mkdir(parents=True)
    frames = [doc for _, doc in game.frames()]
    for i, doc in enumerate(frames):
        with gzip.open(rec / f"{i:05d}.json.gz", "wt", encoding="utf-8") as fh:
            json.dump(doc, fh)

    kept = mod.convert(rec)
    goals = sum(1 for p in game.plays if p["typeDescKey"] == "goal")
    assert 2 <= kept < len(frames)
    assert kept >= goals + 1

    differ = GameDiffer(game.game_id)
    seen: list[int] = []
    for f in sorted((tmp_path / "out" / str(game.game_id)).glob("*.json.gz")):
        with gzip.open(f, "rt", encoding="utf-8") as fh:
            res = differ.apply(json.load(fh))
        assert res.discrepancy is None
        seen.extend(p.event_id for p in res.new_goals)
    assert seen == [p["eventId"] for p in game.plays if p["typeDescKey"] == "goal"]
