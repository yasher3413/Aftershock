from __future__ import annotations

import gzip
import json
import os
from collections.abc import AsyncIterator, Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from aftershock.config import REPO_ROOT

FIXTURES = REPO_ROOT / "tests" / "fixtures" / "nhl"


def load_fixture(name: str) -> Any:
    path = FIXTURES / f"{name}.json.gz"
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


@pytest.fixture
def fixture() -> Callable[[str], Any]:
    return load_fixture


@pytest.fixture
def fixtures_dir() -> Path:
    return FIXTURES


# ----------------------------------------------------------------------
# Database fixtures. Tests marked ``db`` need a Postgres at TEST_DATABASE_URL
# (default: the Compose database on port 55432, database aftershock_test).

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://aftershock:aftershock@localhost:55432/aftershock_test",
)


@pytest.fixture(scope="session")
def migrated_db() -> Iterator[str]:
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(REPO_ROOT / "services" / "alembic.ini"))
    cfg.set_main_option("script_location", str(REPO_ROOT / "services" / "migrations"))
    cfg.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")
    yield TEST_DATABASE_URL


@pytest.fixture
async def db_engine(migrated_db: str) -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(migrated_db)
    async with engine.begin() as conn:
        tables = (
            await conn.execute(
                text(
                    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' "
                    "AND tablename <> 'alembic_version'"
                )
            )
        ).scalars()
        names = ", ".join(tables)
        if names:
            await conn.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))
    yield engine
    await engine.dispose()
