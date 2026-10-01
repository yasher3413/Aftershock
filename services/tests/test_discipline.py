from __future__ import annotations

from typing import Any

from aftershock.jobs.discipline import attribute, extract, strength

HOME, AWAY = 10, 20


def play(
    eid: int, kind: str, period: int, t: str, details: dict[str, Any], code: str = "1551"
) -> dict[str, Any]:
    return {
        "eventId": eid,
        "typeDescKey": kind,
        "periodDescriptor": {"number": period, "periodType": "REG"},
        "timeInPeriod": t,
        "situationCode": code,
        "details": details,
    }


def game(plays: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": 2025020001,
        "homeTeam": {"id": HOME, "abbrev": "HOM"},
        "awayTeam": {"id": AWAY, "abbrev": "AWY"},
        "plays": plays,
    }


def minor(
    eid: int, t: str, by: int, drawn: int, team: int = HOME, code: str = "MIN", dur: int = 2
) -> dict[str, Any]:
    return play(
        eid,
        "penalty",
        1,
        t,
        {
            "eventOwnerTeamId": team,
            "committedByPlayerId": by,
            "drawnByPlayerId": drawn,
            "typeCode": code,
            "descKey": "tripping",
            "duration": dur,
        },
    )


def goal(eid: int, t: str, team: int, code: str) -> dict[str, Any]:
    return play(eid, "goal", 1, t, {"eventOwnerTeamId": team}, code)


def costs(
    doc: dict[str, Any], ppa: dict[tuple[int, str], tuple[int, float]]
) -> dict[tuple[int, str], Any]:
    rows, goals = extract(doc, 20252026)
    attribute(rows, goals, ppa)
    return {(r["event_id"], r["kind"]): (r.get("tremor_id"), r.get("ppa")) for r in rows}


def test_strength_reads_the_situation_code() -> None:
    assert strength("1541", scoring_home=False) == 1  # away on the power play
    assert strength("1541", scoring_home=True) == -1  # home shorthanded
    assert strength("1551", scoring_home=True) == 0
    assert strength("0651", scoring_home=False) == 0  # pulled goalie is not a power play
    assert strength("1010", scoring_home=True) is None  # penalty shot


def test_a_minor_is_charged_for_its_first_power_play_goal_only() -> None:
    doc = game(
        [
            minor(1, "10:00", by=7, drawn=8),
            goal(2, "11:00", AWAY, "1541"),
            goal(3, "11:30", AWAY, "1541"),  # a second penalty-free power play, not this minor
        ]
    )
    out = costs(doc, {(2, "HOM"): (100, -0.03), (2, "AWY"): (100, 0.02), (3, "HOM"): (101, -0.01)})
    assert out[(1, "penalty")] == (100, -0.03)
    assert out[(1, "drawn")] == (100, 0.02)


def test_a_major_is_charged_for_every_goal_during_it() -> None:
    doc = game(
        [
            minor(1, "10:00", by=7, drawn=8, code="MAJ", dur=5),
            goal(2, "11:00", AWAY, "1541"),
            goal(3, "13:00", AWAY, "1541"),
        ]
    )
    out = costs(doc, {(2, "HOM"): (100, -0.03), (3, "HOM"): (101, -0.01)})
    assert out[(1, "penalty")][1] == -0.04


def test_coincidental_minors_are_not_charged() -> None:
    doc = game([minor(1, "10:00", by=7, drawn=8), goal(2, "11:00", AWAY, "1441")])
    assert costs(doc, {(2, "HOM"): (100, -0.03)})[(1, "penalty")] == (None, None)


def test_a_giveaway_is_costly_when_the_other_team_scores_within_ten_seconds() -> None:
    doc = game(
        [
            play(1, "giveaway", 1, "05:00", {"eventOwnerTeamId": HOME, "playerId": 7}),
            goal(2, "05:08", AWAY, "1551"),
            play(3, "giveaway", 1, "06:00", {"eventOwnerTeamId": HOME, "playerId": 7}),
            goal(4, "06:30", AWAY, "1551"),
            play(5, "takeaway", 1, "07:00", {"eventOwnerTeamId": AWAY, "playerId": 9}),
        ]
    )
    out = costs(doc, {(2, "HOM"): (100, -0.02), (4, "HOM"): (101, -0.02)})
    assert out[(1, "giveaway")] == (100, -0.02)
    assert out[(3, "giveaway")] == (None, None)
    assert out[(5, "takeaway")] == (None, None)
