"""Event sources: live polling and historical replay share one interface.

A source yields ``Snapshot`` objects: a play-by-play document for one game as
it looked at a moment. ``LiveSource`` polls the NHL API. ``ReplaySource``
rebuilds what the feed would have shown at each moment of a finished game,
using a calibrated mapping from game time to wall time. Everything
downstream (diffing, win probability, simulations, tremors) is identical.
"""

from __future__ import annotations

import asyncio
import copy
import heapq
from collections.abc import AsyncIterator, Iterable, Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

import structlog

from aftershock.nhl.client import NhlApiError, NhlClient
from aftershock.nhl.parse import (
    KNOWN_STATES,
    LIVE_STATES,
    REG_PERIOD_S,
    game_seconds,
    mmss_to_seconds,
    parse_datetime,
)

log = structlog.get_logger(__name__)

# Wall-clock model for replays: an average regulation game (60 minutes of
# play plus two 18-minute intermissions) takes about 2.5 hours.
INTERMISSION_S = 18 * 60
REG_OT_BREAK_S = 90
WALL_PER_GAME_S = (2.5 * 3600 - 2 * INTERMISSION_S) / 3600  # 1.9
SHOOTOUT_ATTEMPT_S = 45


@dataclass(frozen=True)
class Snapshot:
    game_id: int
    raw: dict[str, Any]
    at: datetime  # wall-clock time the snapshot represents


class EventSource(Protocol):
    def snapshots(self) -> AsyncIterator[Snapshot]: ...


# ----------------------------------------------------------------------
# Replay


def wall_offset_s(
    period: int, period_type: str, t_period_s: int, game_type: int, so_index: int = 0
) -> float:
    """Seconds after puck drop at which a moment of the game happened."""
    if period_type == "SO":
        reg_and_ot = 3 * REG_PERIOD_S * WALL_PER_GAME_S + 2 * INTERMISSION_S
        return (
            reg_and_ot
            + REG_OT_BREAK_S
            + 300 * WALL_PER_GAME_S
            + 120
            + so_index * SHOOTOUT_ATTEMPT_S
        )
    played = game_seconds(period, period_type, t_period_s, game_type)
    breaks = min(period - 1, 2) * INTERMISSION_S
    if period >= 4:
        breaks += (period - 3) * (INTERMISSION_S if game_type == 3 else REG_OT_BREAK_S)
    return played * WALL_PER_GAME_S + breaks


@dataclass
class ReplayGame:
    """Rebuilds partial snapshots of one finished game."""

    final: dict[str, Any]
    start: datetime = field(init=False)
    plays: list[dict[str, Any]] = field(init=False)
    offsets: list[float] = field(init=False)

    def __post_init__(self) -> None:
        self.start = parse_datetime(self.final["startTimeUTC"])
        self.plays = sorted(self.final.get("plays", []), key=lambda p: p.get("sortOrder", 0))
        game_type = int(self.final["gameType"])
        so_index = 0
        offsets = []
        for p in self.plays:
            pd = p.get("periodDescriptor") or {}
            ptype = pd.get("periodType", "REG")
            if ptype == "SO" and p.get("typeDescKey") in (
                "goal",
                "shot-on-goal",
                "missed-shot",
                "failed-shot-attempt",
            ):
                so_index += 1
            offsets.append(
                wall_offset_s(
                    int(pd.get("number", 1)),
                    ptype,
                    mmss_to_seconds(p.get("timeInPeriod")),
                    game_type,
                    so_index,
                )
            )
        # Keep offsets non-decreasing in sort order.
        for i in range(1, len(offsets)):
            offsets[i] = max(offsets[i], offsets[i - 1])
        self.offsets = offsets

    @property
    def game_id(self) -> int:
        return int(self.final["id"])

    @property
    def end_offset_s(self) -> float:
        return (self.offsets[-1] if self.offsets else 0.0) + 60.0

    def at_index(self, n: int, *, finished: bool = False) -> dict[str, Any]:
        """The document as it looked after the first ``n`` plays."""
        doc = copy.deepcopy({k: v for k, v in self.final.items() if k != "plays"})
        shown = self.plays[:n]
        doc["plays"] = copy.deepcopy(shown)
        home = away = 0
        for p in shown:
            d = p.get("details") or {}
            pd = p.get("periodDescriptor") or {}
            if p.get("typeDescKey") == "goal" and pd.get("periodType") != "SO":
                home, away = int(d.get("homeScore", home)), int(d.get("awayScore", away))
        last = shown[-1] if shown else None
        if finished:
            return doc
        doc["gameState"] = "LIVE" if shown else "PRE"
        doc["homeTeam"] = {**doc["homeTeam"], "score": home}
        doc["awayTeam"] = {**doc["awayTeam"], "score": away}
        doc.pop("gameOutcome", None)
        if last is not None:
            pd = last.get("periodDescriptor") or {}
            doc["periodDescriptor"] = pd
            remaining = mmss_to_seconds(last.get("timeRemaining"))
            in_int = last.get("typeDescKey") == "period-end" and pd.get("periodType") == "REG"
            doc["clock"] = {
                "timeRemaining": last.get("timeRemaining", "20:00"),
                "secondsRemaining": remaining,
                "running": not in_int,
                "inIntermission": in_int,
            }
        return doc

    def frames(self) -> Iterator[tuple[float, dict[str, Any]]]:
        """(offset seconds, document) after each play, then the final document."""
        yield 0.0, self.at_index(0)
        for i, off in enumerate(self.offsets):
            yield off, self.at_index(i + 1)
        yield self.end_offset_s, self.at_index(len(self.plays), finished=True)


class ReplaySource:
    """Replays several finished games with their real start times overlapping.

    ``speed`` compresses wall time (1 = real time). ``sleep`` is injectable so
    precompute jobs can replay instantly.
    """

    def __init__(self, finals: Iterable[dict[str, Any]], *, speed: float = 0.0) -> None:
        self.games = [ReplayGame(f) for f in finals]
        self.speed = speed

    def timeline(self) -> Iterator[Snapshot]:
        heap: list[tuple[datetime, int, int, dict[str, Any]]] = []
        iters = {g.game_id: (g, g.frames()) for g in self.games}
        counter = 0
        for gid, (g, it) in iters.items():
            off, doc = next(it)
            heapq.heappush(heap, (g.start + timedelta(seconds=off), counter, gid, doc))
            counter += 1
        while heap:
            at, _, gid, doc = heapq.heappop(heap)
            yield Snapshot(gid, doc, at)
            g, it = iters[gid]
            nxt = next(it, None)
            if nxt is not None:
                off, ndoc = nxt
                heapq.heappush(heap, (g.start + timedelta(seconds=off), counter, gid, ndoc))
                counter += 1

    async def snapshots(self) -> AsyncIterator[Snapshot]:
        prev: datetime | None = None
        for snap in self.timeline():
            if self.speed > 0 and prev is not None:
                await asyncio.sleep(max(0.0, (snap.at - prev).total_seconds() / self.speed))
            prev = snap.at
            yield snap


# ----------------------------------------------------------------------
# Live


class LiveSource:
    """Polls the scoreboard and the play-by-play of active games."""

    def __init__(
        self,
        client: NhlClient,
        *,
        live_interval: float = 5.0,
        pregame_interval: float = 60.0,
        score_interval: float = 30.0,
    ) -> None:
        self.client = client
        self.live_interval = live_interval
        self.pregame_interval = pregame_interval
        self.score_interval = score_interval
        self.scoreboard: dict[int, dict[str, Any]] = {}
        self._next_poll: dict[int, float] = {}
        self._next_score = 0.0
        # Games we have polled while live, until we have delivered them final.
        self._watched: set[int] = set()

    async def refresh_scoreboard(self) -> dict[int, dict[str, Any]]:
        from zoneinfo import ZoneInfo

        boards = [await self.client.score()]
        today = datetime.now(ZoneInfo("America/New_York")).date()
        if boards[0].get("currentDate") != today.isoformat():
            try:
                boards.append(await self.client.score(today))
            except NhlApiError as exc:
                log.warning("live.score_today_failed", error=str(exc))
        games: dict[int, dict[str, Any]] = {}
        for b in boards:
            for g in b.get("games", []):
                state = g.get("gameState")
                if state not in KNOWN_STATES:
                    log.warning("live.unknown_state", game=g.get("id"), state=state)
                games[int(g["id"])] = g
        self.scoreboard = games
        return games

    def _interval(self, gid: int, state: str | None) -> float | None:
        if state in LIVE_STATES:
            return self.live_interval
        if state == "PRE":
            return self.pregame_interval
        if state in ("FINAL", "OFF") and gid in self._watched:
            # One more poll so the engine sees the final document.
            return self.live_interval
        return None

    async def snapshots(self) -> AsyncIterator[Snapshot]:
        loop = asyncio.get_running_loop()
        while True:
            now = loop.time()
            if now >= self._next_score:
                try:
                    await self.refresh_scoreboard()
                except NhlApiError as exc:
                    log.warning("live.scoreboard_failed", error=str(exc))
                self._next_score = now + self.score_interval
            due = []
            for gid, g in self.scoreboard.items():
                interval = self._interval(gid, g.get("gameState"))
                if interval is None:
                    continue
                if self._next_poll.get(gid, 0.0) <= now:
                    due.append(gid)
                    self._next_poll[gid] = now + interval
            results = await asyncio.gather(
                *(self.client.play_by_play(gid, use_cache=False) for gid in due),
                return_exceptions=True,
            )
            for gid, res in zip(due, results, strict=True):
                if isinstance(res, BaseException):
                    log.warning("live.pbp_failed", game=gid, error=str(res))
                    continue
                state = res.get("gameState")
                self.scoreboard[gid] = {**self.scoreboard[gid], "gameState": state}
                if state in ("FINAL", "OFF"):
                    self._watched.discard(gid)
                else:
                    self._watched.add(gid)
                yield Snapshot(gid, res, datetime.now(UTC))
            await asyncio.sleep(1.0)
