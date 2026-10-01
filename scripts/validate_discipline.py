"""Check Aftershock's plus/minus, penalty minutes, giveaways, and takeaways
against the NHL's official regular-season totals, and record the match rates
in ml/reports/discipline.json.

Usage (from services/): uv run python ../scripts/validate_discipline.py 20252026
Three requests to the NHL stats API.
"""

from __future__ import annotations

import asyncio
import json
import sys

import httpx
from sqlalchemy import text

from aftershock.config import get_settings
from aftershock.db.session import session_scope

STATS = "https://api.nhle.com/stats/rest/en/skater/{report}?limit=-1&cayenneExp=seasonId={season}%20and%20gameTypeId=2"
UA = {"User-Agent": "aftershock (+https://github.com/yasher3413/Aftershock)"}


def match(ours: dict[int, int], theirs: dict[int, int]) -> dict[str, float | int]:
    common = [p for p in ours if p in theirs]
    exact = sum(ours[p] == theirs[p] for p in common)
    near = sum(abs(ours[p] - theirs[p]) <= 1 for p in common)
    return {
        "players": len(common),
        "exact": round(exact / max(len(common), 1), 4),
        "within_1": round(near / max(len(common), 1), 4),
    }


async def main(season: int) -> None:
    async with httpx.AsyncClient(headers=UA, timeout=30) as http:
        summary = (await http.get(STATS.format(report="summary", season=season))).json()["data"]
        realtime = (await http.get(STATS.format(report="realtime", season=season))).json()["data"]
    async with session_scope() as s:
        pm = dict(
            (
                await s.execute(
                    text("SELECT player_id, plus_minus FROM player_plus_minus WHERE season = :s"),
                    {"s": season},
                )
            ).all()
        )
        disc = (
            await s.execute(
                text(
                    "SELECT player_id, pim, giveaways, takeaways FROM player_discipline_season "
                    "WHERE season = :s"
                ),
                {"s": season},
            )
        ).all()
    result = {
        "plus_minus": match(pm, {r["playerId"]: r["plusMinus"] for r in summary}),
        "penalty_minutes": match(
            {r[0]: r[1] for r in disc}, {r["playerId"]: r["penaltyMinutes"] for r in summary}
        ),
        "giveaways": match(
            {r[0]: r[2] for r in disc}, {r["playerId"]: r["giveaways"] for r in realtime}
        ),
        "takeaways": match(
            {r[0]: r[3] for r in disc}, {r["playerId"]: r["takeaways"] for r in realtime}
        ),
    }
    path = get_settings().ml_dir / "reports" / "discipline.json"
    report = json.loads(path.read_text()) if path.exists() else {}
    report.setdefault("validation", {})[str(season)] = result
    path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    asyncio.run(main(int(sys.argv[1])))
