"""The live worker: poll, simulate, persist, publish.

Exactly one worker runs as leader (a Postgres advisory lock). It drives
``SeasonEngine`` with ``LiveSource`` snapshots, writes every effect to
Postgres, then publishes typed messages to Redis for the API to fan out.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import time
from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from redis.asyncio import Redis
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncConnection

from aftershock.api import queries as Q
from aftershock.api import schemas as S
from aftershock.api.app import HEALTH_KEY, WHATIF_KEY, current_season
from aftershock.config import Settings, get_settings
from aftershock.db.models import Game, Tremor
from aftershock.db.session import get_engine, session_scope
from aftershock.jobs.ratings import all_game_rows, replay, run_ratings
from aftershock.live import persist as P
from aftershock.live.diff import NewPlay
from aftershock.live.engine import Effects, OddsSnapshot, SeasonEngine
from aftershock.live.publish import Publisher
from aftershock.live.source import LiveSource
from aftershock.live.state import build_state, hockey_night, odds_list, standings_rows
from aftershock.ml.strength_fit import load_params
from aftershock.ml.wp import WinProbModel
from aftershock.ml.xg import XgModel
from aftershock.nhl.client import NhlApiError, NhlClient
from aftershock.nhl.parse import LIVE_STATES, parse_play_by_play
from aftershock.sim.backend import SimBackend, default_backend
from aftershock.sim.backtest import load_shrink
from aftershock.sim.inputs import build_inputs, load_schedule
from aftershock.sim.whatif import whatif_payload
from aftershock.tremors.compute import magnitude_scale, rooting_guide, stakes

log = structlog.get_logger(__name__)

LEADER_LOCK = 0x4146_5445  # "AFTE"
EVENT_TYPES = frozenset({"goal", "penalty"})
REPLAY_TYPES = frozenset(
    {"game_update", "tremor", "tremor_updated", "tremor_reversed", "odds_update"}
)
DRIFT_S = 10.0
FULL_RERUN_S = 300.0
STATE_S = 15.0
STATE_REFRESH_S = 300.0
ESS_FLOOR = 0.5


class Worker:
    def __init__(self, settings: Settings | None = None, backend: SimBackend | None = None) -> None:
        self.settings = settings or get_settings()
        self.backend = backend or default_backend()
        self.redis = Redis.from_url(self.settings.redis_url, decode_responses=True)
        self.publisher = Publisher(self.redis)  # type: ignore[arg-type]
        self.client = NhlClient(self.settings)
        self.season = current_season()
        self.state_version = 0
        self.sim_run_id: int | None = None
        self.day_start: Any = None
        self.day: Any = None
        self.standings: list[S.StandingsRow] = []
        self.stakes: dict[int, float] = {}
        self.games: dict[int, S.GameSummary] = {}
        self.engine: SeasonEngine | None = None
        self._lock_conn: AsyncConnection | None = None
        self._state_dirty = True
        self._last_final_at: datetime | None = None
        self._nightly_done: Any = None
        # Everything published tonight, kept to write the night's replay bundle.
        self.night_frames: list[dict[str, Any]] = []
        self.night_initial: dict[str, Any] | None = None
        self._last_full_state = 0.0

    # ------------------------------------------------------------------
    # Startup

    async def acquire_leadership(self) -> None:
        conn = await get_engine().connect()
        while True:
            got = await conn.scalar(text("SELECT pg_try_advisory_lock(:k)"), {"k": LEADER_LOCK})
            if got:
                self._lock_conn = conn
                log.info("worker.leader")
                return
            log.info("worker.waiting_for_leader_lock")
            await asyncio.sleep(10)

    async def boot(self) -> None:
        params = load_params(self.settings)
        rows = await asyncio.to_thread(all_game_rows, self.settings)
        rating_engine, _, _ = await asyncio.to_thread(replay, rows, params)
        async with session_scope() as s:
            schedule = await load_schedule(s, self.season, self.settings)
            inputs = await build_inputs(
                s,
                schedule,
                rating_engine,
                params,
                datetime.now(UTC),
                shrink=load_shrink(self.settings),
            )
            lam = {
                g: (h, a)
                for g, h, a in (
                    await s.execute(
                        text(
                            "SELECT p.game_id, p.exp_home_goals, p.exp_away_goals "
                            "FROM game_pregame p "
                            "JOIN games g ON g.id = p.game_id WHERE g.season = :s"
                        ),
                        {"s": self.season},
                    )
                )
            }
        self.engine = SeasonEngine(
            inputs=inputs,
            backend=self.backend,
            wp_model=WinProbModel.load(self.settings),
            xg_model=XgModel.load(self.settings),
            params=params,
            n_sims=self.settings.sim_n,
            magnitude=magnitude_scale(self.settings),
            pregame_lambdas=lambda gid: lam.get(gid),
        )
        self.rating_engine = rating_engine
        snap = self.engine.full_run("nightly")
        await self.persist_run(snap, full=True)
        self.day_start = snap.output
        self.day = hockey_night(datetime.now(UTC))
        self.night_frames = []
        self.night_initial = {"odds": [o.model_dump(mode="json") for o in odds_list(snap.output)]}
        await self.refresh_standings()
        await self.publish_whatif()
        await self.publish_odds(snap)
        await self.publish_state(force=True)
        log.info(
            "worker.booted",
            season=self.season,
            games=inputs.schedule.n,
            sim_ms=round(snap.output.duration_ms, 1),
        )

    # ------------------------------------------------------------------
    # Persistence and publishing

    async def persist_run(self, snap: OddsSnapshot, *, full: bool) -> int:
        assert self.engine is not None
        out = snap.output
        focus = [int(i) for i in out.focus]
        sch = snap.inputs.schedule
        async with session_scope() as s:
            run_id = await P.save_run(s, snap, self.season)
            if full and len(focus):
                lev = stakes(out)
                games: list[dict[str, Any]] = [
                    {
                        "game_id": int(sch.game_ids[i]),
                        "start_utc": sch.start_utc[i],
                        "home": sch.teams[int(sch.home[i])],
                        "away": sch.teams[int(sch.away[i])],
                    }
                    for i in focus
                ]
                guides = {t: rooting_guide(out, t, games) for t in out.teams}
                self.stakes = {int(sch.game_ids[i]): lev[j] for j, i in enumerate(focus)}
                await P.save_conditional(
                    s, run_id, out, [int(g["game_id"]) for g in games], lev, guides
                )
        self.sim_run_id = run_id
        self._state_dirty = True
        return run_id

    async def publish(self, kind: str, payload: dict[str, Any]) -> None:
        msg = await self.publisher.publish(kind, payload)
        if kind in REPLAY_TYPES:
            self.night_frames.append(msg)

    async def publish_odds(self, snap: OddsSnapshot) -> None:
        await self.publisher.publish(
            "odds_update",
            {
                "sim_run_id": self.sim_run_id or 0,
                "trigger": snap.trigger,
                "odds": [o.model_dump(mode="json") for o in odds_list(snap.output)],
            },
        )

    async def publish_whatif(self) -> None:
        assert self.engine is not None
        payload = whatif_payload(self.engine.inputs, self.season, self.stakes)
        await self.redis.set(WHATIF_KEY, json.dumps(payload, separators=(",", ":")))

    async def reconcile(self, rows: list[S.StandingsRow]) -> int:
        """Compare standings computed from our results with NHL.com's; log mismatches.

        The API's numbers are what we display either way; a mismatch means
        our stored results are missing or wrong somewhere.
        """
        assert self.engine is not None
        import aftershock_core
        import numpy as np

        inp = self.engine.inputs
        done = np.flatnonzero(inp.status == 2)
        sch = inp.schedule
        ours = aftershock_core.standings(
            sch.config,
            sch.home[done],
            sch.away[done],
            inp.home_goals[done],
            inp.away_goals[done],
            inp.end[done],
        )
        by_team = {t: i for i, t in enumerate(ours["teams"])}
        mismatches = []
        for r in rows:
            i = by_team.get(r.team)
            if i is None:
                continue
            fields = {
                "w": r.w,
                "l": r.l,
                "otl": r.otl,
                "points": r.points,
                "rw": r.rw,
                "row": r.row,
                "gf": r.gf,
                "ga": r.ga,
            }
            diff = {
                k: {"ours": int(ours[k][i]), "nhl": v}
                for k, v in fields.items()
                if int(ours[k][i]) != v
            }
            if diff:
                mismatches.append({"team": r.team, "fields": diff})
        if mismatches:
            from aftershock.db.models import ReconcileEvent

            async with session_scope() as s:
                s.add(ReconcileEvent(kind="standings", detail={"teams": mismatches}))
            log.warning("worker.standings_mismatch", teams=[m["team"] for m in mismatches])
        return len(mismatches)

    async def refresh_schedule(self) -> None:
        """Reload this season's schedule and results (postponements, reschedules)."""
        from aftershock.ingest.fetch import fetch_season, season_infos
        from aftershock.jobs.backfill import load_season

        infos = await season_infos(self.client)
        info = infos.get(self.season)
        if info is None:
            return
        await fetch_season(self.client, info, is_current=True)
        await load_season(self.client, info, is_current=True)

    async def refresh_standings(self) -> None:
        try:
            raw = await self.client.standings()
        except NhlApiError as exc:
            log.warning("worker.standings_failed", error=str(exc))
            return
        rows = standings_rows(raw)
        if rows and rows != self.standings:
            self.standings = rows
            self._state_dirty = True
            await self.publisher.publish(
                "standings_update", {"standings": [r.model_dump(mode="json") for r in rows]}
            )

    async def publish_state(self, *, force: bool = False) -> None:
        if not (force or self._state_dirty):
            return
        assert self.engine is not None
        self.state_version += 1
        async with session_scope() as s:
            state = await build_state(
                s,
                season=self.season,
                now=datetime.now(UTC),
                state_version=self.state_version,
                sim_run_id=self.sim_run_id,
                current=self.engine.current,
                day_start=self.day_start,
                standings=self.standings,
                games=self.games,
                stakes=self.stakes,
                demo_mode=self.settings.demo_mode,
            )
        prev_mode = (await self.publisher.get_state() or {}).get("mode")
        await self.publisher.set_state(state)
        if force or prev_mode != state.mode:
            await self.publisher.publish(
                "hello",
                {
                    "mode": state.mode,
                    "server_time": datetime.now(UTC).isoformat(),
                    "state_version": self.state_version,
                },
            )
        self._state_dirty = False

    async def write_health(self) -> None:
        stats = self.client.stats.last_success
        await self.redis.set(
            HEALTH_KEY,
            json.dumps(
                {
                    "heartbeat": datetime.now(UTC).isoformat(),
                    "last_poll": {
                        k: datetime.fromtimestamp(v, UTC).isoformat() for k, v in stats.items()
                    },
                }
            ),
        )

    # ------------------------------------------------------------------
    # Snapshots

    async def on_snapshot(self, raw: dict[str, Any]) -> None:
        assert self.engine is not None
        game = parse_play_by_play(raw)
        eff = await asyncio.to_thread(self.engine.handle, raw, game)
        normalized = {p.event_id: p for p in game.plays}
        async with session_scope() as s:
            if eff.diff is not None:
                await P.save_game_state(s, eff.diff.meta)
                await P.save_plays(s, eff.diff, normalized)
            await P.save_xg(s, game.meta.id, eff.xg)
            await P.save_wp(s, game.meta.id, eff.wp_points)
        await self.apply_effects(eff, game.meta.id)

    async def apply_effects(self, eff: Effects, game_id: int) -> None:
        assert self.engine is not None
        published: list[tuple[str, dict[str, Any]]] = []
        lg = self.engine.games.get(game_id)
        venue_lat = venue_lon = None
        async with session_scope() as s:
            g = await s.get(Game, game_id)
            if g is not None:
                row = (
                    await s.execute(
                        text("SELECT v.lat, v.lon FROM venues v WHERE v.name = :n"), {"n": g.venue}
                    )
                ).first()
                if row is None:
                    row = (
                        await s.execute(
                            text("SELECT lat, lon FROM teams WHERE abbrev = :t"), {"t": g.home}
                        )
                    ).first()
                if row is not None:
                    venue_lat, venue_lon = float(row[0]), float(row[1])
            for rec in eff.tremors:
                before = OddsSnapshot(
                    "goal",
                    f"before:{game_id}:{rec.event_id}",
                    rec.calc.before,
                    self.engine.inputs,
                    rec.at,
                )
                after = OddsSnapshot(
                    "goal", f"{game_id}:{rec.event_id}", rec.calc.after, self.engine.inputs, rec.at
                )
                run_b = await P.save_run(s, before, self.season, with_odds=False)
                run_a = await P.save_run(s, after, self.season)
                self.sim_run_id = run_a
                rec.id = await P.save_tremor(
                    s, P.tremor_row(rec, run_b, run_a, venue_lat, venue_lon)
                )
            for rec, calc in eff.reversals:
                if rec.id is not None:
                    await P.mark_overturned(s, rec.id)
                snap = OddsSnapshot(
                    "goal_reversed",
                    f"{game_id}:{rec.event_id}",
                    calc.after,
                    self.engine.inputs,
                    rec.at,
                )
                self.sim_run_id = await P.save_run(s, snap, self.season)
            for rec, changes in eff.corrections:
                if rec.id is not None:
                    await P.update_attribution(s, rec.id, changes)
            if eff.tremors or eff.reversals:
                await P.refresh_ppa_view(s)
            if eff.tremors:
                rows = (
                    await s.execute(
                        select(Tremor).where(Tremor.id.in_([r.id for r in eff.tremors if r.id]))
                    )
                ).scalars()
                for t in await Q.tremors_out(s, list(rows)):
                    published.append(("tremor", {"tremor": t.model_dump(mode="json")}))
            for rec, _calc in eff.reversals:
                if rec.id is None:
                    continue
                trow = await s.get(Tremor, rec.id)
                if trow is not None:
                    t = (await Q.tremors_out(s, [trow]))[0]
                    published.append(
                        (
                            "tremor_reversed",
                            {
                                "tremor_id": rec.id,
                                "game_id": game_id,
                                "origin": t.origin.model_dump(mode="json"),
                                "deltas": [d.model_dump(mode="json") for d in t.deltas],
                            },
                        )
                    )
            for rec, changes in eff.corrections:
                if rec.id is None:
                    continue
                names = await Q.player_names(s, {v for v in changes.values() if v})
                published.append(
                    (
                        "tremor_updated",
                        {
                            "tremor_id": rec.id,
                            "changes": {
                                k.removesuffix("_id"): (
                                    {"id": v, "name": names.get(v, str(v))} if v else None
                                )
                                for k, v in changes.items()
                            },
                        },
                    )
                )
            if g is not None and lg is not None:
                summary = Q.game_summary(g)
                if lg.wp:
                    summary.wp = S.SixWay(**lg.wp)
                summary.stakes = self.stakes.get(game_id)
                self.games[game_id] = summary
        if eff.diff is not None:
            meta = eff.diff.meta
            abbrev = {meta.home.id: meta.home.abbrev, meta.away.id: meta.away.abbrev}
            for c in eff.diff.changes:
                if not isinstance(c, NewPlay) or c.play.type not in EVENT_TYPES:
                    continue
                p = c.play
                await self.publisher.publish(
                    "event",
                    {
                        "game_id": game_id,
                        "event_id": p.event_id,
                        "kind": p.type,
                        "period": p.period,
                        "t_period_s": p.t_period_s,
                        "team": abbrev.get(p.owner_team_id) if p.owner_team_id else None,
                        "x": p.x_norm,
                        "y": p.y_norm,
                    },
                )
        if eff.game_updates and game_id in self.games:
            await self.publish("game_update", {"game": self.games[game_id].model_dump(mode="json")})
        for kind, payload in published:
            await self.publish(kind, payload)
        for snap in eff.odds:
            await self.persist_run(snap, full=True)
        if eff.odds:
            await self.publish_odds(eff.odds[-1])
        elif (eff.tremors or eff.reversals) and self.engine.current is not None:
            await self.publish_odds(
                OddsSnapshot(
                    "goal", None, self.engine.current, self.engine.inputs, datetime.now(UTC)
                )
            )
        if eff.finals:
            self._last_final_at = datetime.now(UTC)
            await self.refresh_standings()
            await self.publish_whatif()
        if eff.period_ends and not eff.odds:
            snap = self.engine.full_run("period_end", str(game_id))
            await self.persist_run(snap, full=True)
            await self.publish_odds(snap)
        self._state_dirty = True

    # ------------------------------------------------------------------
    # Periodic work

    async def drift(self) -> None:
        """Every 10 s: reweight by the live games' current win probability."""
        assert self.engine is not None
        live = [
            lg
            for lg in self.engine.games.values()
            if not lg.finished and lg.meta.state in LIVE_STATES
        ]
        if not live:
            return
        if time.monotonic() - self.engine.last_full_run > FULL_RERUN_S:
            snap = self.engine.full_run("drift")
            await self.persist_run(snap, full=True)
            await self.publish_odds(snap)
            return
        res = self.engine.reweight_live()
        if res is None:
            return
        probs, ess = res
        if ess < ESS_FLOOR * self.engine.n_sims:
            snap = self.engine.full_run("drift")
            await self.persist_run(snap, full=True)
            await self.publish_odds(snap)
            return
        cur = self.engine.current
        assert cur is not None
        odds = odds_list(cur)
        for i, o in enumerate(odds):
            o.p_playoffs = float(probs["p_playoffs"][i])
            o.p_division = float(probs["p_division"][i])
            o.p_cup = float(probs["p_cup"][i])
        await self.publish(
            "odds_update",
            {
                "sim_run_id": self.sim_run_id or 0,
                "trigger": "drift",
                "odds": [o.model_dump(mode="json") for o in odds],
            },
        )

    async def nightly(self) -> None:
        """06:00 Eastern: new hockey day. Refresh ratings, inputs, and the day's baseline."""
        now = datetime.now(UTC)
        night = hockey_night(now)
        if self.day == night:
            return
        log.info("worker.new_day", night=str(night))
        await self.refresh_schedule()
        await run_ratings(self.settings)
        await self.boot()
        await self.reconcile(self.standings)

    async def maybe_recap(self) -> None:
        """Fifteen minutes after the night's last game goes final."""
        if self._last_final_at is None:
            return
        if datetime.now(UTC) - self._last_final_at < timedelta(minutes=15):
            return
        async with session_scope() as s:
            night = hockey_night(self._last_final_at)
            pending = await s.scalar(
                text(
                    "SELECT count(*) FROM games WHERE night_date = :d AND state NOT IN "
                    "('FINAL', 'OFF', 'PPD', 'CNCL')"
                ),
                {"d": night},
            )
        if pending:
            return
        self._last_final_at = None
        await self.write_night_bundle(night)
        from aftershock.recap.generate import generate_recap

        await generate_recap(night, self.settings)
        await self.publisher.publish("recap_ready", {"night_date": night.isoformat()})

    async def write_night_bundle(self, night: Any) -> None:
        """Save tonight's published messages as the night's replay bundle."""
        import gzip

        from sqlalchemy.dialects.postgresql import insert

        from aftershock.db.models import ReplayBundle
        from aftershock.jobs.precompute import energy, replay_dir

        async with session_scope() as s:
            games = await Q.games_on(s, night)
        if not games or not self.night_frames:
            return
        start = min(g.start_utc for g in games)
        frames: list[dict[str, Any]] = []
        for m in self.night_frames:
            t = int((datetime.fromisoformat(m["ts"]) - start).total_seconds() * 1000)
            frames.append({"t": max(0, t), "message": m})
        initial_games = [
            g.model_copy(
                update={
                    "state": "FUT",
                    "period": None,
                    "period_type": None,
                    "clock_seconds": None,
                    "home_score": None,
                    "away_score": None,
                    "home_sog": None,
                    "away_sog": None,
                    "last_period_type": None,
                    "wp": None,
                }
            )
            for g in games
        ]
        bundle = S.ReplayBundleOut(
            night_date=night,
            season=self.season,
            start_utc=start,
            duration_ms=max(f["t"] for f in frames) + 60_000,
            initial=S.ReplayInitial(
                odds=[S.TeamOdds(**o) for o in (self.night_initial or {}).get("odds", [])],
                standings=self.standings,
                games=initial_games,
            ),
            frames=[S.ReplayFrame.model_validate(f) for f in frames],
        )
        path = replay_dir(self.settings, self.season) / f"{night.isoformat()}.json.gz"
        path.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(path.write_bytes, gzip.compress(bundle.model_dump_json().encode()))
        mags = [
            f["message"]["tremor"]["magnitude"] for f in frames if f["message"]["type"] == "tremor"
        ]
        async with session_scope() as s:
            stmt = insert(ReplayBundle).values(
                night_date=night,
                season=self.season,
                path=str(path.relative_to(self.settings.data_dir)),
                total_energy=energy(mags),
                n_games=len(games),
                n_tremors=len(mags),
            )
            await s.execute(
                stmt.on_conflict_do_update(
                    index_elements=["night_date"],
                    set_={
                        c: stmt.excluded[c]
                        for c in ("path", "total_energy", "n_games", "n_tremors")
                    },
                )
            )
        log.info("worker.night_bundle", night=str(night), frames=len(frames))

    async def periodic(self) -> None:
        last_state = 0.0
        while True:
            try:
                await self.write_health()
                await self.drift()
                if time.monotonic() - last_state > STATE_S:
                    # Refresh at least every five minutes so the mode (live or
                    # demo) and tonight's clock follow the schedule.
                    stale = time.monotonic() - self._last_full_state > STATE_REFRESH_S
                    await self.publish_state(force=stale)
                    if stale:
                        self._last_full_state = time.monotonic()
                    last_state = time.monotonic()
                await self.nightly()
                await self.maybe_recap()
            except Exception as exc:
                log.exception("worker.periodic_failed", error=str(exc))
            await asyncio.sleep(DRIFT_S)

    async def consume(self) -> None:
        source = LiveSource(
            self.client,
            live_interval=self.settings.poll_live_seconds,
            pregame_interval=self.settings.poll_pregame_seconds,
            score_interval=self.settings.poll_score_seconds,
        )
        async for snap in source.snapshots():
            try:
                await self.on_snapshot(snap.raw)
            except Exception as exc:
                log.exception("worker.snapshot_failed", game=snap.game_id, error=str(exc))

    async def run(self) -> None:
        await self.acquire_leadership()
        await self.boot()
        tasks = [asyncio.create_task(self.consume()), asyncio.create_task(self.periodic())]
        try:
            await asyncio.gather(*tasks)
        finally:
            for t in tasks:
                t.cancel()
            await self.client.aclose()
            await self.redis.aclose()
            if self._lock_conn is not None:
                with contextlib.suppress(Exception):
                    await self._lock_conn.close()
