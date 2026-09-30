"""Async engine and session factory."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import lru_cache

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from aftershock.config import get_settings


@lru_cache(maxsize=4)
def get_engine(url: str | None = None) -> AsyncEngine:
    return create_async_engine(
        url or get_settings().database_url, pool_size=10, max_overflow=10, pool_pre_ping=True
    )


def session_factory(engine: AsyncEngine | None = None) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine or get_engine(), expire_on_commit=False)


@asynccontextmanager
async def session_scope(engine: AsyncEngine | None = None) -> AsyncIterator[AsyncSession]:
    """A session that commits on success and rolls back on error."""
    async with session_factory(engine)() as session:
        try:
            yield session
            await session.commit()
        except BaseException:
            await session.rollback()
            raise
