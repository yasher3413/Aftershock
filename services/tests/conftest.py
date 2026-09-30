from __future__ import annotations

import gzip
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

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
