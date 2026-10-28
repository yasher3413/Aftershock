"""Roster moves as changes to team ratings.

A team's goals for and against per game are summed over its lineup from the
player values (``ml/player_value.py``): five on five impact times even
strength minutes, finishing times shots, and goalies' saves above expected
times their share of the net. A move changes who is in the lineup; minutes
are reassigned by rank, so a team keeps the same minutes to hand out: its
forwards are ranked by their usual even strength minutes and the k-th gets
the minutes its k-th forward had (twelve forwards and six defence dress).
A slot nobody fills goes to a replacement-level player. The change in goals
becomes a change in the log ratings of ``ml/strength.py``:
``d_off = ln(1 + dGF / league_avg)`` and ``d_def = ln(1 + dGA / league_avg)``.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, replace
from datetime import date, timedelta

import numpy as np

from aftershock.ml.player_value import PlayerValue

WEEKS = (1, 2, 4, 6, 8)
MAX_MOVES = 20
SLOTS = {"F": 12, "D": 6}
LIMITS = {"F": (12, 14), "D": (6, 8), "G": (2, 3)}
NOUNS = {
    "F": ("forward", "forwards"),
    "D": ("defenceman", "defencemen"),
    "G": ("goalie", "goalies"),
}
# Unblocked attempts a team faces per game, the shots a goalie's GSAx per
# shot applies to: 42.8 per team-game over 400 games of 2025-26.
SHOTS_AGAINST_PG = 43.0
MIN_GAMES_FOR_LEVEL = 20
# The values cover five on five, finishing, and goaltending, not the power
# play, penalties, or faceoffs, so they understate a whole player. One scale
# brings the top five skaters to about 9 standings points over 82 games, in
# line with public player-value models (docs/DECISIONS.md, 2026-10-28).
VALUE_SCALE = 1.48


@dataclass(frozen=True)
class Spot:
    player_id: int
    team: str
    position: str  # F, D, or G
    in_lineup: bool
    ev_toi_pg: float
    pp_toi_pg: float
    toi_share: float  # goalies


@dataclass(frozen=True)
class Trade:
    player_id: int
    to: str


@dataclass(frozen=True)
class Injury:
    player_id: int
    weeks: int | None  # None: the rest of the season


@dataclass(frozen=True)
class Sign:
    player_id: int
    to: str


Move = Trade | Injury | Sign


@dataclass(frozen=True)
class Window:
    """A team's rating change over [start, end); end None runs to the end."""

    team: str
    start: date
    end: date | None
    d_off: float
    d_def: float


_PART = re.compile(r"^(?:([ts])(\d{1,8})-([A-Z]{3})|i(\d{1,8})-([0-9]))$")


def parse_moves(encoded: str) -> list[Move]:
    parts = encoded.split("_") if encoded else []
    if not parts:
        raise ValueError("No moves.")
    if len(parts) > MAX_MOVES:
        raise ValueError(f"At most {MAX_MOVES} moves.")
    out: list[Move] = []
    for part in parts:
        m = _PART.match(part)
        if m is None:
            raise ValueError(f"Bad move {part!r}.")
        if m.group(1):
            pid, team = int(m.group(2)), m.group(3)
            out.append(Trade(pid, team) if m.group(1) == "t" else Sign(pid, team))
        else:
            weeks = int(m.group(5))
            if weeks and weeks not in WEEKS:
                raise ValueError(f"Bad injury length {weeks}.")
            out.append(Injury(int(m.group(4)), weeks or None))
    ids = [mv.player_id for mv in out]
    if len(set(ids)) != len(ids):
        raise ValueError("A player can only move once.")
    return sorted(out, key=_code)


def _code(mv: Move) -> str:
    if isinstance(mv, Trade):
        return f"t{mv.player_id}-{mv.to}"
    if isinstance(mv, Sign):
        return f"s{mv.player_id}-{mv.to}"
    return f"i{mv.player_id}-{mv.weeks or 0}"


def encode_moves(moves: list[Move]) -> str:
    return "_".join(sorted(_code(m) for m in moves))


def _team_of(rosters: dict[str, list[Spot]], pid: int) -> str | None:
    for team, spots in rosters.items():
        if any(s.player_id == pid for s in spots):
            return team
    return None


def check_shape(
    rosters: dict[str, list[Spot]],
    moves: list[Move],
    values: dict[int, PlayerValue] | None = None,
) -> str | None:
    """The first roster limit the moves break, in words. A limit a team
    already breaks today only counts if the moves make it worse."""
    pos = {s.player_id: s.position for spots in rosters.values() for s in spots}
    before = {t: Counter(s.position for s in spots) for t, spots in rosters.items()}
    after = {t: Counter(c) for t, c in before.items()}
    for mv in moves:
        if isinstance(mv, Trade):
            frm = _team_of(rosters, mv.player_id)
            p = pos.get(mv.player_id)
            if frm and p:
                after[frm][p] -= 1
                after.setdefault(mv.to, Counter())[p] += 1
    for mv in moves:
        if isinstance(mv, Sign):
            v = (values or {}).get(mv.player_id)
            p = pos.get(mv.player_id) or (v.position if v else "F")
            after.setdefault(mv.to, Counter())[p] += 1
    for low in (True, False):  # a shortage is the clearer message
        for team in sorted(after):
            for p, (lo, hi) in LIMITS.items():
                n, was = after[team][p], before.get(team, Counter())[p]
                noun = NOUNS[p][0 if n == 1 else 1]
                if low and n < lo and n < was:
                    return f"{team} would have {n} {noun}; a team needs at least {lo}."
                if not low and n > hi and n > was:
                    return f"{team} would have {n} {noun}; a team can carry at most {hi}."
    return None


def replacement(values: dict[int, PlayerValue], position: str) -> PlayerValue:
    """A replacement-level player: the lower quartile of regulars."""
    pool = [v for v in values.values() if v.position == position and v.games >= MIN_GAMES_FOR_LEVEL]
    if not pool:
        return PlayerValue(-1, position)
    return PlayerValue(
        -1,
        position,
        off60=float(np.percentile([v.off60 for v in pool], 25)),
        def60=float(np.percentile([v.def60 for v in pool], 75)),
        gsax_per_shot=float(np.percentile([v.gsax_per_shot for v in pool], 25)),
    )


def _lineups(
    rosters: dict[str, list[Spot]],
    values: dict[int, PlayerValue],
    moves: list[Move],
) -> dict[str, list[Spot]]:
    """Each team's dressing players after the moves; newcomers are last in
    their group, so incumbents keep their order among equals."""
    out = {t: [s for s in spots if s.in_lineup] for t, spots in rosters.items()}
    spot = {s.player_id: s for spots in rosters.values() for s in spots}
    for mv in moves:
        if isinstance(mv, Injury | Trade):
            for t in out:
                out[t] = [s for s in out[t] if s.player_id != mv.player_id]
        if isinstance(mv, Trade) and mv.player_id in spot:
            out.setdefault(mv.to, []).append(replace(spot[mv.player_id], team=mv.to, toi_share=-1))
        if isinstance(mv, Sign) and mv.player_id in values:
            v = values[mv.player_id]
            out.setdefault(mv.to, []).append(
                Spot(v.player_id, mv.to, v.position, True, v.ev_toi_pg, v.pp_toi_pg, -1)
            )
    return out


def team_goals(
    lineup: list[Spot], slots: list[Spot], values: dict[int, PlayerValue]
) -> tuple[float, float]:
    """Goals for and against per game from a lineup, handing out the minutes
    and net shares of ``slots`` (the team's lineup today)."""
    gf = ga = 0.0
    for p in ("F", "D"):
        mins = sorted((s.ev_toi_pg for s in slots if s.position == p), reverse=True)[: SLOTS[p]]
        players = sorted((s for s in lineup if s.position == p), key=lambda s: -s.ev_toi_pg)
        repl = replacement(values, p)
        for k, m in enumerate(mins):
            if k < len(players):
                s = players[k]
                v = values.get(s.player_id, repl)
                pp = s.pp_toi_pg
            else:
                v, pp = repl, 0.0
            gf += v.off60 * m / 60 + v.finish_per_shot * v.shots_per60 * (m + pp) / 60
            ga += v.def60 * m / 60
    gf, ga = VALUE_SCALE * gf, VALUE_SCALE * ga  # skaters only: GSAx is already whole
    shares = sorted((s.toi_share for s in slots if s.position == "G"), reverse=True)
    incumbents = sorted(
        (s for s in lineup if s.position == "G" and s.toi_share >= 0), key=lambda s: -s.toi_share
    )
    order: list[PlayerValue] = [
        values.get(s.player_id, replacement(values, "G")) for s in incumbents
    ]
    for s in lineup:
        if s.position == "G" and s.toi_share < 0:
            v = values.get(s.player_id, replacement(values, "G"))
            starter = order[0].gsax_per_shot if order else -math.inf
            order.insert(0 if v.gsax_per_shot > starter else min(1, len(order)), v)
    repl_g = replacement(values, "G")
    for k, share in enumerate(shares):
        v = order[k] if k < len(order) else repl_g
        ga -= v.gsax_per_shot * SHOTS_AGAINST_PG * share
    return gf, ga


def team_deltas(
    moves: list[Move],
    rosters: dict[str, list[Spot]],
    values: dict[int, PlayerValue],
    league_avg: float,
    today: date,
) -> list[Window]:
    """Rating changes per team over time. An injury of ``w`` weeks covers
    ``[today, today + 7w)``; after it the team has him back."""
    ends = sorted(
        {today + timedelta(days=7 * m.weeks) for m in moves if isinstance(m, Injury) and m.weeks}
    )
    bounds = [today, *ends]
    today_lineups = {t: [s for s in spots if s.in_lineup] for t, spots in rosters.items()}
    base = {t: team_goals(lu, lu, values) for t, lu in today_lineups.items()}
    out: list[Window] = []
    for i, start in enumerate(bounds):
        end = bounds[i + 1] if i + 1 < len(bounds) else None
        active = [
            m
            for m in moves
            if not isinstance(m, Injury)
            or m.weeks is None
            or today + timedelta(days=7 * m.weeks) > start
        ]
        for team, lineup in sorted(_lineups(rosters, values, active).items()):
            if team not in base:
                continue
            gf, ga = team_goals(lineup, today_lineups[team], values)
            d_gf, d_ga = gf - base[team][0], ga - base[team][1]
            if abs(d_gf) < 1e-9 and abs(d_ga) < 1e-9:
                continue
            w = Window(
                team,
                start,
                end,
                math.log(1 + d_gf / league_avg),
                math.log(1 + d_ga / league_avg),
            )
            prev = next((x for x in reversed(out) if x.team == team), None)
            if prev and prev.end == start and (prev.d_off, prev.d_def) == (w.d_off, w.d_def):
                out[out.index(prev)] = replace(prev, end=end)
            else:
                out.append(w)
    return sorted(out, key=lambda w: (w.team, w.start))
