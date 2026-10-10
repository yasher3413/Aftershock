"""Build the bootstrap payload (``StateResponse``) the worker publishes to Redis."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from aftershock.api import queries as Q
from aftershock.api import schemas as S
from aftershock.db.models import Game, ReplayBundle, Team, Tremor, Venue
from aftershock.nhl.parse import LIVE_STATES, parse_standings
from aftershock.sim.backend import SimOutput

EASTERN = ZoneInfo("America/New_York")
DEMO_WINDOW_DAYS = 21


def hockey_night(now: datetime) -> date:
    """The schedule date of 'tonight' in Eastern time (games after midnight count)."""
    local = now.astimezone(EASTERN)
    return (local - timedelta(hours=6)).date()


def odds_list(out: SimOutput | None) -> list[S.TeamOdds]:
    if out is None:
        return []
    return [
        S.TeamOdds(
            team=t,
            **{
                k: float(out.metrics[k][i])
                for k in (
                    "p_playoffs",
                    "p_division",
                    "p_top3_div",
                    "p_wildcard",
                    "p_presidents",
                    "p_conf_first",
                    "p_round2",
                    "p_conf_final",
                    "p_final",
                    "p_cup",
                    "p_last",
                    "p_bottom3",
                    "exp_points",
                )
            },
        )
        for i, t in enumerate(out.teams)
    ]


def standings_rows(raw: dict[str, Any]) -> list[S.StandingsRow]:
    rows = []
    for r in parse_standings(raw):
        rows.append(
            S.StandingsRow(
                team=r.team,
                conference=r.conference,
                division=r.division,
                gp=r.gp,
                w=r.w,
                l=r.l,
                otl=r.otl,
                points=r.points,
                points_pct=r.points / (2 * r.gp) if r.gp else 0.0,
                rw=r.rw,
                row=r.row,
                gf=r.gf,
                ga=r.ga,
                division_rank=r.division_seq,
                conference_rank=r.conference_seq,
                league_rank=r.league_seq,
                wildcard_rank=r.wildcard_seq or None,
            )
        )
    return rows


async def demo_night(session: AsyncSession, season: int) -> ReplayBundle | None:
    """The most energetic night in the final three weeks of the regular season."""
    last = await session.scalar(
        select(Game.night_date)
        .where(Game.season == season, Game.game_type == 2)
        .order_by(desc(Game.night_date))
        .limit(1)
    )
    if last is None:
        return None
    q = (
        select(ReplayBundle)
        .where(
            ReplayBundle.season == season,
            ReplayBundle.night_date > last - timedelta(days=DEMO_WINDOW_DAYS),
            ReplayBundle.night_date <= last,
        )
        .order_by(desc(ReplayBundle.total_energy))
        .limit(1)
    )
    return (await session.execute(q)).scalar_one_or_none()


RECENT_NIGHT_DAYS = 3


async def recent_night(session: AsyncSession, night: date) -> ReplayBundle | None:
    """During the season, the latest night with a replay up to ``night``
    (within a few days). ``night`` itself counts once its games are over and
    its replay is written: after the last game and before the 6 a.m.
    rollover, the night that just ended is the one to replay."""
    return (
        await session.execute(
            select(ReplayBundle)
            .where(
                ReplayBundle.night_date <= night,
                ReplayBundle.night_date >= night - timedelta(days=RECENT_NIGHT_DAYS),
                ReplayBundle.n_tremors > 0,
            )
            .order_by(desc(ReplayBundle.night_date))
            .limit(1)
        )
    ).scalar_one_or_none()


async def next_live_start(session: AsyncSession, now: datetime) -> datetime | None:
    """The next puck drop: the earliest game that has not started. A game
    still in pregame after its listed time (a late start) counts as next."""
    return await session.scalar(
        select(Game.start_utc)
        .where(
            Game.state.in_(("FUT", "PRE")),
            Game.start_utc > now - timedelta(hours=6),
            Game.game_type.in_((2, 3)),
        )
        .order_by(Game.start_utc)
        .limit(1)
    )


def night_on_air(states: list[str]) -> bool:
    """Whether the home page shows tonight rather than a replay: while a game
    is live, and between games once the night has started, so a gap before
    the late game does not flip back to an old night."""
    live = any(s in LIVE_STATES for s in states)
    started = any(s in LIVE_STATES or s in ("FINAL", "OFF") for s in states)
    pending = any(s in ("FUT", "PRE") for s in states)
    return live or (started and pending)


async def build_state(
    session: AsyncSession,
    *,
    season: int,
    now: datetime,
    state_version: int,
    sim_run_id: int | None,
    current: SimOutput | None,
    day_start: SimOutput | None,
    standings: list[S.StandingsRow],
    games: dict[int, S.GameSummary],
    stakes: dict[int, float],
    demo_mode: str,
) -> S.StateResponse:
    teams = [
        S.TeamInfo.model_validate(t)
        for t in (await session.execute(select(Team).order_by(Team.abbrev))).scalars()
    ]
    venues = [
        S.VenueInfo.model_validate(v)
        for v in (await session.execute(select(Venue).order_by(Venue.name))).scalars()
    ]
    night = hockey_night(now)
    tonight = await Q.games_on(session, night)
    for i, g in enumerate(tonight):
        live = games.get(g.id)
        if live is not None:
            tonight[i] = live
        tonight[i].stakes = stakes.get(g.id)
    live_games = [g for g in tonight if g.state in LIVE_STATES]
    got = max(
        (g for g in tonight if g.stakes is not None and g.state not in ("FINAL", "OFF")),
        key=lambda g: g.stakes or 0.0,
        default=None,
    )
    rows = (
        await session.execute(
            select(Tremor)
            .where(Tremor.season == season, Tremor.overturned.is_(False))
            .order_by(desc(Tremor.id))
            .limit(50)
        )
    ).scalars()
    tremors = await Q.tremors_out(session, list(rows))

    mode: Literal["live", "demo"] = "live"
    replay = None
    if demo_mode == "on" or (demo_mode == "auto" and not night_on_air([g.state for g in tonight])):
        bundle = await recent_night(session, night) or await demo_night(session, season - 10001)
        if bundle is not None:
            mode = "demo"
            replay = S.ReplayInfo(
                night_date=bundle.night_date,
                season=bundle.season,
                speed=20,
                next_live_utc=await next_live_start(session, now),
            )
    scenarios: list[str] = []
    if standings:
        from aftershock.sim.inputs import league_config
        from aftershock.tremors.clinch import tonight_scenarios

        per_team = int(league_config(season)["games_per_team"])
        upcoming = [(g.away, g.home) for g in tonight if g.state in ("FUT", "PRE")]
        scenarios = tonight_scenarios(standings, per_team, upcoming)
    return S.StateResponse(
        mode=mode,
        clinch_scenarios=scenarios,
        replay=replay,
        server_time=now,
        state_version=state_version,
        season=season,
        sim_run_id=sim_run_id,
        teams=teams,
        venues=venues,
        standings=standings,
        odds=odds_list(current),
        odds_day_start=odds_list(day_start),
        live_games=live_games,
        tonight=tonight,
        game_of_the_night=got.id if got else None,
        tremors=tremors,
    )


def utcnow() -> datetime:
    return datetime.now(UTC)
