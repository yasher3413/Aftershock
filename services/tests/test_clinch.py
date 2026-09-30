from __future__ import annotations

import gzip
import json

from aftershock.api import schemas as S
from aftershock.config import REPO_ROOT
from aftershock.tremors.clinch import clinch_status


def final_rows(season: int) -> tuple[list[S.StandingsRow], set[str]]:
    path = REPO_ROOT / "tests" / "fixtures" / "gold" / f"{season}.json.gz"
    gold = json.load(gzip.open(path, "rt"))
    teams = {t["abbrev"]: t for t in gold["teams"]}
    rows = []
    for o in gold["official"]:
        t = teams[o["abbrev"]]
        rows.append(
            S.StandingsRow(
                team=o["abbrev"],
                conference=t["conference"],
                division=t["division"],
                gp=o["gp"],
                w=o["w"],
                l=o["l"],
                otl=o["otl"],
                points=o["points"],
                points_pct=0.5,
                rw=o["rw"],
                row=o["row"],
                gf=o["gf"],
                ga=o["ga"],
                division_rank=o["division_seq"],
                conference_rank=o["conference_seq"],
                league_rank=o["league_seq"],
                wildcard_rank=o["wildcard_seq"] or None,
            )
        )
    made = {
        o["abbrev"]
        for o in gold["official"]
        if o["division_seq"] <= 3 or 1 <= o["wildcard_seq"] <= 2
    }
    return rows, made


def test_final_standings_never_contradict_reality() -> None:
    for season in (20212022, 20222023, 20232024, 20242025, 20252026):
        rows, made = final_rows(season)
        info = clinch_status(rows, games_per_team=82)
        clinched = {t for t, i in info.items() if i.status == "clinched"}
        eliminated = {t for t, i in info.items() if i.status == "eliminated"}
        assert clinched <= made, season
        assert not (eliminated & made), season
        # At the end of a season most teams are decided even by points alone.
        assert len(clinched) + len(eliminated) >= 20, season


def test_opening_day_everyone_is_alive_with_a_magic_number() -> None:
    rows, _ = final_rows(20252026)
    start = [r.model_copy(update={"gp": 0, "points": 0}) for r in rows]
    info = clinch_status(start, games_per_team=82)
    assert all(i.status == "alive" for i in info.values())
    assert all(i.magic_number == 165 for i in info.values())
