"""Database reads that build API responses."""

from __future__ import annotations

import base64
import json
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import Select, and_, desc, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from aftershock.api import schemas as S
from aftershock.db.models import (
    Game,
    GamePregame,
    Play,
    Player,
    Recap,
    ReplayBundle,
    RootingGuide,
    ShotXg,
    SimRun,
    Team,
    TeamOdds,
    Tremor,
    WpTimeline,
)

ODDS_METRICS = (
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
)


async def player_names(session: AsyncSession, ids: set[int]) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = await session.execute(select(Player.id, Player.name).where(Player.id.in_(ids)))
    return {int(i): str(n) for i, n in rows.all()}


def _ref(pid: int | None, names: dict[int, str]) -> S.PlayerRef | None:
    if not pid:
        return None
    return S.PlayerRef(id=pid, name=names.get(pid, f"Player {pid}"))


def tremor_out(t: Tremor, names: dict[int, str], home: str, away: str) -> S.Tremor:
    deltas = [
        S.TeamDelta(
            team=team,
            d_playoffs=float(d.get("d_playoffs", 0.0)),
            d_division=float(d.get("d_division", 0.0)),
            d_cup=float(d.get("d_cup", 0.0)),
            p_playoffs_after=float(d.get("p_playoffs_after", 0.0)),
        )
        for team, d in t.deltas.items()
    ]
    deltas.sort(key=lambda d: -abs(d.d_playoffs))
    return S.Tremor(
        id=t.id,
        season=t.season,
        game_id=t.game_id,
        event_id=t.event_id,
        night_date=t.night_date,
        team=t.team,
        opponent=t.opponent,
        home=home,
        away=away,
        scorer=_ref(t.scorer_id, names),
        assists=[r for r in (_ref(t.assist1_id, names), _ref(t.assist2_id, names)) if r],
        goalie=_ref(t.goalie_id, names),
        period=t.period,
        period_type=t.period_type,
        t_period_s=t.t_period_s,
        t_game_s=t.t_game_s,
        shootout=t.shootout,
        score_before=S.Score(**t.score_before),
        score_after=S.Score(**t.score_after),
        wp_before=S.SixWay(**t.wp_before),
        wp_after=S.SixWay(**t.wp_after),
        deltas=deltas,
        total_shift=t.total_shift,
        magnitude=t.magnitude,
        ppa=t.ppa,
        cpa=t.cpa,
        origin=S.Origin(
            venue=t.origin_venue,
            lat=t.origin_lat or 0.0,
            lon=t.origin_lon or 0.0,
            off_map=(t.origin_lon or 0.0) > -50 or (t.origin_lon or 0.0) < -170,
        ),
        overturned=t.overturned,
        created_at=t.created_at,
    )


async def tremors_out(session: AsyncSession, rows: list[Tremor]) -> list[S.Tremor]:
    if not rows:
        return []
    ids: set[int] = set()
    for t in rows:
        ids.update(x for x in (t.scorer_id, t.assist1_id, t.assist2_id, t.goalie_id) if x)
    names = await player_names(session, ids)
    game_rows = await session.execute(
        select(Game.id, Game.home, Game.away).where(Game.id.in_({t.game_id for t in rows}))
    )
    teams = {int(g): (h, a) for g, h, a in game_rows.all()}
    return [tremor_out(t, names, *teams.get(t.game_id, (t.team, t.opponent))) for t in rows]


def encode_cursor(values: tuple[Any, ...]) -> str:
    return base64.urlsafe_b64encode(json.dumps(values).encode()).decode()


def decode_cursor(cursor: str) -> list[Any]:
    return list(json.loads(base64.urlsafe_b64decode(cursor.encode())))


async def tremor_page(
    session: AsyncSession,
    *,
    season: int,
    sort: str,
    team: str | None,
    limit: int,
    cursor: str | None,
) -> S.TremorPage:
    q: Select[Tremor] = select(Tremor).where(Tremor.season == season, Tremor.overturned.is_(False))
    if team:
        q = q.where(or_(Tremor.team == team, Tremor.opponent == team))
    if sort == "magnitude":
        q = q.order_by(desc(Tremor.magnitude), desc(Tremor.id))
        if cursor:
            mag, tid = decode_cursor(cursor)
            q = q.where(or_(Tremor.magnitude < mag, and_(Tremor.magnitude == mag, Tremor.id < tid)))
    else:
        q = q.order_by(desc(Tremor.night_date), desc(Tremor.t_game_s), desc(Tremor.id))
        if cursor:
            (tid,) = decode_cursor(cursor)
            q = q.where(Tremor.id < tid)
    rows = list((await session.execute(q.limit(limit + 1))).scalars())
    nxt = None
    if len(rows) > limit:
        rows = rows[:limit]
        last = rows[-1]
        nxt = encode_cursor((last.magnitude, last.id) if sort == "magnitude" else (last.id,))
    return S.TremorPage(items=await tremors_out(session, rows), next_cursor=nxt)


async def latest_run(session: AsyncSession, season: int) -> SimRun | None:
    q = select(SimRun).where(SimRun.season == season).order_by(desc(SimRun.id)).limit(1)
    return (await session.execute(q)).scalar_one_or_none()


def odds_out(o: TeamOdds) -> S.TeamOdds:
    return S.TeamOdds(
        team=o.team, exp_points=o.exp_points, **{m: getattr(o, m) for m in ODDS_METRICS}
    )


async def team_page(session: AsyncSession, abbrev: str, season: int) -> S.TeamResponse | None:
    team = await session.get(Team, abbrev)
    if team is None:
        return None
    run = await latest_run(session, season)
    odds_row = None
    if run is not None:
        odds_row = await session.get(TeamOdds, (run.id, abbrev))

    hist_q = (
        select(SimRun.id, SimRun.as_of, SimRun.created_at, SimRun.trigger, TeamOdds)
        .join(TeamOdds, TeamOdds.sim_run_id == SimRun.id)
        .where(
            SimRun.season == season,
            TeamOdds.team == abbrev,
            SimRun.trigger.in_(("final", "nightly", "backfill", "goal", "period_end")),
        )
        .order_by(SimRun.as_of, SimRun.id)
    )
    history: dict[str, list[S.OddsPoint]] = {m: [] for m in ("p_playoffs", "p_division", "p_cup")}
    for rid, as_of, created, trig, o in (await session.execute(hist_q)).all():
        for m in history:
            history[m].append(
                S.OddsPoint(t=as_of or created, sim_run_id=rid, trigger=trig, value=getattr(o, m))
            )
    for m in history:
        history[m] = _thin(history[m], 600)

    points_hist: list[S.HistBin] = []
    seed_dist: dict[str, float] = {}
    if odds_row is not None:
        total = sum(odds_row.points_hist.values()) or 1
        points_hist = [
            S.HistBin(x=int(k), p=v / total)
            for k, v in sorted(odds_row.points_hist.items(), key=lambda kv: int(kv[0]))
            if v
        ]
        seed_dist = {k: float(v) for k, v in odds_row.seed_dist.items()}

    rooting: list[S.RootingLine] = []
    if run is not None:
        rg = await session.get(RootingGuide, (run.id, abbrev))
        if rg is not None:
            rooting = [S.RootingLine(**r) for r in rg.data.get("lines", [])]

    now = datetime.now(UTC)
    rem_q = (
        select(Game, GamePregame)
        .outerjoin(GamePregame, GamePregame.game_id == Game.id)
        .where(
            Game.season == season,
            Game.game_type == 2,
            Game.start_utc > now,
            or_(Game.home == abbrev, Game.away == abbrev),
        )
        .order_by(Game.start_utc)
        .limit(30)
    )
    remaining = []
    for g, pg in (await session.execute(rem_q)).all():
        home = g.home == abbrev
        if pg is None:
            continue
        p_win = (
            (pg.p_home_reg + pg.p_home_ot + pg.p_home_so)
            if home
            else (pg.p_away_reg + pg.p_away_ot + pg.p_away_so)
        )
        p_points = 1.0 - (pg.p_away_reg if home else pg.p_home_reg)
        remaining.append(
            S.ScheduleGame(
                game_id=g.id,
                start_utc=g.start_utc,
                opponent=g.away if home else g.home,
                home=home,
                p_win=p_win,
                p_points=p_points,
            )
        )

    base = select(Tremor).where(Tremor.season == season, Tremor.overturned.is_(False))
    delta_expr = Tremor.deltas[abbrev]["d_playoffs"].as_float()
    tremors_for = list(
        (
            await session.execute(base.where(delta_expr > 0).order_by(desc(delta_expr)).limit(8))
        ).scalars()
    )
    tremors_against = list(
        (await session.execute(base.where(delta_expr < 0).order_by(delta_expr).limit(8))).scalars()
    )

    players_q = text(
        """
        SELECT p.player_id, pl.name, p.goals, p.ppa, p.assists, p.assist_ppa
        FROM player_ppa_season p JOIN players pl ON pl.id = p.player_id
        WHERE p.season = :season AND p.player_id IN (
            SELECT DISTINCT scorer_id FROM tremors WHERE season = :season AND team = :team
            UNION SELECT DISTINCT assist1_id FROM tremors WHERE season = :season AND team = :team
            UNION SELECT DISTINCT assist2_id FROM tremors WHERE season = :season AND team = :team
        )
        ORDER BY p.ppa DESC LIMIT 25
        """
    )
    players = [
        S.TeamPlayerPpa(
            player=S.PlayerRef(id=r[0], name=r[1]),
            goals=r[2],
            ppa=r[3],
            assists=r[4],
            assist_ppa=r[5],
        )
        for r in (await session.execute(players_q, {"season": season, "team": abbrev})).all()
    ]
    return S.TeamResponse(
        team=S.TeamInfo.model_validate(team),
        odds=odds_out(odds_row) if odds_row else None,
        history=history,
        points_hist=points_hist,
        seed_dist=seed_dist,
        rooting=rooting,
        remaining=remaining,
        tremors_for=await tremors_out(session, tremors_for),
        tremors_against=await tremors_out(session, tremors_against),
        players=players,
    )


def _thin(points: list[S.OddsPoint], n: int) -> list[S.OddsPoint]:
    if len(points) <= n:
        return points
    step = len(points) / n
    return [points[int(i * step)] for i in range(n - 1)] + [points[-1]]


def game_summary(g: Game, pg: GamePregame | None = None) -> S.GameSummary:
    pre = None
    if pg is not None:
        pre = S.SixWay(
            home_reg=pg.p_home_reg,
            home_ot=pg.p_home_ot,
            home_so=pg.p_home_so,
            away_reg=pg.p_away_reg,
            away_ot=pg.p_away_ot,
            away_so=pg.p_away_so,
        )
    return S.GameSummary(
        id=g.id,
        season=g.season,
        game_type=g.game_type,
        night_date=g.night_date,
        start_utc=g.start_utc,
        home=g.home,
        away=g.away,
        venue=g.venue,
        state=g.state,
        period=g.period,
        period_type=g.period_type,
        clock_seconds=g.clock_seconds,
        in_intermission=g.in_intermission,
        home_score=g.home_score,
        away_score=g.away_score,
        home_sog=g.home_sog,
        away_sog=g.away_sog,
        last_period_type=g.last_period_type,
        pregame=pre,
    )


async def games_on(session: AsyncSession, day: date) -> list[S.GameSummary]:
    q = (
        select(Game, GamePregame)
        .outerjoin(GamePregame, GamePregame.game_id == Game.id)
        .where(Game.night_date == day)
        .order_by(Game.start_utc, Game.id)
    )
    return [game_summary(g, pg) for g, pg in (await session.execute(q)).all()]


async def game_page(session: AsyncSession, game_id: int) -> S.GameResponse | None:
    row = (
        await session.execute(
            select(Game, GamePregame)
            .outerjoin(GamePregame, GamePregame.game_id == Game.id)
            .where(Game.id == game_id)
        )
    ).first()
    if row is None:
        return None
    g, pg = row
    wp_rows = (
        await session.execute(
            select(WpTimeline)
            .where(WpTimeline.game_id == game_id)
            .order_by(WpTimeline.t_game_s, WpTimeline.id)
        )
    ).scalars()
    wp = [
        S.WpPoint(
            t_game_s=w.t_game_s,
            event_id=w.event_id,
            p_home=w.p_home_reg + w.p_home_ot + w.p_home_so,
            p_away=w.p_away_reg + w.p_away_ot + w.p_away_so,
            p_tie=0.0,
        )
        for w in wp_rows
    ]
    shot_q = (
        select(Play, ShotXg.xg)
        .join(ShotXg, and_(ShotXg.game_id == Play.game_id, ShotXg.event_id == Play.event_id))
        .where(Play.game_id == game_id, Play.deleted.is_(False))
        .order_by(Play.sort_order)
    )
    shots_raw = (await session.execute(shot_q)).all()
    names = await player_names(session, {p.shooter_id for p, _ in shots_raw if p.shooter_id})
    shots = []
    xg = {g.home: 0.0, g.away: 0.0}
    for p, v in shots_raw:
        if p.x_norm is None or p.y_norm is None or p.owner_team is None:
            continue
        xg[p.owner_team] = xg.get(p.owner_team, 0.0) + v
        shots.append(
            S.ShotOut(
                event_id=p.event_id,
                team=p.owner_team,
                period=p.period,
                t_period_s=p.t_period_s,
                x=p.x_norm,
                y=p.y_norm,
                xg=v,
                goal=p.type == "goal",
                shooter=_ref(p.shooter_id, names),
                shot_type=p.shot_type,
            )
        )
    trem = list(
        (
            await session.execute(
                select(Tremor).where(Tremor.game_id == game_id).order_by(Tremor.t_game_s)
            )
        ).scalars()
    )
    return S.GameResponse(
        game=game_summary(g, pg),
        wp=wp,
        shots=shots,
        xg_home=xg.get(g.home, 0.0),
        xg_away=xg.get(g.away, 0.0),
        tremors=await tremors_out(session, trem),
    )


async def leaders(
    session: AsyncSession, season: int, kind: str, limit: int = 100
) -> S.LeadersResponse:
    if kind == "team_chaos":
        q = text(
            """
            SELECT t.team, sum(abs((d.value ->> 'd_playoffs')::float)) AS chaos,
                   count(DISTINCT t.id)
            FROM tremors t, jsonb_each(t.deltas) d
            WHERE t.season = :season AND NOT t.overturned AND d.key <> t.team
            GROUP BY t.team ORDER BY chaos DESC
            """
        )
        rows = (await session.execute(q, {"season": season})).all()
        out = [
            S.LeaderRow(rank=i + 1, team=r[0], value=float(r[1]), count=int(r[2]))
            for i, r in enumerate(rows)
        ]
        return S.LeadersResponse(season=season, kind="team_chaos", rows=out)
    if kind == "on_ice":
        q = text(
            """
            SELECT o.player_id, pl.name, o.team, o.on_ice_ppa, o.goals_for
            FROM player_onice_ppa o JOIN players pl ON pl.id = o.player_id
            WHERE o.season = :season ORDER BY o.on_ice_ppa DESC LIMIT :limit
            """
        )
        rows = (await session.execute(q, {"season": season, "limit": limit})).all()
        return S.LeadersResponse(
            season=season,
            kind="on_ice",
            rows=[
                S.LeaderRow(
                    rank=i + 1,
                    player=S.PlayerRef(id=r[0], name=r[1]),
                    team=r[2],
                    value=float(r[3]),
                    count=int(r[4]),
                )
                for i, r in enumerate(rows)
            ],
        )
    column, count, order, team_sql = {
        "skater": (
            "ppa",
            "goals",
            "DESC",
            "SELECT t.team FROM tremors t WHERE t.season = p.season AND t.scorer_id = p.player_id",
        ),
        "assist": (
            "assist_ppa",
            "assists",
            "DESC",
            "SELECT t.team FROM tremors t WHERE t.season = p.season "
            "AND p.player_id IN (t.assist1_id, t.assist2_id)",
        ),
        "goalie": (
            "goalie_ppa_allowed",
            "goals_allowed",
            "ASC",
            "SELECT t.opponent FROM tremors t WHERE t.season = p.season "
            "AND t.goalie_id = p.player_id",
        ),
    }[kind]
    # The team the player played for that season (most common in his tremors).
    q = text(
        f"""
        SELECT p.player_id, pl.name,
               coalesce(({team_sql} GROUP BY 1 ORDER BY count(*) DESC LIMIT 1), ''),
               p.{column}, p.{count}
        FROM player_ppa_season p JOIN players pl ON pl.id = p.player_id
        WHERE p.season = :season AND p.{count} > 0
        ORDER BY p.{column} {order} LIMIT :limit
        """
    )
    rows = (await session.execute(q, {"season": season, "limit": limit})).all()
    out = [
        S.LeaderRow(
            rank=i + 1,
            player=S.PlayerRef(id=r[0], name=r[1]),
            team=r[2],
            value=float(r[3]),
            count=int(r[4]),
        )
        for i, r in enumerate(rows)
    ]
    return S.LeadersResponse(season=season, kind=kind, rows=out)


async def odds_history(
    session: AsyncSession, team: str, metric: str, season: int
) -> list[S.OddsPoint]:
    if metric not in ODDS_METRICS:
        raise ValueError(metric)
    q = (
        select(
            SimRun.id, SimRun.as_of, SimRun.created_at, SimRun.trigger, getattr(TeamOdds, metric)
        )
        .join(TeamOdds, TeamOdds.sim_run_id == SimRun.id)
        .where(SimRun.season == season, TeamOdds.team == team)
        .order_by(SimRun.as_of, SimRun.id)
    )
    return [
        S.OddsPoint(t=a or c, sim_run_id=i, trigger=tr, value=v)
        for i, a, c, tr, v in (await session.execute(q)).all()
    ]


async def nights(session: AsyncSession, season: int) -> list[S.NightInfo]:
    q = select(ReplayBundle).where(ReplayBundle.season == season).order_by(ReplayBundle.night_date)
    return [
        S.NightInfo(
            night_date=b.night_date,
            season=b.season,
            total_energy=b.total_energy,
            n_games=b.n_games,
            n_tremors=b.n_tremors,
        )
        for b in (await session.execute(q)).scalars()
    ]


async def recap(session: AsyncSession, day: date) -> S.RecapResponse | None:
    r = await session.get(Recap, day)
    if r is None:
        return None
    return S.RecapResponse(
        night_date=r.night_date,
        headline=r.headline,
        body=r.body,
        key_numbers=list(r.data.get("key_numbers", [])),
        model=r.model,
        validated=r.validated,
    )


async def count_rows(session: AsyncSession, model: Any) -> int:
    return int(await session.scalar(select(func.count()).select_from(model)) or 0)


def headshot_url(season: int, team: str | None, player_id: int) -> str | None:
    """The NHL's public headshot for a player on a team in a season. Loaded
    from the NHL's servers, never copied; the page falls back to initials."""
    if not team:
        return None
    return f"https://assets.nhle.com/mugs/nhl/{season}/{team}/{player_id}.png"


async def player_card(
    session: AsyncSession, player_id: int, season: int | None, *, fallback_season: int
) -> S.PlayerResponse | None:
    """A player's card for ``season``, or for their latest season with goals
    when none is given."""
    p = (
        await session.execute(
            text(
                "SELECT id, name, position, shoots_catches, sweater, current_team "
                "FROM players WHERE id = :p"
            ),
            {"p": player_id},
        )
    ).first()
    if p is None:
        return None
    rows = (
        await session.execute(
            text(
                """
                SELECT s.season, s.goals, s.ppa, s.cpa, s.assists, s.assist_ppa,
                       s.goals_allowed, s.goalie_ppa_allowed,
                       o.on_ice_ppa, o.goals_for, o.goals_against, o.team,
                       (SELECT t.team FROM tremors t
                        WHERE t.season = s.season AND NOT t.overturned
                          AND :p IN (t.scorer_id, t.assist1_id, t.assist2_id)
                        GROUP BY t.team ORDER BY count(*) DESC LIMIT 1) AS team_for,
                       (SELECT t.opponent FROM tremors t
                        WHERE t.season = s.season AND NOT t.overturned AND t.goalie_id = :p
                        GROUP BY t.opponent ORDER BY count(*) DESC LIMIT 1) AS team_in_net
                FROM player_ppa_season s
                LEFT JOIN player_onice_ppa o ON o.season = s.season AND o.player_id = s.player_id
                WHERE s.player_id = :p
                ORDER BY s.season DESC
                """
            ),
            {"p": player_id},
        )
    ).all()
    seasons = [
        S.PlayerSeason(
            season=r[0],
            team=r[12] or r[13] or r[11],
            goals=int(r[1] or 0),
            ppa=float(r[2] or 0),
            cpa=float(r[3] or 0),
            assists=int(r[4] or 0),
            assist_ppa=float(r[5] or 0),
            goals_allowed=int(r[6] or 0),
            goalie_ppa_allowed=float(r[7] or 0),
            on_ice_ppa=None if r[8] is None else float(r[8]),
            on_ice_goals_for=None if r[9] is None else int(r[9]),
            on_ice_goals_against=None if r[10] is None else int(r[10]),
        )
        for r in rows
    ]
    if season is None:
        season = seasons[0].season if seasons else fallback_season
    this = next((x for x in seasons if x.season == season), None)
    team = (this.team if this else None) or p[5]
    goals = (
        await session.execute(
            select(Tremor)
            .where(
                Tremor.season == season,
                Tremor.scorer_id == player_id,
                Tremor.overturned.is_(False),
            )
            .order_by(Tremor.night_date, Tremor.period, Tremor.t_period_s)
        )
    ).scalars()
    assists = (
        await session.execute(
            select(Tremor)
            .where(
                Tremor.season == season,
                or_(Tremor.assist1_id == player_id, Tremor.assist2_id == player_id),
                Tremor.overturned.is_(False),
            )
            .order_by(desc(Tremor.magnitude))
            .limit(10)
        )
    ).scalars()
    return S.PlayerResponse(
        id=p[0],
        name=p[1],
        position=p[2],
        shoots_catches=p[3],
        sweater=p[4],
        current_team=p[5],
        season=season,
        team=team,
        headshot=headshot_url(season, team, player_id),
        seasons=seasons,
        goals=await tremors_out(session, list(goals)),
        assists=await tremors_out(session, list(assists)),
    )
