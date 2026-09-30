"""Diff successive play-by-play snapshots of one game.

The live feed is not append-only. Events are inserted, edited (scorer and
assist corrections, coordinate fixes), and removed (a goal overturned by a
coach's challenge or video review). ``GameDiffer`` keeps the last known
version of every event by ``eventId`` and content hash and turns each new
snapshot into typed changes.

The top-level score is the source of truth. When it disagrees with the goal
events, the differ reports a discrepancy so the caller can log it and trust
the score until the next poll reconciles.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from aftershock.ingest.load import content_hash
from aftershock.nhl.parse import GameMeta, Play, parse_meta, parse_play

ATTRIBUTION_FIELDS = ("scoringPlayerId", "assist1PlayerId", "assist2PlayerId", "goalieInNetId")


@dataclass(frozen=True)
class NewPlay:
    play: Play


@dataclass(frozen=True)
class ChangedPlay:
    play: Play
    previous: Play
    changed_fields: tuple[str, ...]

    @property
    def is_attribution_change(self) -> bool:
        return any(f in ATTRIBUTION_FIELDS for f in self.changed_fields)


@dataclass(frozen=True)
class RemovedPlay:
    play: Play


@dataclass(frozen=True)
class ScoreDiscrepancy:
    top_level: tuple[int, int]
    from_goals: tuple[int, int]


Change = NewPlay | ChangedPlay | RemovedPlay


@dataclass
class DiffResult:
    meta: GameMeta
    changes: list[Change] = field(default_factory=list)
    discrepancy: ScoreDiscrepancy | None = None
    state_changed: bool = False
    score_decreased: bool = False

    @property
    def new_goals(self) -> list[Play]:
        return [c.play for c in self.changes if isinstance(c, NewPlay) and c.play.type == "goal"]

    @property
    def removed_goals(self) -> list[Play]:
        return [
            c.play for c in self.changes if isinstance(c, RemovedPlay) and c.play.type == "goal"
        ]

    @property
    def changed_goals(self) -> list[ChangedPlay]:
        return [c for c in self.changes if isinstance(c, ChangedPlay) and c.play.type == "goal"]


def _details_diff(a: dict[str, Any], b: dict[str, Any]) -> tuple[str, ...]:
    keys = set(a) | set(b)
    return tuple(sorted(k for k in keys if a.get(k) != b.get(k)))


def _changed_fields(prev: Play, new: Play) -> tuple[str, ...]:
    fields: list[str] = []
    for top in ("typeDescKey", "timeInPeriod", "situationCode", "sortOrder", "periodDescriptor"):
        if prev.raw.get(top) != new.raw.get(top):
            fields.append(top)
    fields.extend(_details_diff(prev.raw.get("details") or {}, new.raw.get("details") or {}))
    return tuple(fields)


class GameDiffer:
    """Tracks one game's events across snapshots."""

    def __init__(self, game_id: int) -> None:
        self.game_id = game_id
        self.plays: dict[int, Play] = {}
        self.hashes: dict[int, str] = {}
        self.meta: GameMeta | None = None
        self._last_state_key: tuple[Any, ...] | None = None

    def apply(self, raw: dict[str, Any]) -> DiffResult:
        meta = parse_meta(raw)
        game_type = meta.game_type
        result = DiffResult(meta=meta)
        seen: set[int] = set()
        for rp in raw.get("plays", []):
            eid = int(rp["eventId"])
            seen.add(eid)
            h = content_hash(rp)
            if eid not in self.plays:
                play = parse_play(rp, game_type)
                self.plays[eid] = play
                self.hashes[eid] = h
                result.changes.append(NewPlay(play))
            elif self.hashes[eid] != h:
                prev = self.plays[eid]
                play = parse_play(rp, game_type)
                self.plays[eid] = play
                self.hashes[eid] = h
                result.changes.append(ChangedPlay(play, prev, _changed_fields(prev, play)))
        for eid in [e for e in self.plays if e not in seen]:
            result.changes.append(RemovedPlay(self.plays.pop(eid)))
            self.hashes.pop(eid, None)
        # A goal that changes into another event type (an overturned goal
        # becoming a shot) is a removal of the goal for scoring purposes.
        for c in list(result.changes):
            if isinstance(c, ChangedPlay) and c.previous.type == "goal" and c.play.type != "goal":
                result.changes.append(RemovedPlay(c.previous))
            if isinstance(c, ChangedPlay) and c.previous.type != "goal" and c.play.type == "goal":
                result.changes.append(NewPlay(c.play))
        result.changes.sort(key=_change_order)

        prev_meta = self.meta
        if prev_meta is not None:
            before = (prev_meta.home.score or 0) + (prev_meta.away.score or 0)
            after = (meta.home.score or 0) + (meta.away.score or 0)
            result.score_decreased = after < before
        state_key = (
            meta.state,
            meta.period,
            meta.period_type,
            meta.clock_seconds,
            meta.in_intermission,
            meta.home.score,
            meta.away.score,
            meta.home.sog,
            meta.away.sog,
        )
        result.state_changed = state_key != self._last_state_key
        self._last_state_key = state_key
        self.meta = meta

        home_goals = sum(
            1
            for p in self.plays.values()
            if p.type == "goal" and p.period_type != "SO" and p.owner_team_id == meta.home.id
        )
        away_goals = sum(
            1
            for p in self.plays.values()
            if p.type == "goal" and p.period_type != "SO" and p.owner_team_id == meta.away.id
        )
        top = (meta.home.score or 0, meta.away.score or 0)
        so_goal = meta.last_period_type == "SO" and meta.is_finished
        if top != (home_goals, away_goals) and not so_goal:
            result.discrepancy = ScoreDiscrepancy(top, (home_goals, away_goals))
        return result

    def goals(self) -> list[Play]:
        return sorted(
            (p for p in self.plays.values() if p.type == "goal"),
            key=lambda p: (p.sort_order, p.event_id),
        )


def _change_order(c: Change) -> tuple[int, int]:
    rank = 0 if isinstance(c, RemovedPlay) else 1
    return (rank, c.play.sort_order)
