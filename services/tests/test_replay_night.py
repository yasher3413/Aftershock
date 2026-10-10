from __future__ import annotations

from datetime import date

from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from aftershock.db.models import ReplayBundle
from aftershock.live.state import recent_night


def bundle(night: date, tremors: int = 20) -> ReplayBundle:
    return ReplayBundle(
        night_date=night,
        season=20262027,
        path=f"replays/20262027/{night}.json.gz",
        total_energy=1.0,
        n_games=4,
        n_tremors=tremors,
    )


async def test_home_replays_the_night_that_just_ended(db_engine: AsyncEngine) -> None:
    """After the last game, until the 6 a.m. rollover, the hockey night is
    still the one that just finished: its replay is the one to show, not the
    night before."""
    maker = async_sessionmaker(db_engine, expire_on_commit=False)
    async with maker() as s:
        s.add_all([bundle(date(2026, 10, 8)), bundle(date(2026, 10, 9))])
        await s.commit()
        assert (await recent_night(s, date(2026, 10, 9))).night_date == date(2026, 10, 9)  # type: ignore[union-attr]
        # Before tonight's games have a replay, last night's plays.
        assert (await recent_night(s, date(2026, 10, 10))).night_date == date(2026, 10, 9)  # type: ignore[union-attr]
