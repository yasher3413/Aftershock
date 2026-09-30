"""Clinch and elimination status, and playoff magic numbers.

These are certainties, not probabilities, so they only use points and treat
every tie as lost (tiebreakers are never assumed to help).

Clinched: at most four other conference teams can still reach the team's
current points. Then even if all four are in its division and pass it, the
team is at worst fifth in the division, and every team above it outside its
division's top three is one of those four: it is at worst the second wild
card. Any fifth rival breaks this, so four is the exact bound for a
points-only rule.

Eliminated: at least three division rivals already have more points than the
team's maximum, and at least eight conference teams do. Then it cannot finish
top three in its division, and at least two teams outside the top threes are
above it, so it cannot be a wild card.

Magic number: the combination of the team's own points and rivals' lost
points that clinches, i.e. one more than the fifth-highest maximum among
conference rivals, minus the team's current points.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from aftershock.api import schemas as S

Status = Literal["clinched", "eliminated", "alive"]


@dataclass(frozen=True)
class ClinchInfo:
    team: str
    status: Status
    magic_number: int | None
    max_points: int


def max_points(row: S.StandingsRow, games_per_team: int) -> int:
    return row.points + 2 * max(0, games_per_team - row.gp)


def clinch_status(rows: list[S.StandingsRow], games_per_team: int) -> dict[str, ClinchInfo]:
    out: dict[str, ClinchInfo] = {}
    for r in rows:
        conf = [o for o in rows if o.conference == r.conference and o.team != r.team]
        mx = max_points(r, games_per_team)
        rivals_max = sorted((max_points(o, games_per_team) for o in conf), reverse=True)
        can_reach = sum(1 for m in rivals_max if m >= r.points)
        div_above = sum(1 for o in conf if o.division == r.division and o.points > mx)
        conf_above = sum(1 for o in conf if o.points > mx)
        if can_reach <= 4:
            status: Status = "clinched"
        elif div_above >= 3 and conf_above >= 8:
            status = "eliminated"
        else:
            status = "alive"
        magic = None
        if status == "alive" and len(rivals_max) >= 5:
            magic = max(0, rivals_max[4] + 1 - r.points)
        out[r.team] = ClinchInfo(r.team, status, magic, mx)
    return out


def tonight_scenarios(
    rows: list[S.StandingsRow], games_per_team: int, tonight: list[tuple[str, str]]
) -> list[str]:
    """Plain-language clinch scenarios for teams playing tonight.

    For each team not yet clinched: does a win clinch? If not, does a win
    plus regulation losses by the rivals who play tonight clinch?
    """
    by_team = {r.team: r for r in rows}
    playing = {t for g in tonight for t in g}
    base = clinch_status(rows, games_per_team)
    out: list[str] = []
    for team in sorted(playing):
        r = by_team.get(team)
        if r is None or base[team].status != "alive":
            continue

        def after(win: bool, losers: set[str], team: str = team) -> Status:
            upd = []
            for o in rows:
                if o.team == team and win:
                    o = o.model_copy(update={"points": o.points + 2, "gp": o.gp + 1})
                elif o.team in losers:
                    o = o.model_copy(update={"gp": o.gp + 1})
                upd.append(o)
            return clinch_status(upd, games_per_team)[team].status

        if after(True, set()) == "clinched":
            out.append(f"{team} clinches a playoff spot with a win.")
            continue
        rivals = {
            t
            for t in playing
            if t != team and by_team.get(t) is not None and by_team[t].conference == r.conference
        }
        opponent = next((a if b == team else b for a, b in tonight if team in (a, b)), None)
        rivals.discard(opponent or "")
        if rivals and after(True, rivals) == "clinched":
            out.append(
                f"{team} clinches with a win and regulation losses by {', '.join(sorted(rivals))}."
            )
    return out
