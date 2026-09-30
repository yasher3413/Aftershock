"""Export compact gold-test fixtures for the Rust standings engine.

For each validated season this writes ``tests/fixtures/gold/{season}.json.gz``
with every regular-season result (teams, final score including the shootout
goal, how the game ended, date), each team's conference and division that
season, the official final standings order from the NHL API, and the actual
first-round playoff matchups. These are compact facts derived from the API,
not raw dumps.

Usage (from services/): uv run python ../scripts/export_gold.py
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import Any

from aftershock.config import REPO_ROOT, get_settings

VALIDATED = [20152016, 20162017, 20172018, 20182019, 20212022, 20222023, 20232024, 20242025,
             20252026]
OUT = REPO_ROOT / "tests" / "fixtures" / "gold"


def read(path: Path) -> Any:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def standings_end(season: int) -> str:
    """The final standings date for a season, from the committed sample."""
    sample = REPO_ROOT / "tests" / "fixtures" / "nhl" / "standings_season.json.gz"
    seasons = read(sample)["seasons"]
    for row in seasons:
        if int(row["id"]) == season:
            return str(row["standingsEnd"])
    raise KeyError(season)


def export(season: int) -> dict[str, Any]:
    raw = get_settings().raw_cache_dir
    end = standings_end(season)
    standings = read(raw / "standings" / f"{end}.json.gz")["standings"]
    teams = sorted(
        (
            {
                "abbrev": r["teamAbbrev"]["default"],
                "conference": r["conferenceName"],
                "division": r["divisionName"],
            }
            for r in standings
        ),
        key=lambda t: t["abbrev"],
    )
    games: dict[int, dict[str, Any]] = {}
    for t in teams:
        body = read(raw / "club-schedule-season" / f"{t['abbrev']}-{season}.json.gz")
        for g in body["games"]:
            if g["gameType"] in (2, 3):
                games.setdefault(int(g["id"]), g)
    results = []
    round1: dict[int, list[str]] = {}
    for gid, g in sorted(games.items()):
        home, away = g["homeTeam"]["abbrev"], g["awayTeam"]["abbrev"]
        if g["gameType"] == 3:
            code = str(gid)[-4:]  # 0RSG: round, series, game
            if code[1] == "1" and code[3] == "1":
                round1[int(code[2])] = [home, away]
            continue
        results.append(
            {
                "id": gid,
                "date": g["gameDate"],
                "home": home,
                "away": away,
                "home_goals": int(g["homeTeam"]["score"]),
                "away_goals": int(g["awayTeam"]["score"]),
                "end": g["gameOutcome"]["lastPeriodType"],
            }
        )
    official = sorted(
        (
            {
                "abbrev": r["teamAbbrev"]["default"],
                "points": r["points"],
                "gp": r["gamesPlayed"],
                "w": r["wins"],
                "l": r["losses"],
                "otl": r["otLosses"],
                "rw": r.get("regulationWins") or 0,
                "row": r.get("regulationPlusOtWins") or 0,
                "gf": r["goalFor"],
                "ga": r["goalAgainst"],
                "league_seq": r["leagueSequence"],
                "conference_seq": r["conferenceSequence"],
                "division_seq": r["divisionSequence"],
                "wildcard_seq": r.get("wildcardSequence") or 0,
                "clinch": r.get("clinchIndicator"),
            }
            for r in standings
        ),
        key=lambda r: r["league_seq"],
    )
    return {
        "season": season,
        "standings_date": end,
        "tiebreak": "nhl-2019" if season >= 20192020 else "nhl-2010",
        "teams": teams,
        "results": results,
        "official": official,
        "round1": [round1[k] for k in sorted(round1)],
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for season in VALIDATED:
        data = export(season)
        path = OUT / f"{season}.json.gz"
        with gzip.open(path, "wt", encoding="utf-8") as fh:
            json.dump(data, fh, separators=(",", ":"))
        print(
            f"{season}: {len(data['results'])} results, {len(data['teams'])} teams, "
            f"{len(data['round1'])} round-1 series, {path.stat().st_size} bytes"
        )


if __name__ == "__main__":
    main()
