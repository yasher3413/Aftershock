from __future__ import annotations

import gzip
import json

from aftershock.api import schemas as S
from aftershock.config import REPO_ROOT
from aftershock.tremors.clinch import clinch_status


def final_rows(season: int) -> tuple[list[S.StandingsRow], set[str]]:
    path = REPO_ROOT / "tests" / "fixtures" / "gold" / f"{season}.json.gz"
    with gzip.open(path, "rt") as fh:
        gold = json.load(fh)
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


def test_magic_number_appears_only_once_reachable() -> None:
    rows, _ = final_rows(20252026)
    # Opening day: 165 is more than the 164 points left, so no magic number.
    start = [r.model_copy(update={"gp": 0, "points": 0}) for r in rows]
    info = clinch_status(start, games_per_team=82)
    assert all(i.status == "alive" for i in info.values())
    assert all(i.magic_number is None for i in info.values())
    # Ten games from the end, alive teams that can still get there have one.
    late = [r.model_copy(update={"gp": r.gp - 10, "points": max(0, r.points - 12)}) for r in rows]
    late_info = clinch_status(late, games_per_team=82)
    shown = [i.magic_number for i in late_info.values() if i.magic_number is not None]
    assert shown and max(shown) <= 20


def test_tonight_scenarios_find_a_win_that_clinches() -> None:
    rows, _ = final_rows(20252026)
    # Rewind every team by two games; the best team's win would then clinch.
    rewound = [r.model_copy(update={"gp": r.gp - 2, "points": max(0, r.points - 2)}) for r in rows]
    best = max(rewound, key=lambda r: r.points)
    from aftershock.tremors.clinch import tonight_scenarios

    lines = tonight_scenarios(rewound, 82, [(best.team, "XXX")])
    info = clinch_status(rewound, 82)[best.team]
    if info.status == "alive":
        assert lines and lines[0].startswith(best.team)
    else:
        assert lines == []
