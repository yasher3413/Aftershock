"""Publish typed live messages to Redis.

The worker persists first, then publishes. Sequence numbers come from a
Redis counter so they are global and monotonic across restarts. The last
1,000 messages are also kept in a Redis list so any API instance can fill a
reconnecting client's gap. The latest full bootstrap state lives under
``aftershock:state``.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any, Protocol

from pydantic import BaseModel

CHANNEL = "aftershock:live"
SEQ_KEY = "aftershock:seq"
RING_KEY = "aftershock:ring"
STATE_KEY = "aftershock:state"
RING_SIZE = 1000


class RedisLike(Protocol):
    async def incr(self, name: str) -> int: ...
    async def lpush(self, name: str, *values: Any) -> int: ...
    async def ltrim(self, name: str, start: int, end: int) -> Any: ...
    async def publish(self, channel: str, message: Any) -> int: ...
    async def set(self, name: str, value: Any) -> Any: ...
    async def get(self, name: str) -> Any: ...
    async def lrange(self, name: str, start: int, end: int) -> list[Any]: ...


class Publisher:
    def __init__(self, redis: RedisLike) -> None:
        self.redis = redis

    async def publish(self, msg_type: str, payload: dict[str, Any] | BaseModel) -> dict[str, Any]:
        """Assign seq and ts, append to the ring, and broadcast. Returns the message."""
        body = payload.model_dump(mode="json") if isinstance(payload, BaseModel) else payload
        seq = int(await self.redis.incr(SEQ_KEY))
        msg = {**body, "type": msg_type, "seq": seq, "ts": datetime.now(UTC).isoformat()}
        raw = json.dumps(msg, separators=(",", ":"))
        await self.redis.lpush(RING_KEY, raw)
        await self.redis.ltrim(RING_KEY, 0, RING_SIZE - 1)
        await self.redis.publish(CHANNEL, raw)
        return msg

    async def set_state(self, state: dict[str, Any] | BaseModel) -> None:
        body = state.model_dump(mode="json") if isinstance(state, BaseModel) else state
        await self.redis.set(STATE_KEY, json.dumps(body, separators=(",", ":")))

    async def get_state(self) -> dict[str, Any] | None:
        raw = await self.redis.get(STATE_KEY)
        return None if raw is None else dict(json.loads(raw))

    async def ring(self) -> list[dict[str, Any]]:
        """Messages in the ring, oldest first."""
        raw = await self.redis.lrange(RING_KEY, 0, RING_SIZE - 1)
        return [json.loads(r) for r in reversed(raw)]
