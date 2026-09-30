"""Turn raw live recordings into small test fixtures.

Usage (from services/): uv run python ../scripts/make_live_fixtures.py [game_id ...]

Reads ``data/recordings/{game_id}/`` (every distinct play-by-play response the
recorder saw) and writes ``tests/fixtures/nhl/live/{game_id}/`` with only the
snapshots where something about a goal changed (a goal appeared, its details
changed, it disappeared, or the score changed), plus the first and the last.
Each snapshot keeps the fields the live engine reads.
"""

from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path
from typing import Any

from aftershock.config import REPO_ROOT, get_settings

OUT = REPO_ROOT / "tests" / "fixtures" / "nhl" / "live"
KEEP_TOP = ("id", "season", "gameType", "gameDate", "startTimeUTC", "venue", "gameState",
            "gameScheduleState", "periodDescriptor", "clock", "awayTeam", "homeTeam",
            "gameOutcome", "plays")
KEEP_TEAM = ("id", "abbrev", "score", "sog")


def trim(doc: dict[str, Any]) -> dict[str, Any]:
    out = {k: doc[k] for k in KEEP_TOP if k in doc}
    for side in ("awayTeam", "homeTeam"):
        if side in out:
            out[side] = {k: out[side][k] for k in KEEP_TEAM if k in out[side]}
    plays = []
    for p in doc.get("plays", []):
        p = {k: v for k, v in p.items() if k != "pptReplayUrl"}
        if "details" in p:
            p["details"] = {k: v for k, v in p["details"].items()
                            if not k.startswith(("highlightClip", "discreteClip"))}
        plays.append(p)
    out["plays"] = plays
    return out


def goal_signature(doc: dict[str, Any]) -> tuple[Any, ...]:
    goals = tuple(sorted(
        (p["eventId"], json.dumps(p.get("details", {}), sort_keys=True))
        for p in doc.get("plays", []) if p.get("typeDescKey") == "goal"))
    return (goals, doc.get("homeTeam", {}).get("score"), doc.get("awayTeam", {}).get("score"),
            doc.get("gameState"))


def convert(game_dir: Path) -> int:
    files = sorted(game_dir.glob("*.json.gz"))
    if not files:
        return 0
    keep: list[dict[str, Any]] = []
    last_sig: tuple[Any, ...] | None = None
    for i, f in enumerate(files):
        with gzip.open(f, "rt", encoding="utf-8") as fh:
            doc = json.load(fh)
        sig = goal_signature(doc)
        if i == 0 or i == len(files) - 1 or sig != last_sig:
            keep.append(trim(doc))
        last_sig = sig
    out = OUT / game_dir.name
    out.mkdir(parents=True, exist_ok=True)
    for i, doc in enumerate(keep):
        with gzip.open(out / f"{i:04d}.json.gz", "wt", encoding="utf-8") as fh:
            json.dump(doc, fh, separators=(",", ":"))
    return len(keep)


def main() -> None:
    root = get_settings().data_dir / "recordings"
    ids = sys.argv[1:] or sorted(p.name for p in root.iterdir() if p.is_dir())
    for gid in ids:
        print(gid, convert(root / gid), "snapshots kept")


if __name__ == "__main__":
    main()
