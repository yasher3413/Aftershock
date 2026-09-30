"""WebSocket fan-out with gap filling.

The hub keeps the last 1,000 live messages. A client that reconnects with
``?since=<seq>`` gets every message after that sequence number. If its gap
is older than the buffer, it gets ``{"type": "resync"}`` and should refetch
``/api/state``.
"""

from __future__ import annotations

import asyncio
import json
from collections import deque
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

RING_SIZE = 1000
HEARTBEAT_S = 15.0

Send = Callable[[str], Awaitable[None]]


class Hub:
    def __init__(self, ring_size: int = RING_SIZE) -> None:
        self.ring: deque[dict[str, Any]] = deque(maxlen=ring_size)
        self.clients: dict[int, asyncio.Queue[str]] = {}
        self._next_id = 0
        self.mode = "live"
        self.state_version = 0

    @property
    def last_seq(self) -> int:
        return int(self.ring[-1]["seq"]) if self.ring else 0

    def load(self, messages: list[dict[str, Any]]) -> None:
        for m in sorted(messages, key=lambda m: int(m["seq"])):
            if int(m["seq"]) > self.last_seq:
                self.ring.append(m)

    def push(self, msg: dict[str, Any]) -> None:
        """Record a message from the worker and fan it out."""
        if int(msg["seq"]) <= self.last_seq:
            return
        self.ring.append(msg)
        if msg.get("type") == "hello":
            self.mode = str(msg.get("mode", self.mode))
            self.state_version = int(msg.get("state_version", self.state_version))
        raw = json.dumps(msg, separators=(",", ":"))
        for q in self.clients.values():
            if q.qsize() < 5000:
                q.put_nowait(raw)

    def backlog(self, since: int | None) -> list[str] | None:
        """Messages after ``since``, or None if the gap is too old to fill."""
        if since is None:
            return []
        if since >= self.last_seq:
            return []
        oldest = int(self.ring[0]["seq"]) if self.ring else 0
        if since < oldest - 1:
            return None
        return [json.dumps(m, separators=(",", ":")) for m in self.ring if int(m["seq"]) > since]

    def hello(self) -> str:
        now = datetime.now(UTC).isoformat()
        return json.dumps(
            {
                "type": "hello",
                "seq": self.last_seq,
                "ts": now,
                "mode": self.mode,
                "server_time": now,
                "state_version": self.state_version,
            },
            separators=(",", ":"),
        )

    def heartbeat(self) -> str:
        return json.dumps(
            {"type": "heartbeat", "seq": self.last_seq, "ts": datetime.now(UTC).isoformat()},
            separators=(",", ":"),
        )

    def connect(self) -> tuple[int, asyncio.Queue[str]]:
        cid = self._next_id
        self._next_id += 1
        q: asyncio.Queue[str] = asyncio.Queue()
        self.clients[cid] = q
        return cid, q

    def disconnect(self, cid: int) -> None:
        self.clients.pop(cid, None)

    async def serve(
        self, send: Send, since: int | None, *, heartbeat_s: float = HEARTBEAT_S
    ) -> None:
        """Stream to one client until ``send`` raises (the client left)."""
        cid, q = self.connect()
        try:
            await send(self.hello())
            backlog = self.backlog(since)
            if backlog is None:
                await send(json.dumps({"type": "resync", "seq": self.last_seq}))
            else:
                for raw in backlog:
                    await send(raw)
            while True:
                try:
                    raw = await asyncio.wait_for(q.get(), timeout=heartbeat_s)
                except TimeoutError:
                    raw = self.heartbeat()
                await send(raw)
        finally:
            self.disconnect(cid)
