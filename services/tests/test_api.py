from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from starlette.testclient import TestClient

from aftershock.api.app import create_app, db
from aftershock.db.models import Game, Player, SimRun, TeamOdds, Tremor
from aftershock.db.session import session_scope
from aftershock.ingest.load import seed_reference
from tests.test_hub import FakeRedis

pytestmark = pytest.mark.db

SIX = {
    "home_reg": 0.4,
    "home_ot": 0.07,
    "home_so": 0.04,
    "away_reg": 0.38,
    "away_ot": 0.07,
    "away_so": 0.04,
}
ODDS = dict(
    p_playoffs=0.6,
    p_division=0.2,
    p_top3_div=0.5,
    p_wildcard=0.1,
    p_presidents=0.05,
    p_conf_first=0.1,
    p_round2=0.3,
    p_conf_final=0.15,
    p_final=0.07,
    p_cup=0.03,
    p_last=0.01,
    exp_points=95.0,
)


async def seed(engine: AsyncEngine) -> None:
    async with session_scope(engine) as s:
        await seed_reference(s)
        s.add(
            Game(
                id=2026020008,
                season=20262027,
                game_type=2,
                night_date=date(2026, 9, 30),
                start_utc=datetime(2026, 9, 30, 23, 30, tzinfo=UTC),
                home="TOR",
                away="NYI",
                venue="Scotiabank Arena",
                state="LIVE",
                home_score=1,
                away_score=0,
            )
        )
        s.add_all(
            [
                Player(id=1, name="Scorer One", position="C", current_team="TOR"),
                Player(id=2, name="Helper Two", position="D", current_team="TOR"),
                Player(id=3, name="Goalie Three", position="G", current_team="NYI"),
            ]
        )
        run = SimRun(
            season=20262027,
            trigger="goal",
            n_sims=100,
            seed=1,
            state_hash="x",
            duration_ms=12.5,
            as_of=datetime.now(UTC),
        )
        s.add(run)
        await s.flush()
        for team in ("TOR", "NYI"):
            s.add(
                TeamOdds(
                    sim_run_id=run.id,
                    team=team,
                    points_hist={"95": 10, "96": 5},
                    seed_dist={"div1": 0.2, "out": 0.4},
                    **ODDS,
                )
            )
        for i, mag in enumerate((2.1, 6.4)):
            s.add(
                Tremor(
                    season=20262027,
                    game_id=2026020008,
                    event_id=100 + i,
                    team="TOR",
                    opponent="NYI",
                    scorer_id=1,
                    assist1_id=2,
                    goalie_id=3,
                    period=1,
                    period_type="REG",
                    t_period_s=300 + i,
                    t_game_s=300 + i,
                    score_before={"home": i, "away": 0},
                    score_after={"home": i + 1, "away": 0},
                    wp_before=SIX,
                    wp_after=SIX,
                    deltas={
                        "TOR": {
                            "d_playoffs": 0.02,
                            "d_division": 0.01,
                            "d_cup": 0.001,
                            "p_playoffs_after": 0.6,
                        },
                        "NYI": {
                            "d_playoffs": -0.015,
                            "d_division": -0.01,
                            "d_cup": -0.001,
                            "p_playoffs_after": 0.4,
                        },
                    },
                    total_shift=0.04,
                    magnitude=mag,
                    ppa=0.02,
                    cpa=0.001,
                    origin_venue="Scotiabank Arena",
                    origin_lat=43.643,
                    origin_lon=-79.379,
                    night_date=date(2026, 9, 30),
                )
            )
    async with engine.begin() as conn:
        await conn.execute(text("REFRESH MATERIALIZED VIEW player_ppa_season"))


@pytest.fixture
async def client(db_engine: AsyncEngine) -> AsyncIterator[tuple[httpx.AsyncClient, FakeRedis]]:
    await seed(db_engine)
    fake = FakeRedis()
    app = create_app(redis=fake, subscribe=False)  # type: ignore[arg-type]
    maker = async_sessionmaker(db_engine, expire_on_commit=False)

    async def override() -> AsyncIterator[AsyncSession]:
        async with maker() as session:
            yield session

    app.dependency_overrides[db] = override
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            yield c, fake


async def test_state_requires_worker_then_serves(client: Any) -> None:
    c, fake = client
    assert (await c.get("/api/state")).status_code == 503
    await fake.set("aftershock:state", json.dumps({"mode": "live", "tremors": []}))
    r = await c.get("/api/state")
    assert r.status_code == 200 and r.json()["mode"] == "live" and "server_time" in r.json()


async def test_tremors_list_sort_and_cursor(client: Any) -> None:
    c, _ = client
    r = (await c.get("/api/tremors?season=20262027&sort=magnitude&limit=1")).json()
    assert [t["magnitude"] for t in r["items"]] == [6.4]
    assert r["items"][0]["scorer"]["name"] == "Scorer One"
    assert r["items"][0]["assists"][0]["name"] == "Helper Two"
    assert r["items"][0]["deltas"][0]["team"] == "TOR"
    nxt = (
        await c.get(
            f"/api/tremors?season=20262027&sort=magnitude&limit=1&cursor={r['next_cursor']}"
        )
    ).json()
    assert [t["magnitude"] for t in nxt["items"]] == [2.1]
    assert nxt["next_cursor"] is None
    one = (await c.get(f"/api/tremors/{r['items'][0]['id']}")).json()
    assert one["origin"]["venue"] == "Scotiabank Arena" and not one["origin"]["off_map"]
    assert (await c.get("/api/tremors/999999")).status_code == 404


async def test_game_team_and_leaders(client: Any) -> None:
    c, _ = client
    g = (await c.get("/api/games/2026020008")).json()
    assert g["game"]["home"] == "TOR" and len(g["tremors"]) == 2
    day = (await c.get("/api/games?date=2026-09-30")).json()
    assert [x["id"] for x in day] == [2026020008]
    t = (await c.get("/api/teams/tor?season=20262027")).json()
    assert t["team"]["abbrev"] == "TOR"
    assert t["odds"]["p_playoffs"] == 0.6
    assert sum(b["p"] for b in t["points_hist"]) == pytest.approx(1.0)
    assert len(t["tremors_for"]) == 2 and t["tremors_against"] == []
    assert t["players"][0]["player"]["name"] == "Scorer One"
    lead = (await c.get("/api/leaders/ppa?season=20262027&kind=skater")).json()
    assert lead["rows"][0]["player"]["name"] == "Scorer One"
    assert lead["rows"][0]["value"] == pytest.approx(0.04)
    goalie = (await c.get("/api/leaders/ppa?season=20262027&kind=goalie")).json()
    assert goalie["rows"][0]["value"] == pytest.approx(-0.03)
    chaos = (await c.get("/api/leaders/ppa?season=20262027&kind=team_chaos")).json()
    assert chaos["rows"][0]["team"] == "TOR" and chaos["rows"][0]["value"] == pytest.approx(0.03)
    hist = (await c.get("/api/odds/history?team=TOR&season=20262027")).json()
    assert hist[0]["value"] == 0.6
    assert (await c.get("/api/odds/history?team=TOR&metric=nope")).status_code == 422
    assert (await c.get("/api/teams/XXX")).status_code == 404


async def test_health_status_methodology(client: Any) -> None:
    c, fake = client
    now = datetime.now(UTC)
    await fake.set(
        "aftershock:health",
        json.dumps(
            {
                "heartbeat": (now - timedelta(seconds=5)).isoformat(),
                "last_poll": {"score": now.isoformat(), "play-by-play": None},
            }
        ),
    )
    h = (await c.get("/api/health")).json()
    assert h["ok"] and h["last_sim_ms"] == 12.5 and h["worker_lag_s"] < 60
    st = (await c.get("/api/status")).json()
    assert st["sim_runs"][0]["trigger"] == "goal"
    m = (await c.get("/api/methodology")).json()
    assert "xg" in m and "reliability" not in json.dumps(m["xg"]["test"]["lightgbm"])
    assert m["plots"]["xg_reliability"] == "/api/reports/xg_reliability.svg"
    assert (await c.get("/api/reports/xg_reliability.svg")).status_code == 200
    assert (await c.get("/api/reports/..%2Fartifacts%2Fxg-1.0.0.json")).status_code == 404


def test_websocket_hello_and_backlog(db_engine: AsyncEngine) -> None:
    fake = FakeRedis()
    app = create_app(redis=fake, subscribe=False)  # type: ignore[arg-type]
    with TestClient(app) as tc:
        hub = app.state.aftershock.hub
        for s in (1, 2, 3):
            hub.push({"type": "event", "seq": s, "ts": "2026-09-30T23:00:00Z"})
        with tc.websocket_connect("/ws/live?since=1") as ws:
            assert ws.receive_json()["type"] == "hello"
            assert [ws.receive_json()["seq"] for _ in range(2)] == [2, 3]
