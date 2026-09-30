"""FastAPI application: REST under /api and the live WebSocket at /ws/live."""

from __future__ import annotations

import asyncio
import contextlib
import gzip
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Annotated, Any, Literal

import structlog
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request, WebSocket
from fastapi.responses import FileResponse, JSONResponse, Response
from redis.asyncio import Redis
from sqlalchemy import desc, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.websockets import WebSocketDisconnect

from aftershock.api import queries as Q
from aftershock.api import schemas as S
from aftershock.api.hub import Hub
from aftershock.config import Settings, get_settings
from aftershock.db.models import JobRun, ReconcileEvent, ReplayBundle, SimRun, Tremor
from aftershock.db.session import session_factory
from aftershock.live.publish import CHANNEL, Publisher

log = structlog.get_logger(__name__)

HEALTH_KEY = "aftershock:health"
WHATIF_KEY = "aftershock:whatif"


class AppState:
    def __init__(self, settings: Settings, redis: Redis) -> None:
        self.settings = settings
        self.redis = redis
        self.publisher = Publisher(redis)  # type: ignore[arg-type]
        self.hub = Hub()
        self.task: asyncio.Task[None] | None = None


async def _subscribe(state: AppState) -> None:
    """Feed the hub from Redis, reconnecting on errors."""
    while True:
        try:
            state.hub.load(await state.publisher.ring())
            pubsub = state.redis.pubsub()
            await pubsub.subscribe(CHANNEL)
            async for item in pubsub.listen():
                if item.get("type") == "message":
                    state.hub.push(json.loads(item["data"]))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning("api.subscribe_failed", error=str(exc))
            await asyncio.sleep(2)


def create_app(
    settings: Settings | None = None, *, redis: Redis | None = None, subscribe: bool = True
) -> FastAPI:
    s = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        r = redis or Redis.from_url(s.redis_url, decode_responses=True)
        state = AppState(s, r)
        app.state.aftershock = state
        if subscribe:
            state.task = asyncio.create_task(_subscribe(state))
        yield
        if state.task:
            state.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await state.task
        if redis is None:
            await r.aclose()

    app = FastAPI(
        title="Aftershock API",
        version="1.0",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.include_router(router, prefix="/api")
    app.add_api_websocket_route("/ws/live", live_socket)
    return app


async def db() -> AsyncIterator[AsyncSession]:
    async with session_factory()() as session:
        yield session


Db = Annotated[AsyncSession, Depends(db)]
router = APIRouter()


def current_season(now: datetime | None = None) -> int:
    n = now or datetime.now(UTC)
    start = n.year if n.month >= 8 else n.year - 1
    return start * 10000 + start + 1


# ----------------------------------------------------------------------
# Live state


def app_state(request: Request) -> AppState:
    st: AppState = request.app.state.aftershock
    return st


State = Annotated[AppState, Depends(app_state)]


@router.get("/health", response_model=S.HealthResponse)
async def health(st: State, session: Db) -> S.HealthResponse:
    raw = await st.redis.get(HEALTH_KEY)
    h: dict[str, Any] = json.loads(raw) if raw else {}
    run = (
        await session.execute(select(SimRun).order_by(desc(SimRun.id)).limit(1))
    ).scalar_one_or_none()
    last_poll = {
        k: datetime.fromisoformat(v) if v else None for k, v in h.get("last_poll", {}).items()
    }
    heartbeat = h.get("heartbeat")
    lag = None
    if heartbeat:
        lag = (datetime.now(UTC) - datetime.fromisoformat(heartbeat)).total_seconds()
    return S.HealthResponse(
        ok=lag is not None and lag < 120,
        server_time=datetime.now(UTC),
        last_poll=last_poll,
        worker_lag_s=lag,
        last_sim_ms=run.duration_ms if run else None,
        last_sim_at=run.created_at if run else None,
        mode=st.hub.mode if st.hub.mode in ("live", "demo") else "live",
    )


@router.get("/state", response_model=S.StateResponse)
async def get_state(st: State) -> Any:
    state = await st.publisher.get_state()
    if state is None:
        raise HTTPException(
            503,
            "The worker has not published state yet. Start it with "
            "`make up` or `aftershock worker`.",
        )
    state["server_time"] = datetime.now(UTC).isoformat()
    return JSONResponse(state)


async def live_socket(websocket: WebSocket) -> None:
    st: AppState = websocket.app.state.aftershock
    since_raw = websocket.query_params.get("since")
    since = int(since_raw) if since_raw and since_raw.isdigit() else None
    await websocket.accept()
    with contextlib.suppress(WebSocketDisconnect, RuntimeError):
        await st.hub.serve(websocket.send_text, since)


# ----------------------------------------------------------------------
# Pages


@router.get("/teams/{abbrev}", response_model=S.TeamResponse)
async def team(abbrev: str, session: Db, st: State, season: int | None = None) -> S.TeamResponse:
    season = season or current_season()
    page = await Q.team_page(session, abbrev.upper(), season)
    if page is None:
        raise HTTPException(404, f"No team {abbrev}")
    state = await st.publisher.get_state()
    if state and state.get("season") == season and state.get("standings"):
        from aftershock.sim.inputs import league_config
        from aftershock.tremors.clinch import clinch_status

        rows = [S.StandingsRow(**r) for r in state["standings"]]
        per_team = int(league_config(season, st.settings)["games_per_team"])
        info = clinch_status(rows, per_team).get(page.team.abbrev)
        if info is not None:
            page.clinch = S.ClinchOut(
                status=info.status, magic_number=info.magic_number, max_points=info.max_points
            )
    return page


@router.get("/games", response_model=list[S.GameSummary])
async def games(session: Db, date_: Annotated[date, Query(alias="date")]) -> list[S.GameSummary]:
    return await Q.games_on(session, date_)


@router.get("/games/{game_id}", response_model=S.GameResponse)
async def game(game_id: int, session: Db) -> S.GameResponse:
    page = await Q.game_page(session, game_id)
    if page is None:
        raise HTTPException(404, f"No game {game_id}")
    return page


@router.get("/tremors", response_model=S.TremorPage)
async def tremors(
    session: Db,
    season: int | None = None,
    sort: Literal["magnitude", "recent"] = "recent",
    team: str | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    cursor: str | None = None,
) -> S.TremorPage:
    return await Q.tremor_page(
        session,
        season=season or current_season(),
        sort=sort,
        team=team.upper() if team else None,
        limit=limit,
        cursor=cursor,
    )


@router.get("/tremors/{tremor_id}", response_model=S.Tremor)
async def tremor(tremor_id: int, session: Db) -> S.Tremor:
    row = await session.get(Tremor, tremor_id)
    if row is None:
        raise HTTPException(404, f"No tremor {tremor_id}")
    return (await Q.tremors_out(session, [row]))[0]


@router.get("/leaders/ppa", response_model=S.LeadersResponse)
async def leaders(
    session: Db,
    season: int | None = None,
    kind: Literal["skater", "assist", "goalie", "team_chaos", "on_ice"] = "skater",
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> S.LeadersResponse:
    return await Q.leaders(session, season or current_season(), kind, limit)


@router.get("/odds/history", response_model=list[S.OddsPoint])
async def odds_history(
    session: Db, team: str, metric: str = "p_playoffs", season: int | None = None
) -> list[S.OddsPoint]:
    try:
        return await Q.odds_history(session, team.upper(), metric, season or current_season())
    except ValueError as exc:
        raise HTTPException(422, f"Unknown metric {metric}") from exc


@router.get("/energy", response_model=list[S.EnergySeries])
async def energy(
    session: Db, seasons: Annotated[list[int] | None, Query()] = None
) -> list[S.EnergySeries]:
    """League energy by day of season: the nightly sum of every goal's total shift."""
    wanted = seasons or [current_season() - 20002, current_season() - 10001, current_season()]
    rows = (
        await session.execute(
            text(
                """
        SELECT t.season, t.night_date, sum(t.total_shift)
        FROM tremors t JOIN games g ON g.id = t.game_id
        WHERE t.season = ANY(:s) AND g.game_type = 2 AND NOT t.overturned
        GROUP BY 1, 2 ORDER BY 1, 2
        """
            ),
            {"s": wanted},
        )
    ).all()
    out: dict[int, list[S.EnergyPoint]] = {s: [] for s in wanted}
    first: dict[int, date] = {}
    total: dict[int, float] = {}
    for season, night, shift in rows:
        first.setdefault(season, night)
        total[season] = total.get(season, 0.0) + float(shift)
        out[season].append(
            S.EnergyPoint(
                day=(night - first[season]).days, shift=float(shift), cumulative=total[season]
            )
        )
    return [S.EnergySeries(season=s, points=p) for s, p in out.items()]


@router.get("/replay/nights", response_model=list[S.NightInfo])
async def replay_nights(session: Db, season: int | None = None) -> list[S.NightInfo]:
    return await Q.nights(session, season or current_season() - 10001)


@router.get("/replay/{night}")
async def replay_bundle(night: date, session: Db) -> Response:
    b = await session.get(ReplayBundle, night)
    path = None
    if b is not None:
        path = Path(b.path)
        if not path.is_absolute():
            path = get_settings().data_dir / path
    data = await asyncio.to_thread(_read_bytes, path) if path else None
    if data is None:
        raise HTTPException(404, f"No replay for {night.isoformat()}")
    return Response(
        data,
        media_type="application/json",
        headers={"Content-Encoding": "gzip", "Cache-Control": "public, max-age=86400"},
    )


@router.get("/whatif/bootstrap")
async def whatif_bootstrap(st: State) -> Response:
    raw = await st.redis.get(WHATIF_KEY)
    if raw is None:
        raise HTTPException(
            503,
            "The What-If data is built by the worker after its first "
            "simulation. Try again in a minute.",
        )
    return Response(raw, media_type="application/json")


@router.get("/methodology")
async def methodology(st: State) -> dict[str, Any]:
    reports = st.settings.ml_dir / "reports"
    out: dict[str, Any] = {"plots": {}}
    for name in ("xg", "strength", "wp", "backtest", "magnitude"):
        f = reports / f"{name}.json"
        if f.exists():
            out[name] = _strip_bins(json.loads(f.read_text()))
    for svg in sorted(reports.glob("*.svg")):
        out["plots"][svg.stem] = f"/api/reports/{svg.name}"
    return out


def _strip_bins(obj: Any) -> Any:
    """Drop bulky reliability bins; the plots show them."""
    if isinstance(obj, dict):
        return {
            k: _strip_bins(v)
            for k, v in obj.items()
            if k not in ("reliability", "reliability_home_win")
        }
    if isinstance(obj, list):
        return [_strip_bins(v) for v in obj]
    return obj


@router.get("/reports/{name}")
async def report_file(name: str, st: State) -> FileResponse:
    path = (st.settings.ml_dir / "reports" / name).resolve()
    if path.parent != (st.settings.ml_dir / "reports").resolve() or not path.exists():
        raise HTTPException(404, "No such report")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=3600"})


@router.get("/recaps/{night}", response_model=S.RecapResponse)
async def recap(night: date, session: Db) -> S.RecapResponse:
    r = await Q.recap(session, night)
    if r is None:
        raise HTTPException(404, f"No recap for {night.isoformat()}")
    return r


@router.get("/status", response_model=S.StatusResponse)
async def status(st: State, session: Db) -> S.StatusResponse:
    h = await health(st, session)
    runs = (await session.execute(select(SimRun).order_by(desc(SimRun.id)).limit(25))).scalars()
    rec = (
        await session.execute(select(ReconcileEvent).order_by(desc(ReconcileEvent.id)).limit(25))
    ).scalars()
    jobs = (await session.execute(select(JobRun).order_by(desc(JobRun.id)).limit(25))).scalars()
    return S.StatusResponse(
        health=h,
        sim_runs=[
            {
                "id": r.id,
                "created_at": r.created_at.isoformat(),
                "trigger": r.trigger,
                "n_sims": r.n_sims,
                "duration_ms": r.duration_ms,
            }
            for r in runs
        ],
        reconcile=[
            {"id": r.id, "created_at": r.created_at.isoformat(), "kind": r.kind, "detail": r.detail}
            for r in rec
        ],
        jobs=[S.JobRunOut.model_validate(j) for j in jobs],
    )


# ----------------------------------------------------------------------
# Web push


@router.get("/push/key")
async def push_key(st: State) -> dict[str, str]:
    if not st.settings.vapid_public_key:
        raise HTTPException(404, "Push notifications are not configured on this server.")
    return {"key": st.settings.vapid_public_key}


@router.post("/push/subscribe", status_code=204)
async def push_subscribe(body: S.PushSubscribeRequest, session: Db, st: State) -> Response:
    from sqlalchemy.dialects.postgresql import insert

    from aftershock.db.models import PushSubscription, Team

    if not st.settings.vapid_public_key:
        raise HTTPException(404, "Push notifications are not configured on this server.")
    if await session.get(Team, body.team.upper()) is None:
        raise HTTPException(422, f"No team {body.team}")
    stmt = insert(PushSubscription).values(
        endpoint=body.subscription.endpoint,
        keys=body.subscription.keys.model_dump(),
        team=body.team.upper(),
        min_magnitude=body.min_magnitude,
    )
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=["endpoint"],
            set_={
                "keys": stmt.excluded["keys"],
                "team": stmt.excluded.team,
                "min_magnitude": stmt.excluded.min_magnitude,
            },
        )
    )
    await session.commit()
    return Response(status_code=204)


@router.post("/push/unsubscribe", status_code=204)
async def push_unsubscribe(body: S.PushSubscriptionIn, session: Db) -> Response:
    from sqlalchemy import delete as sql_delete

    from aftershock.db.models import PushSubscription

    await session.execute(
        sql_delete(PushSubscription).where(PushSubscription.endpoint == body.endpoint)
    )
    await session.commit()
    return Response(status_code=204)


# ----------------------------------------------------------------------
# Share images

OG_CACHE = {"Cache-Control": "public, max-age=3600"}


async def _png(svg: str) -> Response:
    from aftershock.share.cards import CairoUnavailable, render_png

    try:
        data = await asyncio.to_thread(render_png, svg)
    except CairoUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc
    return Response(data, media_type="image/png", headers=OG_CACHE)


async def _teams(session: AsyncSession) -> list[S.TeamInfo]:
    from aftershock.db.models import Team

    return [S.TeamInfo.model_validate(t) for t in (await session.execute(select(Team))).scalars()]


@router.get("/og/tremor/{tremor_id}.png")
async def og_tremor(tremor_id: int, session: Db, size: Literal["og", "card"] = "og") -> Response:
    from aftershock.share.cards import tremor_card, tremor_og

    row = await session.get(Tremor, tremor_id)
    if row is None:
        raise HTTPException(404, f"No tremor {tremor_id}")
    t = (await Q.tremors_out(session, [row]))[0]
    teams = await _teams(session)
    return await _png(tremor_card(t, teams) if size == "card" else tremor_og(t, teams))


@router.get("/og/team/{abbrev}.png")
async def og_team(abbrev: str, session: Db) -> Response:
    from aftershock.db.models import Team, TeamOdds
    from aftershock.share.cards import team_og

    team = await session.get(Team, abbrev.upper())
    if team is None:
        raise HTTPException(404, f"No team {abbrev}")
    run = await Q.latest_run(session, current_season())
    odds = await session.get(TeamOdds, (run.id, team.abbrev)) if run else None
    return await _png(team_og(S.TeamInfo.model_validate(team), Q.odds_out(odds) if odds else None))


@router.get("/og/night/{night}.png")
async def og_night(night: date, session: Db) -> Response:
    from aftershock.share.cards import night_og

    rows = list(
        (
            await session.execute(
                select(Tremor).where(Tremor.night_date == night, Tremor.overturned.is_(False))
            )
        ).scalars()
    )
    games = await Q.games_on(session, night)
    return await _png(night_og(night, await Q.tremors_out(session, rows), len(games)))


def _read_bytes(path: Path) -> bytes | None:
    return path.read_bytes() if path.exists() else None


def read_gz_json(path: Path) -> Any:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)
