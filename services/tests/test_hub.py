from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

from aftershock.api.hub import Hub
from aftershock.live.publish import Publisher


def msg(seq: int, kind: str = "event") -> dict[str, Any]:
    return {"type": kind, "seq": seq, "ts": "2026-09-30T23:00:00Z"}


def test_backlog_fills_gaps_and_detects_stale_clients() -> None:
    hub = Hub(ring_size=5)
    for s in range(1, 11):
        hub.push(msg(s))
    assert hub.last_seq == 10
    assert [json.loads(r)["seq"] for r in hub.backlog(7) or []] == [8, 9, 10]
    assert hub.backlog(10) == []
    assert hub.backlog(5) is not None  # oldest kept is 6, so since=5 is fillable
    assert hub.backlog(2) is None  # too old
    assert hub.backlog(None) == []


def test_push_ignores_duplicates() -> None:
    hub = Hub()
    hub.push(msg(1))
    hub.push(msg(1))
    assert len(hub.ring) == 1


async def test_serve_sends_hello_backlog_live_and_heartbeat() -> None:
    hub = Hub()
    for s in (1, 2, 3):
        hub.push(msg(s))
    sent: list[dict[str, Any]] = []
    done = asyncio.Event()

    async def send(raw: str) -> None:
        sent.append(json.loads(raw))
        if len(sent) >= 5:
            done.set()
            raise ConnectionError

    task = asyncio.create_task(hub.serve(send, since=1, heartbeat_s=0.05))
    await asyncio.sleep(0.01)
    hub.push(msg(4, "tremor"))
    with pytest.raises(ConnectionError):
        await asyncio.wait_for(task, 2)
    types = [m["type"] for m in sent]
    assert types[0] == "hello"
    assert [m["seq"] for m in sent[1:3]] == [2, 3]
    assert sent[3]["type"] == "tremor" and sent[3]["seq"] == 4
    assert sent[4]["type"] == "heartbeat"
    assert not hub.clients


async def test_serve_asks_stale_client_to_resync() -> None:
    hub = Hub(ring_size=2)
    for s in range(1, 6):
        hub.push(msg(s))
    sent: list[dict[str, Any]] = []

    async def send(raw: str) -> None:
        sent.append(json.loads(raw))
        if len(sent) == 2:
            raise ConnectionError

    with pytest.raises(ConnectionError):
        await hub.serve(send, since=1)
    assert [m["type"] for m in sent] == ["hello", "resync"]


class FakeRedis:
    def __init__(self) -> None:
        self.kv: dict[str, Any] = {}
        self.lists: dict[str, list[Any]] = {}
        self.published: list[tuple[str, Any]] = []

    async def incr(self, name: str) -> int:
        self.kv[name] = int(self.kv.get(name, 0)) + 1
        return int(self.kv[name])

    async def lpush(self, name: str, *values: Any) -> int:
        lst = self.lists.setdefault(name, [])
        for v in values:
            lst.insert(0, v)
        return len(lst)

    async def ltrim(self, name: str, start: int, end: int) -> None:
        self.lists[name] = self.lists.get(name, [])[start : end + 1]

    async def publish(self, channel: str, message: Any) -> int:
        self.published.append((channel, message))
        return 1

    async def set(self, name: str, value: Any) -> None:
        self.kv[name] = value

    async def get(self, name: str) -> Any:
        return self.kv.get(name)

    async def lrange(self, name: str, start: int, end: int) -> list[Any]:
        return self.lists.get(name, [])[start : end + 1]


async def test_publisher_sequences_and_ring() -> None:
    r = FakeRedis()
    pub = Publisher(r)
    a = await pub.publish("tremor", {"tremor": {"id": 1}})
    b = await pub.publish("odds_update", {"sim_run_id": 2, "trigger": "goal", "odds": []})
    assert (a["seq"], b["seq"]) == (1, 2)
    assert [m["seq"] for m in await pub.ring()] == [1, 2]
    assert len(r.published) == 2
    await pub.set_state({"mode": "live"})
    assert await pub.get_state() == {"mode": "live"}
