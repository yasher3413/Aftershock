"""Shrink a night's replay bundle before it goes to the browser.

The live worker records every odds update it publishes: all 32 teams every
ten seconds while games are on, at full float precision. That is around
20 MB of JSON a night, which a phone has to download and parse before the
map can play. The browser merges odds field by field, so each odds frame
only needs the numbers that moved (usually just playoff, division and Cup
odds), and four decimals (0.01 pp) is finer than anything on screen. Game
updates get the same treatment: mostly just the clock moves.
"""

from __future__ import annotations

import gzip
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

PLACES = 4


def _round(o: dict[str, Any]) -> dict[str, Any]:
    return {k: round(v, PLACES) if isinstance(v, float) else v for k, v in o.items()}


def compact(bundle: dict[str, Any]) -> dict[str, Any]:
    """Round odds and win chances, and keep only the fields each frame changed."""
    initial = bundle["initial"]
    initial["odds"] = [_round(o) for o in initial["odds"]]
    last = {o["team"]: o for o in initial["odds"]}
    last_run = None
    games = {g["id"]: g for g in initial["games"]}
    frames = []
    for f in bundle["frames"]:
        msg = f["message"]
        if msg["type"] == "odds_update":
            changed = []
            for o in map(_round, msg["odds"]):
                prev = last.get(o["team"], {})
                diff = {k: v for k, v in o.items() if prev.get(k) != v}
                if diff:
                    last[o["team"]] = o
                    changed.append({"team": o["team"], **diff})
            if not changed and msg.get("sim_run_id") == last_run:
                continue
            last_run = msg.get("sim_run_id")
            msg["odds"] = changed
        elif msg["type"] == "game_update":
            game = _round(msg["game"])
            if game.get("wp"):
                game["wp"] = _round(game["wp"])
            prev = games.get(game["id"], {})
            msg["game"] = {"id": game["id"]} | {k: v for k, v in game.items() if prev.get(k) != v}
            games[game["id"]] = game
        frames.append(f)
    bundle["frames"] = frames
    return bundle


@lru_cache(maxsize=8)
def _compacted(path: Path, mtime_ns: int) -> bytes:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        data = json.load(fh)
    body = json.dumps(compact(data), separators=(",", ":")).encode()
    return gzip.compress(body, compresslevel=6)


def compacted_bytes(path: Path) -> bytes | None:
    """The gzipped, compacted bundle at path; cached until the file changes."""
    try:
        mtime = path.stat().st_mtime_ns
    except FileNotFoundError:
        return None
    return _compacted(path, mtime)
