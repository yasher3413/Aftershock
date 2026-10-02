from __future__ import annotations

from datetime import UTC, datetime, timedelta

from aftershock.live.worker import replay_times

START = datetime(2026, 10, 1, 23, 0, tzinfo=UTC)


def at(minutes: float) -> datetime:
    return START + timedelta(minutes=minutes)


def test_replay_keeps_ordinary_gaps() -> None:
    """Intermissions and quiet stretches play back at their real length."""
    assert replay_times([at(0), at(2), at(20)], START) == [0, 120_000, 1_200_000]


def test_replay_skips_an_outage() -> None:
    """Goals caught up the next afternoon after the worker was down land a
    minute after the last live frame instead of hours later."""
    times = replay_times([at(5), at(30), at(17 * 60), at(17 * 60 + 0.5)], START)
    assert times == [300_000, 1_800_000, 1_860_000, 1_890_000]


def test_replay_frames_before_puck_drop_start_at_zero() -> None:
    assert replay_times([at(-3), at(1)], START) == [0, 60_000]
