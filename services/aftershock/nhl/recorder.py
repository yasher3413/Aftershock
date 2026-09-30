"""Record live play-by-play responses as a time-ordered sequence.

The recordings show how events appear, get corrected, and disappear during a
real game. They drive the live-engine tests. Every distinct response (by
content hash) is saved gzipped under ``{out_dir}/{game_id}/``, named by a
sequence number and the UTC capture time.
"""

from __future__ import annotations

import asyncio
import gzip
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import structlog

from aftershock.nhl.client import NhlApiError, NhlClient

log = structlog.get_logger(__name__)

EASTERN = ZoneInfo("America/New_York")
LIVE_STATES = frozenset({"LIVE", "CRIT"})
WATCH_STATES = LIVE_STATES | {"PRE"}


def _digest(body: Any) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()


class LiveRecorder:
    def __init__(
        self,
        client: NhlClient,
        out_dir: Path,
        *,
        live_interval: float = 5.0,
        score_interval: float = 30.0,
    ) -> None:
        self.client = client
        self.out_dir = out_dir
        self.live_interval = live_interval
        self.score_interval = score_interval
        self._last_digest: dict[int, str] = {}
        self._seq: dict[int, int] = {}
        self._finished: set[int] = set()

    def _save(self, game_id: int, body: Any) -> bool:
        digest = _digest(body)
        if self._last_digest.get(game_id) == digest:
            return False
        self._last_digest[game_id] = digest
        seq = self._seq.get(game_id, 0) + 1
        self._seq[game_id] = seq
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S")
        game_dir = self.out_dir / str(game_id)
        game_dir.mkdir(parents=True, exist_ok=True)
        with gzip.open(game_dir / f"{seq:05d}_{stamp}.json.gz", "wt", encoding="utf-8") as fh:
            json.dump(body, fh, separators=(",", ":"))
        return True

    async def _active_games(self) -> list[int]:
        """Games to poll right now.

        ``/score/now`` keeps showing the previous hockey night until early
        morning, so when the Eastern calendar date has moved on we also check
        that date's scoreboard.
        """
        boards = [await self.client.score()]
        today_et = datetime.now(EASTERN).date()
        if boards[0].get("currentDate") != today_et.isoformat():
            try:
                boards.append(await self.client.score(today_et))
            except NhlApiError as exc:
                log.warning("recorder.score_today_failed", error=str(exc))
        active: list[int] = []
        for board in boards:
            for game in board.get("games", []):
                gid = int(game["id"])
                if game.get("gameState") in WATCH_STATES and gid not in active:
                    active.append(gid)
        return active

    async def run(self, until: datetime) -> None:
        log.info("recorder.start", until=until.isoformat(), out=str(self.out_dir))
        active: list[int] = []
        next_score = 0.0
        loop = asyncio.get_running_loop()
        while datetime.now(UTC) < until:
            if loop.time() >= next_score:
                try:
                    active = await self._active_games()
                except NhlApiError as exc:
                    log.warning("recorder.score_failed", error=str(exc))
                next_score = loop.time() + self.score_interval
                if active:
                    log.info("recorder.active", games=active)
            for gid in active:
                try:
                    body = await self.client.play_by_play(gid, use_cache=False)
                except NhlApiError as exc:
                    log.warning("recorder.pbp_failed", game=gid, error=str(exc))
                    continue
                if self._save(gid, body):
                    log.info(
                        "recorder.saved",
                        game=gid,
                        seq=self._seq[gid],
                        state=body.get("gameState"),
                        plays=len(body.get("plays", [])),
                    )
                if body.get("gameState") in {"FINAL", "OFF"} and gid not in self._finished:
                    self._finished.add(gid)
                    log.info("recorder.game_finished", game=gid)
            await asyncio.sleep(self.live_interval if active else self.score_interval)
        log.info("recorder.stop")
