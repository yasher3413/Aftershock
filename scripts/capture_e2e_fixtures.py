"""Record real API responses for the Playwright tests.

Usage: python3 scripts/capture_e2e_fixtures.py [api_base]
Needs a running API with the 2025-26 precompute loaded. The state is
switched to demo mode on a fixed night so the tests are deterministic.
"""

from __future__ import annotations

import gzip
import json
import sys
import urllib.request
from pathlib import Path

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
OUT = Path(__file__).resolve().parents[1] / "web" / "e2e" / "fixtures"
NIGHT = "2025-10-16"


def get(path: str) -> object:
    with urllib.request.urlopen(f"{BASE}{path}") as resp:
        raw = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return json.loads(raw)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    state = get("/api/state")
    assert isinstance(state, dict)
    state["mode"] = "demo"
    state["replay"] = {
        "night_date": NIGHT,
        "season": 20252026,
        "speed": 20,
        "next_live_utc": None,
    }
    fixtures = {
        "state": state,
        "replay": get(f"/api/replay/{NIGHT}"),
        "team-MTL": get("/api/teams/MTL"),
        "whatif": get("/api/whatif/bootstrap"),
        "methodology": get("/api/methodology"),
        # A night with no replay yet shows its schedule instead.
        "games-2026-09-30": get("/api/games?date=2026-09-30"),
        "nights-20252026": get("/api/replay/nights?season=20252026"),
        "player-8481540": get("/api/players/8481540"),
    }
    for name, body in fixtures.items():
        path = OUT / f"{name}.json.gz"
        with gzip.open(path, "wt", encoding="utf-8") as fh:
            fh.write(json.dumps(body, separators=(",", ":")))
        print(name, path.stat().st_size)


if __name__ == "__main__":
    main()
