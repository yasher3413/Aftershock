from __future__ import annotations

from typing import Any

from aftershock.api import schemas as S
from aftershock.config import Settings
from aftershock.live.worker import Worker
from aftershock.sim.backend import StubBackend
from tests.test_share import tremor


class RecordingBot:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    def enqueue_goal(self, t: S.Tremor) -> None:
        self.calls.append(("goal", t.id))

    def enqueue_reversal(self, tremor_id: int) -> None:
        self.calls.append(("reversal", tremor_id))

    def enqueue_correction(self, tremor_id: int, changes: dict[str, Any]) -> None:
        self.calls.append(("correction", (tremor_id, changes)))


def test_worker_feeds_the_bot() -> None:
    w = Worker(Settings(), backend=StubBackend())
    bot = RecordingBot()
    w.bot = bot  # type: ignore[assignment]
    goal = {"tremor": tremor().model_dump(mode="json")}
    w._dispatch_bot("tremor", goal)
    w._catching_up = True
    w._dispatch_bot("tremor", goal)  # an earlier night's goal: old news
    w._dispatch_bot("tremor_reversed", {"tremor_id": 5, "game_id": 1})
    changes = {"scorer": {"id": 2, "name": "A B"}}
    w._dispatch_bot("tremor_updated", {"tremor_id": 6, "changes": changes})
    w._dispatch_bot("odds_update", {})
    assert bot.calls == [("goal", 1), ("reversal", 5), ("correction", (6, changes))]


def test_bot_mode_command(monkeypatch: Any) -> None:
    from typer.testing import CliRunner

    from aftershock import cli
    from tests.test_hub import FakeRedis

    fake = FakeRedis()
    fake.aclose = _noop  # type: ignore[attr-defined]
    monkeypatch.setattr("redis.asyncio.Redis.from_url", lambda *a, **k: fake)
    runner = CliRunner()
    first = runner.invoke(cli.app, ["bot-mode"])
    assert first.exit_code == 0 and "off" in first.output
    set_ = runner.invoke(cli.app, ["bot-mode", "dry_run"])
    assert set_.exit_code == 0 and "dry_run" in set_.output
    assert fake.kv["aftershock:bot:mode"] == "dry_run"
    assert runner.invoke(cli.app, ["bot-mode", "loud"]).exit_code != 0


async def _noop() -> None:
    return None
