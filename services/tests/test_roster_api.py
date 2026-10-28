from __future__ import annotations

import json
import re
import time
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from aftershock.api.app import WHATIF_KEY, create_app, db
from aftershock.db.models import PlayerValueRow, RosterSpot
from aftershock.db.session import session_scope
from aftershock.sim.roster_lab import game_date
from tests.roster_fixtures import N_FINAL, gold_boot
from tests.test_hub import FakeRedis

pytest.importorskip("aftershock_core")
pytestmark = pytest.mark.db

NOW = datetime(2026, 11, 1, tzinfo=UTC)


def value(pid: int, name: str, pos: str, team: str | None, **kw: float) -> dict[str, Any]:
    row = dict(
        player_id=pid,
        name=name,
        position=pos,
        last_team=team,
        off60=0.0,
        def60=0.0,
        finish_per_shot=0.0,
        shots_per60=0.0,
        gsax_per_shot=0.0,
        ev_toi_pg=0.0,
        pp_toi_pg=0.0,
        games=80,
        model_version="roster-1.0.0",
        computed_at=NOW,
    )
    return row | kw


async def seed(engine: AsyncEngine) -> None:
    values: list[dict[str, Any]] = []
    spots: list[dict[str, Any]] = []
    for team, base in (("TOR", 100), ("MTL", 200), ("BOS", 300)):
        for i in range(12):
            toi = 18.0 - i * 0.6
            values.append(
                value(base + i, f"{team} F{i}", "F", team, off60=0.1 - i * 0.01, ev_toi_pg=toi)
            )
            spots.append(
                dict(
                    team=team,
                    player_id=base + i,
                    name=f"{team} F{i}",
                    position="F",
                    in_lineup=True,
                    ev_toi_pg=toi,
                    pp_toi_pg=1.0,
                    toi_share=0.0,
                    computed_at=NOW,
                )
            )
        for i in range(6):
            pid = base + 20 + i
            values.append(
                value(pid, f"{team} D{i}", "D", team, def60=-0.05 + i * 0.01, ev_toi_pg=22.0 - i)
            )
            spots.append(
                dict(
                    team=team,
                    player_id=pid,
                    name=f"{team} D{i}",
                    position="D",
                    in_lineup=True,
                    ev_toi_pg=22.0 - i,
                    pp_toi_pg=0.0,
                    toi_share=0.0,
                    computed_at=NOW,
                )
            )
        for i, share in enumerate((0.7, 0.3)):
            pid = base + 30 + i
            values.append(value(pid, f"{team} G{i}", "G", team, gsax_per_shot=0.004 - i * 0.004))
            spots.append(
                dict(
                    team=team,
                    player_id=pid,
                    name=f"{team} G{i}",
                    position="G",
                    in_lineup=True,
                    ev_toi_pg=0.0,
                    pp_toi_pg=0.0,
                    toi_share=share,
                    computed_at=NOW,
                )
            )
        hurt = base + 40
        values.append(value(hurt, f"{team} Hurt", "F", team, off60=0.3, ev_toi_pg=15.0))
        spots.append(
            dict(
                team=team,
                player_id=hurt,
                name=f"{team} Hurt",
                position="F",
                in_lineup=False,
                ev_toi_pg=15.0,
                pp_toi_pg=0.0,
                toi_share=0.0,
                computed_at=NOW,
            )
        )
    values.append(value(900, "Free Agent", "F", "CHI", off60=0.3, ev_toi_pg=16.0))
    async with session_scope(engine) as s:
        await s.execute(PlayerValueRow.__table__.insert(), values)
        await s.execute(RosterSpot.__table__.insert(), spots)


@pytest.fixture(scope="module")
def boot() -> dict[str, Any]:
    return gold_boot()


@pytest.fixture
async def client(
    db_engine: AsyncEngine, boot: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[tuple[httpx.AsyncClient, FakeRedis]]:
    from aftershock.api import roster as R

    # "Today" is the first unplayed day of the fixture season.
    monkeypatch.setattr(R, "today", lambda: game_date(boot["games"][N_FINAL]))
    await seed(db_engine)
    fake = FakeRedis()
    await fake.set(WHATIF_KEY, json.dumps(boot))
    app = create_app(redis=fake, subscribe=False, response_cache=False)  # type: ignore[arg-type]
    maker = async_sessionmaker(db_engine, expire_on_commit=False)

    async def override() -> AsyncIterator[AsyncSession]:
        async with maker() as session:
            yield session

    app.dependency_overrides[db] = override
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            yield c, fake


async def run(c: httpx.AsyncClient, encoded: str) -> httpx.Response:
    return await c.post("/api/roster-lab/run", json={"encoded": encoded})


async def test_trade_moves_both_teams(client: Any) -> None:
    c, _ = client
    r = await run(c, "t100-MTL")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["changed"] == ["MTL", "TOR"]
    lines = {t["team"]: t for t in body["teams"]}
    assert len(lines) == 32
    assert lines["MTL"]["playoffs_after"] > lines["MTL"]["playoffs_before"]
    assert lines["TOR"]["points_after"] < lines["TOR"]["points_before"]
    assert body["moves"] == [
        {
            "player_id": 100,
            "name": "TOR F0",
            "move": "trade",
            "from_team": "TOR",
            "to_team": "MTL",
            "weeks": None,
        }
    ]
    assert body["why"]["MTL"][0]["goals"] > 0 > body["why"]["TOR"][0]["goals"]


async def test_order_does_not_matter(client: Any) -> None:
    c, _ = client
    a = (await run(c, "t111-MTL_t211-TOR")).json()
    b = (await run(c, "t211-TOR_t111-MTL")).json()
    assert a == b and a["encoded"] == "t111-MTL_t211-TOR"


@pytest.mark.parametrize(
    ("encoded", "words"),
    [
        ("t130-MTL_t131-MTL", "goalie"),
        ("s100-MTL", "trade for him"),
        ("t140-MTL", "not been playing lately"),
        ("t100-MTL_t300-TOR", "two teams"),
        ("t100-TOR", "already on TOR"),
        ("t100-XXX", "no team XXX"),
        ("i9999-4", "not on an NHL roster"),
        ("i100-3", "injury length"),
        ("nonsense", "Bad move"),
    ],
)
async def test_illegal_moves_are_refused(client: Any, encoded: str, words: str) -> None:
    c, _ = client
    r = await run(c, encoded)
    assert r.status_code == 422 and words in r.json()["detail"], r.text


async def test_signing_a_free_agent(client: Any) -> None:
    c, _ = client
    agents = (await c.get("/api/roster-lab/free-agents", params={"q": "free"})).json()
    assert [a["name"] for a in agents] == ["Free Agent"] and agents[0]["worth_goals"] > 0
    body = (await run(c, "s900-TOR")).json()
    assert body["changed"] == ["TOR"]
    assert body["moves"][0]["from_team"] is None


async def test_team_roster_lists_worth_and_who_is_out(client: Any) -> None:
    c, _ = client
    body = (await c.get("/api/roster-lab/teams/tor")).json()
    assert body["team"] == "TOR" and body["games_left"] > 0
    first = body["players"][0]
    assert first["name"] == "TOR F0" and first["worth_goals"] > 0
    hurt = next(p for p in body["players"] if p["name"] == "TOR Hurt")
    assert hurt["in_lineup"] is False and hurt["worth_goals"] == 0
    assert (await c.get("/api/roster-lab/teams/XXX")).status_code == 404


async def test_no_bootstrap_is_503(client: Any) -> None:
    c, fake = client
    fake.kv.pop(WHATIF_KEY)
    assert (await run(c, "i100-4")).status_code == 503


async def test_offseason_is_409(client: Any, boot: dict[str, Any]) -> None:
    c, fake = client
    done = {**boot, "games": [g for g in boot["games"] if g["status"] == "final"]}
    await fake.set(WHATIF_KEY, json.dumps(done))
    r = await run(c, "i100-4")
    assert r.status_code == 409 and "regular season starts" in r.json()["detail"]


async def test_saved_moves_round_trip_and_page(client: Any) -> None:
    c, _ = client
    saved = (await c.post("/api/roster-moves", json={"encoded": "t211-TOR_t111-MTL"})).json()
    assert re.fullmatch(r"[A-Za-z0-9]{8}", saved["id"]) and saved["encoded"] == "t111-MTL_t211-TOR"
    again = await c.post("/api/roster-moves", json={"encoded": "t111-MTL_t211-TOR"})
    assert again.json()["id"] == saved["id"]
    got = await c.get(f"/api/roster-moves/{saved['id']}")
    assert got.json() == saved and "immutable" in got.headers["cache-control"]
    assert (await c.get("/api/roster-moves/AAAAAAAA")).status_code == 404
    assert (await c.post("/api/roster-moves", json={"encoded": "x"})).status_code == 422
    from aftershock.api import pages

    pages._template.update(
        html="<html><head><title>Puckquake</title></head><body></body></html>",
        at=time.monotonic(),
    )
    page = (await c.get(f"/page/roster-lab?id={saved['id']}")).text
    pages._template.clear()
    assert "MTL gets TOR F11, TOR gets MTL F11" in page
    assert f"/api/og/roster/{saved['id']}.png" in page


async def test_card_names_moves_and_odds(client: Any) -> None:
    from aftershock.api import schemas as S
    from aftershock.share.cards import roster_og

    c, _ = client
    body = S.RosterRunOut.model_validate((await run(c, "t100-MTL_i200-4")).json())
    svg = roster_og(body)
    assert "MTL gets TOR F0" in svg and "MTL F0 out 4 weeks" in svg
    assert "puckquake.com/roster-lab" in svg and "TOR" in svg
