"""Build small, trimmed real API samples for tests from the raw cache.

Usage (from services/): uv run python ../scripts/make_fixtures.py
Writes gzipped JSON under tests/fixtures/nhl/. Media URLs, broadcast lists,
and headshots are dropped since tests never read them.
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import Any

from aftershock.config import REPO_ROOT, get_settings

OUT = REPO_ROOT / "tests" / "fixtures" / "nhl"
DROP_TOP = {"tvBroadcasts", "summary", "oddsPartners"}
DROP_DETAIL_PREFIX = ("highlightClip", "discreteClip")

PBP = {
    "regulation_en": 2025020002,
    "overtime": 2025020008,
    "shootout": 2025020006,
    "penalty_shot": 2025020182,
    "overturned_goal": 2025020016,
    "legacy_2015": 2015020001,
}


def trim(obj: Any) -> Any:
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if k in DROP_TOP or k.startswith(DROP_DETAIL_PREFIX):
                continue
            if k in {"pptReplayUrl", "headshot", "logo", "darkLogo", "teamLogo"}:
                continue
            out[k] = trim(v)
        return out
    if isinstance(obj, list):
        return [trim(v) for v in obj]
    return obj


def write(name: str, body: Any) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.json.gz"
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump(trim(body), fh, separators=(",", ":"))
    print(f"{path.relative_to(REPO_ROOT)}: {path.stat().st_size} bytes")


def main() -> None:
    raw = get_settings().raw_cache_dir
    for name, gid in PBP.items():
        with gzip.open(raw / "play-by-play" / f"{gid}.json.gz", "rt") as fh:
            write(f"pbp_{name}", json.load(fh))
    probe = REPO_ROOT / "data" / "probe"
    extra = {
        "score_2026-09-29": "score_0929.json",
        "schedule_2026-09-30": "sched.json",
        "standings_2026-09-29": "standings_now.json",
        "standings_2026-04-16": "standings_2026-04-16.json",
        "standings_season": "standings-season.json",
        "club_schedule_TOR_20262027": "club-schedule-season_TOR_20262027.json",
    }
    for name, fname in extra.items():
        write(name, json.loads((probe / fname).read_text()))


if __name__ == "__main__":
    main()
