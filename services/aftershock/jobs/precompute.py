"""Precompute a past season: tremors, odds history, and replay bundles.

Replays every night of a season through the same ``SeasonEngine`` the live
worker uses, with only information available at the time: ratings as of
that morning (shrunk for simulated games, as tuned by the backtest), results
of earlier nights, and each game's as-of pregame expectation. Each night is
also written as a replay bundle for the web client.

Resumable: nights already bundled are skipped, but the season state is
still rebuilt from their results.
"""

from __future__ import annotations

import gzip
import json
import math
import time
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import numpy as np
import structlog
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert

from aftershock.api import queries as Q
from aftershock.api import schemas as S
from aftershock.config import Settings, get_settings
from aftershock.db.models import Game, GamePregame, JobRun, ReplayBundle, Tremor
from aftershock.db.session import session_scope
from aftershock.jobs.ratings import all_game_rows
from aftershock.live import persist as P
from aftershock.live.engine import OddsSnapshot, SeasonEngine
from aftershock.live.source import ReplayGame
from aftershock.live.state import odds_list
from aftershock.ml.strength import RatingEngine, records_from_table
from aftershock.ml.strength_fit import load_params
from aftershock.ml.wp import WinProbModel
from aftershock.ml.xg import XgModel
from aftershock.nhl.client import NhlClient
from aftershock.nhl.parse import parse_play_by_play
from aftershock.sim.backend import SimBackend, default_backend
from aftershock.sim.backtest import load_shrink, shrunk
from aftershock.sim.inputs import (
    END_CODES,
    STATUS_FINAL,
    SimInputs,
    league_config,
    load_schedule,
    playoff_matrix,
)
from aftershock.tremors.compute import MagnitudeScale, magnitude_scale

log = structlog.get_logger(__name__)

EVERY_N_PLAYS = 20
KEY_TYPES = frozenset({"goal", "period-end", "game-end", "shootout-complete"})


def replay_dir(settings: Settings, season: int) -> Path:
    return settings.data_dir / "replays" / str(season)


def energy(magnitudes: list[float]) -> float:
    """Richter-style energy: each magnitude step is 10^1.5 times the energy."""
    return float(sum(10 ** (1.5 * m) for m in magnitudes))


@dataclass
class NightFrames:
    frames: list[dict[str, Any]]
    seq: int = 0

    def add(self, t_ms: int, msg_type: str, payload: dict[str, Any], at: datetime) -> None:
        self.seq += 1
        self.frames.append(
            {
                "t": max(0, t_ms),
                "message": {**payload, "type": msg_type, "seq": self.seq, "ts": at.isoformat()},
            }
        )


def key_indices(game: ReplayGame) -> list[int]:
    """Play counts after which to take a snapshot."""
    out = []
    for i, p in enumerate(game.plays):
        if p.get("typeDescKey") in KEY_TYPES or (i + 1) % EVERY_N_PLAYS == 0:
            out.append(i + 1)
    if not out or out[-1] != len(game.plays):
        out.append(len(game.plays))
    return out


def check_finals(inputs: SimInputs, games: list[Game], night: date) -> None:
    """Every game played through ``night`` must be final in the simulator
    inputs, or the odds would be simulated from stale standings."""
    expected = sum(
        1
        for g in games
        if g.night_date <= night
        and g.last_period_type is not None
        and g.id in inputs.schedule.index
    )
    got = int((inputs.status == STATUS_FINAL).sum())
    if got != expected:
        raise RuntimeError(f"{night}: {got} games final in the simulator, expected {expected}")


class SeasonPrecompute:
    def __init__(
        self,
        season: int,
        settings: Settings | None = None,
        backend: SimBackend | None = None,
        *,
        relink: bool = False,
    ) -> None:
        self.season = season
        self.relink = relink
        self.s = settings or get_settings()
        self.backend = backend or default_backend()
        self.params = load_params(self.s)
        self.shrink = load_shrink(self.s)
        self.wp = WinProbModel.load(self.s)
        self.xg = XgModel.load(self.s)
        self.scale = magnitude_scale(self.s)
        self.n_sims = self.s.sim_n_backfill
        self.cfg = league_config(season, self.s)

    async def run(self, only: set[date] | None = None, *, force: bool = False) -> dict[str, Any]:
        """Precompute every night (or only ``only``). Nights with a replay are
        skipped unless ``force``."""
        started = time.monotonic()
        async with session_scope() as s:
            job = JobRun(job=f"precompute:{self.season}", status="running", detail={})
            s.add(job)
            await s.flush()
            job_id = job.id
            schedule = await load_schedule(s, self.season, self.s)
            games = list(
                (
                    await s.execute(
                        select(Game)
                        .where(Game.season == self.season, Game.game_type.in_((2, 3)))
                        .order_by(Game.start_utc, Game.id)
                    )
                ).scalars()
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
                ).all()
            }
            done = {
                d
                for (d,) in (
                    await s.execute(
                        select(ReplayBundle.night_date).where(ReplayBundle.season == self.season)
                    )
                ).all()
            }
        nights = sorted({g.night_date for g in games})
        rows = sorted(all_game_rows(self.s), key=lambda r: (r["start_utc"], r["game_id"]))
        records = records_from_table(rows)
        engine = RatingEngine(params=self.params)
        cursor = 0
        n = schedule.n
        inputs = SimInputs(
            schedule=schedule,
            status=np.zeros(n, np.uint8),
            home_goals=np.zeros(n, np.uint8),
            away_goals=np.zeros(n, np.uint8),
            end=np.zeros(n, np.uint8),
            live_home=np.zeros(n, np.uint8),
            live_away=np.zeros(n, np.uint8),
            probs=np.zeros((n, 6), np.float32),
            lam=np.zeros((n, 2), np.float32),
            playoff_p=np.zeros((len(schedule.teams),) * 2, np.float32),
            tie_theta=self.params.tie_theta,
            focus=np.zeros(0, np.uint32),
            team_sigma=self.shrink.sigma,
        )
        by_night: dict[date, list[Game]] = {}
        for g in games:
            by_night.setdefault(g.night_date, []).append(g)
        client = NhlClient(self.s)
        stats = {"nights": 0, "tremors": 0, "skipped": 0}
        try:
            for night in nights:
                # Ratings as of this morning: every game before tonight.
                while cursor < len(records) and records[cursor].day < night:
                    r = records[cursor]
                    engine.start_season(r.season)
                    engine.update(
                        r.home,
                        r.away,
                        r.day,
                        home_goals=r.home_goals,
                        away_goals=r.away_goals,
                        home_xg=r.home_xg,
                        away_xg=r.away_xg,
                        minutes=r.minutes,
                    )
                    cursor += 1
                engine.start_season(self.season)
                self._refresh_future(inputs, engine)
                tonight = [g for g in by_night[night] if g.last_period_type is not None]
                if (night in done and not force) or (only is not None and night not in only):
                    self._apply_finals(inputs, tonight)
                    check_finals(inputs, games, night)
                    stats["skipped"] += 1
                    continue
                finals = []
                for g in tonight:
                    raw = client.read_cache("play-by-play", str(g.id))
                    if raw is None:
                        raw = await client.play_by_play(g.id)
                    finals.append(raw)
                # The engine swaps in a new inputs object on every tremor, so
                # carry its state forward rather than the one passed in.
                n_tremors, inputs = await self._night(night, finals, inputs, lam)
                self._apply_finals(inputs, tonight)
                check_finals(inputs, games, night)
                stats["nights"] += 1
                stats["tremors"] += n_tremors
                log.info(
                    "precompute.night",
                    season=self.season,
                    night=str(night),
                    games=len(finals),
                    tremors=n_tremors,
                )
        finally:
            await client.aclose()
            async with session_scope() as s:
                job_row = await s.get(JobRun, job_id)
                if job_row is not None:
                    job_row.status = "ok"
                    job_row.finished_at = datetime.now(UTC)
                    job_row.detail = {**stats, "seconds": round(time.monotonic() - started)}
        return stats

    def _refresh_future(self, inputs: SimInputs, engine: RatingEngine) -> None:
        sch = inputs.schedule
        played = int((inputs.status == STATUS_FINAL).sum())
        eng = shrunk(engine, self.shrink(played / max(sch.n, 1)))
        for i in range(sch.n):
            if inputs.status[i] == STATUS_FINAL:
                continue
            pre = eng.predict(sch.teams[int(sch.home[i])], sch.teams[int(sch.away[i])], None)
            inputs.probs[i] = pre.p
            inputs.lam[i] = (pre.lam_home, pre.lam_away)
        inputs.playoff_p = playoff_matrix(eng, sch.teams)

    def _apply_finals(self, inputs: SimInputs, games: list[Game]) -> None:
        # Skipped nights fall through here too, so every played game is final.
        for g in games:
            if g.id in inputs.schedule.index and g.home_score is not None:
                inputs.set_final(
                    g.id,
                    g.home_score,
                    g.away_score or 0,
                    END_CODES.get(g.last_period_type or "REG", 0),
                )

    async def _night(
        self,
        night: date,
        finals: list[dict[str, Any]],
        inputs: SimInputs,
        lam: dict[int, tuple[float, float]],
    ) -> tuple[int, SimInputs]:
        replays = [ReplayGame(f) for f in finals]
        start = min(r.start for r in replays)
        clock = {"now": start}
        sch = inputs.schedule
        focus = [sch.index[r.game_id] for r in replays if r.game_id in sch.index]
        inputs.focus = np.array(focus, dtype=np.uint32)
        engine = SeasonEngine(
            inputs=inputs,
            backend=self.backend,
            wp_model=self.wp,
            xg_model=self.xg,
            params=self.params,
            n_sims=self.n_sims,
            magnitude=self.scale,
            seed=int(night.strftime("%Y%m%d")),
            pregame_lambdas=lambda gid: lam.get(gid),
            clock=lambda: clock["now"],
        )
        base = engine.full_run("nightly", night.isoformat())
        frames = NightFrames([])
        async with session_scope() as s:
            base_run = None if self.relink else await P.save_run(s, base, self.season)
            standings = await self._standings(inputs)
            initial_games = [
                Q.game_summary(g, pg)
                for g, pg in (
                    await s.execute(
                        select(Game, GamePregame)
                        .outerjoin(GamePregame, GamePregame.game_id == Game.id)
                        .where(Game.night_date == night, Game.game_type.in_((2, 3)))
                        .order_by(Game.start_utc)
                    )
                ).all()
            ]
        # The bundle starts before puck drop: no scores, no outcomes yet.
        initial_games = [
            g.model_copy(
                update={
                    "state": "FUT",
                    "period": None,
                    "period_type": None,
                    "clock_seconds": None,
                    "in_intermission": False,
                    "home_score": None,
                    "away_score": None,
                    "home_sog": None,
                    "away_sog": None,
                    "last_period_type": None,
                }
            )
            for g in initial_games
        ]
        initial_by_id = {g.id: g for g in initial_games}
        # Every game's snapshots in wall-clock order across the night.
        events: list[tuple[datetime, int, int]] = []
        for gi, r in enumerate(replays):
            for n in key_indices(r):
                off = r.offsets[n - 1] if n > 0 else 0.0
                events.append((r.start + _seconds(off), gi, n))
        events.sort()
        magnitudes: list[float] = []
        n_tremors = 0
        for at, gi, n in events:
            r = replays[gi]
            finished = n == len(r.plays)
            doc = r.at_index(n, finished=finished)
            clock["now"] = at
            game = parse_play_by_play(doc)
            eff = engine.handle(doc, game)
            t_ms = int((at - start).total_seconds() * 1000)
            async with session_scope() as s:
                if self.relink:
                    # A night the live worker already recorded: link each goal
                    # to its stored tremor, write nothing new.
                    for rec in eff.tremors:
                        rec.id = await s.scalar(
                            select(Tremor.id).where(
                                Tremor.game_id == rec.game_id, Tremor.event_id == rec.event_id
                            )
                        )
                else:
                    await P.save_xg(s, game.meta.id, eff.xg)
                    await P.save_wp(s, game.meta.id, eff.wp_points)
                    for rec in eff.tremors:
                        after = OddsSnapshot(
                            "goal",
                            f"{rec.game_id}:{rec.event_id}",
                            rec.calc.after,
                            engine.inputs,
                            at,
                        )
                        run_a = await P.save_run(s, after, self.season)
                        venue = await _venue(s, game.meta.venue, game.meta.home.abbrev)
                        rec.id = await P.save_tremor(s, P.tremor_row(rec, None, run_a, *venue))
                    for snap in eff.odds:
                        await P.save_run(s, snap, self.season)
                rows = []
                if eff.tremors:
                    tr = (
                        await s.execute(
                            select(Tremor).where(Tremor.id.in_([t.id for t in eff.tremors if t.id]))
                        )
                    ).scalars()
                    rows = await Q.tremors_out(s, list(tr))
            summary = initial_by_id.get(game.meta.id)
            if summary is not None:
                lg = engine.games.get(game.meta.id)
                m = game.meta
                summary = summary.model_copy(
                    update={
                        "state": "OFF" if finished else "LIVE",
                        "period": m.period,
                        "period_type": m.period_type,
                        "clock_seconds": m.clock_seconds,
                        "in_intermission": m.in_intermission,
                        "home_score": m.home.score,
                        "away_score": m.away.score,
                        "home_sog": m.home.sog,
                        "away_sog": m.away.sog,
                        "last_period_type": m.last_period_type if finished else None,
                        "wp": S.SixWay(**lg.wp) if lg and lg.wp else None,
                    }
                )
                initial_by_id[game.meta.id] = summary
                frames.add(t_ms, "game_update", {"game": summary.model_dump(mode="json")}, at)
            for t in rows:
                frames.add(t_ms, "tremor", {"tremor": t.model_dump(mode="json")}, at)
                magnitudes.append(t.magnitude)
                n_tremors += 1
            if eff.tremors or eff.odds:
                out = eff.odds[-1].output if eff.odds else engine.current
                if out is not None:
                    frames.add(
                        t_ms,
                        "odds_update",
                        {
                            "sim_run_id": base_run,
                            "trigger": "goal" if eff.tremors else "final",
                            "odds": [o.model_dump(mode="json") for o in odds_list(out)],
                        },
                        at,
                    )
        duration_ms = max((f["t"] for f in frames.frames), default=0) + 60_000
        bundle = S.ReplayBundleOut(
            night_date=night,
            season=self.season,
            start_utc=start,
            duration_ms=duration_ms,
            initial=S.ReplayInitial(
                odds=odds_list(base.output), standings=standings, games=initial_games
            ),
            frames=[S.ReplayFrame.model_validate(f) for f in frames.frames],
        )
        path = replay_dir(self.s, self.season) / f"{night.isoformat()}.json.gz"
        path.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(path, "wt", encoding="utf-8") as fh:
            fh.write(bundle.model_dump_json())
        async with session_scope() as s:
            stmt = insert(ReplayBundle).values(
                night_date=night,
                season=self.season,
                path=str(path.relative_to(self.s.data_dir)),
                total_energy=energy(magnitudes),
                n_games=len(replays),
                n_tremors=n_tremors,
            )
            await s.execute(
                stmt.on_conflict_do_update(
                    index_elements=["night_date"],
                    set_={
                        c: stmt.excluded[c]
                        for c in ("season", "path", "total_energy", "n_games", "n_tremors")
                    },
                )
            )
            await P.refresh_ppa_view(s)
        return n_tremors, engine.inputs

    async def _standings(self, inputs: SimInputs) -> list[S.StandingsRow]:
        import aftershock_core

        sch = inputs.schedule
        done = np.flatnonzero(inputs.status == STATUS_FINAL)
        res = aftershock_core.standings(
            sch.config,
            sch.home[done],
            sch.away[done],
            inputs.home_goals[done],
            inputs.away_goals[done],
            inputs.end[done],
        )
        div_of = {t: d["name"] for d in self.cfg["divisions"] for t in d["teams"]}
        conf_of = {dv: c["name"] for c in self.cfg["conferences"] for dv in c["divisions"]}
        out = []
        for i, team in enumerate(res["teams"]):
            gp = int(res["w"][i] + res["l"][i] + res["otl"][i])
            div = div_of.get(team, "")
            out.append(
                S.StandingsRow(
                    team=team,
                    conference=conf_of.get(div, ""),
                    division=div,
                    gp=gp,
                    w=int(res["w"][i]),
                    l=int(res["l"][i]),
                    otl=int(res["otl"][i]),
                    points=int(res["points"][i]),
                    points_pct=float(res["points"][i]) / (2 * gp) if gp else 0.0,
                    rw=int(res["rw"][i]),
                    row=int(res["row"][i]),
                    gf=int(res["gf"][i]),
                    ga=int(res["ga"][i]),
                    division_rank=int(res["division_rank"][i]),
                    conference_rank=int(res["conference_rank"][i]),
                    league_rank=int(res["league_rank"][i]),
                    wildcard_rank=int(res["wildcard_rank"][i]) or None,
                )
            )
        return out


def _seconds(x: float) -> Any:
    from datetime import timedelta

    return timedelta(seconds=x)


async def _venue(session: Any, name: str | None, home: str) -> tuple[float | None, float | None]:
    row = (
        (
            await session.execute(text("SELECT lat, lon FROM venues WHERE name = :n"), {"n": name})
        ).first()
        if name
        else None
    )
    if row is None:
        row = (
            await session.execute(text("SELECT lat, lon FROM teams WHERE abbrev = :t"), {"t": home})
        ).first()
    return (float(row[0]), float(row[1])) if row else (None, None)


# ----------------------------------------------------------------------
# Magnitude calibration


async def calibrate_magnitude(
    seasons: tuple[int, ...], settings: Settings | None = None
) -> MagnitudeScale:
    """Fit M = a + b log10(1 + 10000 S) so the median regular-season goal is
    near 2.0 and each season's ten biggest goals average about 8.0, then
    rewrite every stored tremor's magnitude."""
    s = settings or get_settings()
    async with session_scope() as sess:
        rows = (
            await sess.execute(
                text(
                    "SELECT t.season, t.total_shift, t.night_date FROM tremors t "
                    "JOIN games g ON g.id = t.game_id WHERE g.game_type = 2 "
                    "AND NOT t.overturned AND NOT t.shootout AND t.season = ANY(:s)"
                ),
                {"s": list(seasons)},
            )
        ).all()
    L = {
        season: sorted(
            (math.log10(1 + 10000 * sh) for se, sh, _ in rows if se == season), reverse=True
        )
        for season in seasons
    }
    all_l = [x for v in L.values() for x in v]
    med = float(np.median(all_l))
    top = float(np.mean([np.mean(v[:10]) for v in L.values() if v]))
    b = (8.0 - 2.0) / (top - med)
    a = 2.0 - b * med
    scale = MagnitudeScale(a, b)
    path = s.ml_dir / "artifacts" / "magnitude-1.0.0.json"
    # Goals whose total shift is below this land on M0 after the clamp.
    floor_shift = (10 ** (-a / b) - 1) / 10000

    # How the size of goals changes over a season, for the methodology page.
    def mag(sh: float) -> float:
        return max(0.0, a + b * math.log10(1 + 10000 * sh))

    april = [mag(sh) for _, sh, d in rows if d.month == 4]
    late_top = []
    for season in seasons:
        ranked = sorted(((sh, d) for se, sh, d in rows if se == season), reverse=True)[:25]
        late_top.append(sum(1 for _, d in ranked if d.month in (3, 4)) / max(len(ranked), 1))
    meta = {
        "a": a,
        "b": b,
        "median_log_shift": med,
        "top10_log_shift": top,
        "seasons": list(seasons),
        "n_goals": len(all_l),
        "floor_shift": floor_shift,
        "zero_share": sum(1 for x in all_l if a + b * x <= 0) / len(all_l),
        "april_zero_share": sum(1 for m in april if m <= 0) / max(len(april), 1),
        "top25_march_april_share": float(np.mean(late_top)),
    }
    path.write_text(json.dumps(meta, indent=2) + "\n")
    (s.ml_dir / "reports" / "magnitude.json").write_text(json.dumps(meta, indent=2) + "\n")
    async with session_scope() as sess:
        await sess.execute(
            text(
                "UPDATE tremors SET magnitude = LEAST(10, GREATEST(0, :a + :b * "
                "log(1 + 10000 * total_shift)))"
            ),
            {"a": a, "b": b},
        )
    log.info("magnitude.calibrated", a=round(a, 3), b=round(b, 3), median=med, top=top)
    return scale


async def rewrite_bundles(season: int) -> int:
    """Refresh tremor magnitudes (and night energy) inside saved bundles."""
    async with session_scope() as sess:
        mags: dict[int, float] = dict(
            (
                await sess.execute(
                    text("SELECT id, magnitude FROM tremors WHERE season = :s"), {"s": season}
                )
            ).all()
        )
        bundles = list(
            (
                await sess.execute(select(ReplayBundle).where(ReplayBundle.season == season))
            ).scalars()
        )
        s = get_settings()
        for b in bundles:
            path = Path(b.path) if Path(b.path).is_absolute() else s.data_dir / b.path
            if not path.exists():
                continue
            with gzip.open(path, "rt", encoding="utf-8") as fh:
                data = json.load(fh)
            night_mags = []
            for f in data["frames"]:
                msg = f["message"]
                if msg["type"] == "tremor":
                    tid = msg["tremor"]["id"]
                    if tid in mags:
                        msg["tremor"]["magnitude"] = float(mags[tid])
                    night_mags.append(msg["tremor"]["magnitude"])
            with gzip.open(path, "wt", encoding="utf-8") as fh:
                json.dump(data, fh, separators=(",", ":"))
            b.total_energy = energy(night_mags)
    return len(bundles)
