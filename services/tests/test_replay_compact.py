"""Replay bundles are trimmed before they go to the browser."""

from __future__ import annotations

import copy
import gzip
import json
import os
from pathlib import Path
from typing import Any

from aftershock.api.replay import compact, compacted_bytes


def _odds(team: str, p: float, cup: float = 0.01) -> dict[str, Any]:
    return {"team": team, "p_playoffs": p, "p_cup": cup, "exp_points": 90.0}


def _game(clock: int, home: int = 0, wp: float = 0.5) -> dict[str, Any]:
    return {
        "id": 1,
        "state": "LIVE",
        "clock_seconds": clock,
        "home_score": home,
        "wp": {"home_reg": wp},
    }


def _bundle() -> dict[str, Any]:
    return {
        "initial": {"odds": [_odds("TOR", 0.5), _odds("MTL", 0.4)], "games": [_game(1200)]},
        "frames": [
            {"t": 0, "message": {"type": "game_update", "game": _game(1190, wp=0.51234567)}},
            {
                "t": 1,
                "message": {
                    "type": "odds_update",
                    "sim_run_id": 7,
                    "odds": [_odds("TOR", 0.51234567), _odds("MTL", 0.4)],
                },
            },
            {
                "t": 2,
                "message": {
                    "type": "odds_update",
                    "sim_run_id": 7,
                    "odds": [_odds("TOR", 0.51231), _odds("MTL", 0.4)],
                },
            },
            {"t": 3, "message": {"type": "tremor", "tremor": {"id": 9, "magnitude": 4.123456}}},
        ],
    }


def _replay(bundle: dict[str, Any]) -> tuple[dict[str, Any], dict[int, Any]]:
    """Apply frames the way the browser's reducer does: merge field by field."""
    odds = {o["team"]: dict(o) for o in bundle["initial"]["odds"]}
    games = {g["id"]: dict(g) for g in bundle["initial"]["games"]}
    for f in bundle["frames"]:
        m = f["message"]
        if m["type"] == "odds_update":
            for o in m["odds"]:
                odds[o["team"]] = {**odds.get(o["team"], {}), **o}
        elif m["type"] == "game_update":
            games[m["game"]["id"]] = {**games.get(m["game"]["id"], {}), **m["game"]}
    return odds, games


def test_frames_keep_only_what_changed() -> None:
    out = compact(_bundle())
    frames = out["frames"]
    assert frames[0]["message"]["game"] == {
        "id": 1,
        "clock_seconds": 1190,
        "wp": {"home_reg": 0.5123},
    }
    assert frames[1]["message"]["odds"] == [{"team": "TOR", "p_playoffs": 0.5123}]
    # The third frame moved nothing at four decimals, so it is gone.
    assert [f["t"] for f in frames] == [0, 1, 3]
    # Tremors are left exactly as recorded.
    assert frames[2]["message"]["tremor"]["magnitude"] == 4.123456


def test_replaying_the_compact_bundle_lands_in_the_same_place() -> None:
    full_odds, full_games = _replay(_bundle())
    odds, games = _replay(compact(_bundle()))
    for team, o in full_odds.items():
        assert odds[team].keys() == o.keys()
        for k, v in o.items():
            assert odds[team][k] == (round(v, 4) if isinstance(v, float) else v)
    assert games[1]["clock_seconds"] == full_games[1]["clock_seconds"]
    assert games[1]["state"] == "LIVE"


def test_compacted_bytes_rebuilds_when_the_file_changes(tmp_path: Path) -> None:
    path = tmp_path / "night.json.gz"
    assert compacted_bytes(path) is None
    b = _bundle()
    path.write_bytes(gzip.compress(json.dumps(b).encode()))
    first = json.loads(gzip.decompress(compacted_bytes(path) or b""))
    assert len(first["frames"]) == 3
    b2 = copy.deepcopy(b)
    b2["frames"] = b2["frames"][:1]
    path.write_bytes(gzip.compress(json.dumps(b2).encode()))
    st = path.stat()
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000))
    second = json.loads(gzip.decompress(compacted_bytes(path) or b""))
    assert len(second["frames"]) == 1
