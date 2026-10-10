from __future__ import annotations

from datetime import UTC, date, datetime
from types import SimpleNamespace
from typing import Any

import pytest

from aftershock.jobs.ratings import predict_future, replay
from aftershock.ml.strength import StrengthParams


def row(gid: int, day: date, home: str, away: str, hg: int, ag: int) -> dict[str, Any]:
    return {
        "game_id": gid,
        "season": 20252026,
        "game_type": 2,
        "game_date": day,
        "start_utc": datetime(day.year, day.month, day.day, 23, tzinfo=UTC),
        "home": home,
        "away": away,
        "home_score": hg,
        "away_score": ag,
        "last_period_type": "REG",
        "home_reg_goals": hg,
        "away_reg_goals": ag,
        "home_ot_goals": 0,
        "away_ot_goals": 0,
        "home_xg_reg": float(hg),
        "away_xg_reg": float(ag),
        "home_xg": float(hg),
        "away_xg": float(ag),
        "minutes": 60.0,
    }


def test_replay_is_as_of_and_snapshots_daily() -> None:
    rows = [
        row(1, date(2025, 10, 1), "AAA", "BBB", 6, 1),
        row(2, date(2025, 10, 2), "AAA", "BBB", 6, 1),
    ]
    engine, pregames, snaps = replay(rows, StrengthParams())
    # The first game is predicted before any result: equal teams.
    first, second = pregames
    assert first["p_home_reg"] < second["p_home_reg"]
    assert {s["as_of_date"] for s in snaps} == {date(2025, 10, 2), date(2025, 10, 3)}
    assert sum(first[k] for k in first if k.startswith("p_")) == pytest.approx(1.0)
    assert engine.team("AAA").off > 0


def test_future_back_to_back_is_flagged() -> None:
    engine, _, _ = replay([row(1, date(2025, 10, 1), "AAA", "BBB", 3, 3)], StrengthParams())
    games = [
        SimpleNamespace(
            id=10,
            season=20252026,
            game_type=2,
            night_date=date(2025, 10, 5),
            home="AAA",
            away="CCC",
        ),
        SimpleNamespace(
            id=11,
            season=20252026,
            game_type=2,
            night_date=date(2025, 10, 6),
            home="AAA",
            away="BBB",
        ),
        SimpleNamespace(
            id=12,
            season=20252026,
            game_type=2,
            night_date=date(2025, 10, 8),
            home="AAA",
            away="BBB",
        ),
    ]
    out = {r["game_id"]: r for r in predict_future(engine, games)}  # type: ignore[arg-type]
    assert out[11]["exp_home_goals"] < out[12]["exp_home_goals"]


def test_missing_games_table_is_reported(tmp_path: Any) -> None:
    """A deployment without data/features rated teams from almost nothing
    and served wrong odds all night; the gap must show in the logs."""
    from structlog.testing import capture_logs

    from aftershock.config import Settings
    from aftershock.jobs.ratings import all_game_rows

    with capture_logs() as logs:
        rows = all_game_rows(Settings(data_dir=tmp_path))
    assert rows == []
    assert any(e["event"] == "ratings.games_table_missing" for e in logs)
