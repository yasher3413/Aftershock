"""Build Monte Carlo inputs for a season from Postgres and the models.

Arrays are laid out for the Rust simulator (``aftershock_core``): one row per
regular-season game in chronological order, teams indexed in the league
config's order.
"""

from __future__ import annotations

import hashlib
import tomllib
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from typing import Any

import numpy as np
from numpy.typing import NDArray
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from aftershock.config import Settings, get_settings
from aftershock.db.models import Game, GamePregame, Play
from aftershock.ml.strength import OUTCOMES, RatingEngine, StrengthParams, six_way
from aftershock.nhl.parse import FINISHED_STATES

STATUS_FUTURE, STATUS_LIVE, STATUS_FINAL = 0, 1, 2
END_REG, END_OT, END_SO, END_OT_FORFEIT = 0, 1, 2, 3
END_CODES = {"REG": END_REG, "OT": END_OT, "SO": END_SO}
FOCUS_DAYS = 7


def config_name(season: int) -> str:
    y = season // 10000
    return f"nhl-{y}-{str(y + 1)[2:]}"


def league_config(season: int, settings: Settings | None = None) -> dict[str, Any]:
    s = settings or get_settings()
    path = s.config_dir / "leagues" / f"{config_name(season)}.toml"
    with path.open("rb") as fh:
        return tomllib.load(fh)


@dataclass
class SeasonSchedule:
    """Static part of the inputs: which games exist and who plays."""

    season: int
    config: str
    teams: list[str]
    game_ids: NDArray[np.int64]
    home: NDArray[np.uint16]
    away: NDArray[np.uint16]
    start_utc: list[datetime]
    index: dict[int, int] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.index = {int(g): i for i, g in enumerate(self.game_ids)}

    @property
    def n(self) -> int:
        return len(self.game_ids)


@dataclass
class SimInputs:
    schedule: SeasonSchedule
    status: NDArray[np.uint8]
    home_goals: NDArray[np.uint8]
    away_goals: NDArray[np.uint8]
    end: NDArray[np.uint8]
    live_home: NDArray[np.uint8]
    live_away: NDArray[np.uint8]
    probs: NDArray[np.float32]
    lam: NDArray[np.float32]
    playoff_p: NDArray[np.float32]
    tie_theta: float
    focus: NDArray[np.uint32]
    # Per-simulation team strength noise (log-odds scale), tuned by the backtest.
    team_sigma: float = 0.0

    def copy(self) -> SimInputs:
        return replace(
            self,
            status=self.status.copy(),
            home_goals=self.home_goals.copy(),
            away_goals=self.away_goals.copy(),
            end=self.end.copy(),
            live_home=self.live_home.copy(),
            live_away=self.live_away.copy(),
            probs=self.probs.copy(),
            lam=self.lam.copy(),
        )

    def set_live(
        self,
        game_id: int,
        probs: dict[str, float],
        home_score: int,
        away_score: int,
        lam_rem: tuple[float, float],
    ) -> None:
        i = self.schedule.index[game_id]
        self.status[i] = STATUS_LIVE
        self.probs[i] = [probs[k] for k in OUTCOMES]
        self.live_home[i] = home_score
        self.live_away[i] = away_score
        self.lam[i] = lam_rem

    def set_final(self, game_id: int, home_goals: int, away_goals: int, end: int) -> None:
        i = self.schedule.index[game_id]
        self.status[i] = STATUS_FINAL
        self.home_goals[i] = home_goals
        self.away_goals[i] = away_goals
        self.end[i] = end

    def state_hash(self) -> str:
        h = hashlib.sha256()
        for arr in (
            self.status,
            self.home_goals,
            self.away_goals,
            self.end,
            self.live_home,
            self.live_away,
            self.probs,
            self.lam,
        ):
            h.update(arr.tobytes())
        return h.hexdigest()[:32]


async def load_schedule(
    session: AsyncSession, season: int, settings: Settings | None = None
) -> SeasonSchedule:
    cfg = league_config(season, settings)
    teams: list[str] = list(cfg["teams"])
    idx = {t: i for i, t in enumerate(teams)}
    rows = (
        await session.execute(
            select(Game.id, Game.home, Game.away, Game.start_utc)
            .where(Game.season == season, Game.game_type == 2)
            .order_by(Game.start_utc, Game.id)
        )
    ).all()
    return SeasonSchedule(
        season=season,
        config=config_name(season),
        teams=teams,
        game_ids=np.array([r[0] for r in rows], dtype=np.int64),
        home=np.array([idx[r[1]] for r in rows], dtype=np.uint16),
        away=np.array([idx[r[2]] for r in rows], dtype=np.uint16),
        start_utc=[r[3] for r in rows],
    )


async def overtime_forfeits(session: AsyncSession, game_ids: list[int]) -> set[int]:
    """OT games decided by a goal into the loser's empty net.

    Under NHL rules a team that pulls its goalie in overtime and concedes
    forfeits the overtime-loss point, so the game counts as a regulation
    loss for the standings. The feed only reports "OT".
    """
    if not game_ids:
        return set()
    rows = await session.execute(
        select(Play.game_id).where(
            and_(
                Play.game_id.in_(game_ids),
                Play.type == "goal",
                Play.period_type == "OT",
                Play.goalie_id.is_(None),
                Play.deleted.is_(False),
            )
        )
    )
    return {int(r[0]) for r in rows.all()}


def playoff_matrix(engine: RatingEngine, teams: list[str]) -> NDArray[np.float32]:
    """P(team i beats team j in a playoff game hosted by i)."""
    n = len(teams)
    m = np.zeros((n, n), dtype=np.float32)
    for i, a in enumerate(teams):
        for j, b in enumerate(teams):
            if i != j:
                lam_h, lam_a = engine.expected_goals(a, b, None)
                m[i, j] = six_way(lam_h, lam_a, engine.params, playoff=True).p_home_win
    return m


async def build_inputs(
    session: AsyncSession,
    schedule: SeasonSchedule,
    engine: RatingEngine,
    params: StrengthParams,
    now: datetime,
    shrink: Callable[[float], float] | None = None,
) -> SimInputs:
    """Inputs from the database: finals as results, everything else as future.

    Future games use ratings shrunk toward the mean by ``shrink(fraction of
    the season played)`` (tuned by the season backtest), because a season
    simulation compounds any overconfidence in current ratings.
    """
    n = schedule.n
    status = np.zeros(n, dtype=np.uint8)
    hg = np.zeros(n, dtype=np.uint8)
    ag = np.zeros(n, dtype=np.uint8)
    end = np.zeros(n, dtype=np.uint8)
    probs = np.zeros((n, 6), dtype=np.float32)
    lam = np.zeros((n, 2), dtype=np.float32)
    rows = (
        await session.execute(
            select(Game, GamePregame)
            .outerjoin(GamePregame, GamePregame.game_id == Game.id)
            .where(Game.season == schedule.season, Game.game_type == 2)
        )
    ).all()
    n_final = sum(1 for g, _ in rows if g.state in FINISHED_STATES)
    factor = shrink(n_final / max(n, 1)) if shrink else 1.0
    sim_engine = engine
    if factor != 1.0:
        from aftershock.sim.backtest import shrunk

        sim_engine = shrunk(engine, factor)
    finals: list[Game] = []
    for g, pg in rows:
        i = schedule.index.get(g.id)
        if i is None:
            continue
        if g.state in FINISHED_STATES and g.home_score is not None and g.away_score is not None:
            finals.append(g)
            status[i] = STATUS_FINAL
            hg[i], ag[i] = g.home_score, g.away_score
            end[i] = END_CODES.get(g.last_period_type or "REG", END_REG)
        if pg is not None:
            probs[i] = [
                pg.p_home_reg,
                pg.p_home_ot,
                pg.p_home_so,
                pg.p_away_reg,
                pg.p_away_ot,
                pg.p_away_so,
            ]
            lam[i] = [pg.exp_home_goals, pg.exp_away_goals]
        else:
            home, away = schedule.teams[schedule.home[i]], schedule.teams[schedule.away[i]]
            pre = engine.predict(home, away, None)
            probs[i] = pre.p
            lam[i] = [pre.lam_home, pre.lam_away]
    for gid in await overtime_forfeits(
        session, [g.id for g in finals if g.last_period_type == "OT"]
    ):
        end[schedule.index[gid]] = END_OT_FORFEIT
    horizon = now + timedelta(days=FOCUS_DAYS)
    focus = [
        i for i, t in enumerate(schedule.start_utc) if status[i] != STATUS_FINAL and t <= horizon
    ]
    return SimInputs(
        schedule=schedule,
        status=status,
        home_goals=hg,
        away_goals=ag,
        end=end,
        live_home=np.zeros(n, dtype=np.uint8),
        live_away=np.zeros(n, dtype=np.uint8),
        probs=probs,
        lam=lam,
        playoff_p=playoff_matrix(sim_engine, schedule.teams),
        tie_theta=params.tie_theta,
        focus=np.array(focus, dtype=np.uint32),
        team_sigma=float(getattr(shrink, "sigma", 0.0)),
    )
