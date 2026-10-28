"""Five-on-five stints and ice time from NHL shift charts.

A stint is a stretch of a game with the same ten skaters and both goalies
on the ice. The player value model regresses each stint's shot quality on
who was on the ice. A moment ``t`` in a period belongs to the stint with
``start < t <= end``, the rule ``jobs/onice.py`` uses for goals.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterator
from dataclasses import dataclass
from itertools import pairwise
from typing import Any

from aftershock.nhl.parse import mmss_to_seconds

SHIFT = 517


@dataclass(frozen=True)
class Shot:
    """An unblocked shot attempt, from the play-by-play."""

    event_id: int
    period: int
    t_period_s: int
    team: str
    goal: bool


@dataclass(frozen=True)
class Stint:
    game_id: int
    dur_s: int
    home: tuple[int, ...]
    away: tuple[int, ...]
    home_xg: float
    away_xg: float
    home_goals: int
    away_goals: int


@dataclass
class PlayerToi:
    team: str
    ev_s: int = 0
    pp_s: int = 0
    total_s: int = 0


@dataclass(frozen=True)
class _Segment:
    period: int
    start: int
    end: int
    on: dict[str, frozenset[int]]  # team to skaters
    goalies: frozenset[int]


def _segments(shifts: list[dict[str, Any]], goalies: set[int]) -> Iterator[_Segment]:
    """Stretches of each period with nobody changing, in order."""
    by_period: dict[int, list[tuple[int, int, int, str]]] = defaultdict(list)
    for s in shifts:
        if s.get("typeCode") != SHIFT:
            continue
        start = mmss_to_seconds(s.get("startTime"))
        end = mmss_to_seconds(s.get("endTime"))
        if end > start:
            row = (start, end, int(s["playerId"]), str(s["teamAbbrev"]))
            by_period[int(s["period"])].append(row)
    for period in sorted(by_period):
        rows = by_period[period]
        points = sorted({t for r in rows for t in r[:2]})
        starts: dict[int, list[tuple[int, str]]] = defaultdict(list)
        ends: dict[int, list[tuple[int, str]]] = defaultdict(list)
        for start, end, pid, team in rows:
            starts[start].append((pid, team))
            ends[end].append((pid, team))
        on: dict[tuple[int, str], int] = defaultdict(int)  # a player can have overlapping rows
        for a, b in pairwise(points):
            for key in ends.get(a, ()):
                on[key] -= 1
            for key in starts.get(a, ()):
                on[key] += 1
            teams: dict[str, set[int]] = defaultdict(set)
            gs: set[int] = set()
            for (pid, team), n in on.items():
                if n <= 0:
                    continue
                if pid in goalies:
                    gs.add(pid)
                else:
                    teams[team].add(pid)
            yield _Segment(period, a, b, {t: frozenset(p) for t, p in teams.items()}, frozenset(gs))


def build_stints(
    game_id: int,
    shifts: list[dict[str, Any]],
    shots: list[Shot],
    xg: dict[int, float],
    home: str,
    goalies: set[int],
) -> list[Stint]:
    """Five-on-five stints with both goalies in, merged where nobody changed."""
    teams = {str(s["teamAbbrev"]) for s in shifts if s.get("typeCode") == SHIFT}
    away = next((t for t in teams if t != home), "")
    out: list[Stint] = []
    shots_by_period: dict[int, list[Shot]] = defaultdict(list)
    for sh in shots:
        shots_by_period[sh.period].append(sh)
    prev_key: tuple[int, tuple[int, ...], tuple[int, ...]] | None = None
    prev_end = -1
    for seg in _segments(shifts, goalies):
        h, a = seg.on.get(home, frozenset()), seg.on.get(away, frozenset())
        if len(h) != 5 or len(a) != 5 or len(seg.goalies) != 2:
            prev_key = None
            continue
        hx = ax = 0.0
        hg = ag = 0
        for sh in shots_by_period.get(seg.period, ()):
            if seg.start < sh.t_period_s <= seg.end:
                x = xg.get(sh.event_id, 0.0)
                if sh.team == home:
                    hx += x
                    hg += sh.goal
                else:
                    ax += x
                    ag += sh.goal
        key = (seg.period, tuple(sorted(h)), tuple(sorted(a)))
        if key == prev_key and seg.start == prev_end:
            last = out[-1]
            out[-1] = Stint(
                game_id,
                last.dur_s + seg.end - seg.start,
                last.home,
                last.away,
                last.home_xg + hx,
                last.away_xg + ax,
                last.home_goals + hg,
                last.away_goals + ag,
            )
        else:
            out.append(Stint(game_id, seg.end - seg.start, key[1], key[2], hx, ax, hg, ag))
        prev_key, prev_end = key, seg.end
    return out


def toi(shifts: list[dict[str, Any]], goalies: set[int]) -> dict[int, PlayerToi]:
    """Each skater's ice time: even strength (equal skaters a side), power
    play (more skaters than the other side), and total."""
    out: dict[int, PlayerToi] = {}
    for seg in _segments(shifts, goalies):
        dur = seg.end - seg.start
        counts = {t: len(p) for t, p in seg.on.items()}
        for team, players in seg.on.items():
            others = [n for t, n in counts.items() if t != team]
            them = others[0] if others else 0
            for pid in players:
                rec = out.setdefault(pid, PlayerToi(team))
                rec.total_s += dur
                if counts[team] == them:
                    rec.ev_s += dur
                elif counts[team] > them:
                    rec.pp_s += dur
    return out
