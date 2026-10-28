"""Player values and lineups for the Roster Lab.

Reads every regular-season game since 2024-25 (play-by-play, shift charts,
and the xG model), fits the player value model, and stores each player's
worth and each team's current roster with who is dressing lately. Runs in
the worker's nightly step, outside game hours, and from the CLI.
"""

from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any

import numpy as np
import structlog
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from aftershock.config import Settings, get_settings
from aftershock.db.models import Game, PlayerValueRow, RosterSpot
from aftershock.db.session import session_scope
from aftershock.ml.player_value import (
    MODEL_VERSION,
    PlayerValue,
    choose_alpha,
    finishing,
    fit_rapm,
    goalie_gsax,
)
from aftershock.ml.stints import SHIFT, Shot, Stint, build_stints, toi
from aftershock.ml.strength import RatingEngine, StrengthParams
from aftershock.ml.xg import XgModel, default_model
from aftershock.nhl.client import NhlClient
from aftershock.nhl.parse import FINISHED_STATES, mmss_to_seconds, parse_play_by_play
from aftershock.sim.inputs import league_config
from aftershock.sim.roster import Injury, Spot, Trade, team_deltas, team_goals

log = structlog.get_logger(__name__)

FIRST_SEASON = 20242025  # shift charts are cached from here on
RECENT_GAMES = 40  # ice time per game is averaged over a player's last 40 games
LINEUP_GAMES = 3  # dressing lately: played on or after the team's 3rd-last game
GOALIE_GAMES = 10  # backups sit for stretches, so goalies count over the last 10


def roster_seasons(current: int) -> list[int]:
    """The current season id and the two before it."""
    y = current // 10000
    return [(y - k) * 10000 + (y - k + 1) for k in (2, 1, 0)]


def group(position: str) -> str:
    return position if position in ("D", "G") else "F"


def lineup(
    team_games: list[int],
    last_game: dict[int, int],
    roster: set[int],
    recent: int = LINEUP_GAMES,
) -> set[int]:
    """Roster players dressing lately. ``team_games`` are the team's games in
    order and ``last_game`` each player's latest game for any team, on the
    same ordering, so a player traded in the last few days counts."""
    if not team_games:
        return set(roster)
    since = team_games[-min(recent, len(team_games))]
    return {p for p in roster if last_game.get(p, -1) >= since}


def free_agents(values: dict[int, PlayerValue], rostered: set[int]) -> set[int]:
    return set(values) - rostered


@dataclass
class GameData:
    order: int  # chronological position among all games read
    game_id: int
    home: str
    away: str
    stints: list[Stint]
    seconds: dict[int, tuple[str, int, int, int]]  # player: (team, ev, pp, total)
    shots: list[tuple[int, float, bool]]  # shooter, xg, goal
    against: list[tuple[int, float, bool]]  # goalie, xg, goal
    positions: dict[int, str]
    names: dict[int, str]


def read_game(
    order: int, pbp: dict[str, Any], shifts: list[dict[str, Any]], model: XgModel
) -> GameData:
    game = parse_play_by_play(pbp)
    home, away = game.meta.home, game.meta.away
    abbrev = {home.id: home.abbrev, away.id: away.abbrev}
    positions = {pid: group(str(r.get("positionCode"))) for pid, r in game.roster.items()}
    names = {
        pid: f"{r['firstName']['default']} {r['lastName']['default']}"
        for pid, r in game.roster.items()
    }
    goalies = {p for p, g in positions.items() if g == "G"}
    xg = model.game_xg(game)
    shots: list[Shot] = []
    by_shooter: list[tuple[int, float, bool]] = []
    against: list[tuple[int, float, bool]] = []
    for p in game.plays:
        if p.event_id not in xg or p.owner_team_id is None:
            continue
        goal = p.type == "goal"
        team = abbrev.get(p.owner_team_id, "")
        shots.append(Shot(p.event_id, p.period, p.t_period_s, team, goal))
        shooter = p.scorer_id if goal else p.shooter_id
        if shooter is not None:
            by_shooter.append((shooter, xg[p.event_id], goal))
        if p.goalie_id is not None:
            against.append((p.goalie_id, xg[p.event_id], goal))
    seconds = {pid: (t.team, t.ev_s, t.pp_s, t.total_s) for pid, t in toi(shifts, goalies).items()}
    for s in shifts:
        pid = int(s.get("playerId", 0))
        if s.get("typeCode") == SHIFT and pid in goalies:
            dur = mmss_to_seconds(s.get("endTime")) - mmss_to_seconds(s.get("startTime"))
            team, ev, pp, tot = seconds.get(pid, (str(s["teamAbbrev"]), 0, 0, 0))
            seconds[pid] = (team, ev, pp, tot + max(dur, 0))
    return GameData(
        order=order,
        game_id=game.meta.id,
        home=home.abbrev,
        away=away.abbrev,
        stints=build_stints(game.meta.id, shifts, shots, xg, home.abbrev, goalies),
        seconds=seconds,
        shots=by_shooter,
        against=against,
        positions=positions,
        names=names,
    )


@dataclass
class Season:
    games: list[GameData] = field(default_factory=list)

    def values(self, alpha: float) -> dict[int, PlayerValue]:
        rapm = fit_rapm([s for g in self.games for s in g.stints], alpha)
        fin = finishing([s for g in self.games for s in g.shots])
        gsax = goalie_gsax([s for g in self.games for s in g.against])
        apps: dict[int, list[tuple[str, int, int, int]]] = defaultdict(list)
        shot_count: dict[int, int] = defaultdict(int)
        positions: dict[int, str] = {}
        names: dict[int, str] = {}
        for g in self.games:  # in order
            for pid, rec in g.seconds.items():
                apps[pid].append(rec)
            for pid, _, _ in g.shots:
                shot_count[pid] += 1
            positions.update(g.positions)
            names.update(g.names)
        out: dict[int, PlayerValue] = {}
        for pid, recs in apps.items():
            recent = recs[-RECENT_GAMES:]
            total_s = sum(r[3] for r in recs)
            off, dfn = rapm.get(pid, (0.0, 0.0))
            out[pid] = PlayerValue(
                player_id=pid,
                position=positions.get(pid, "F"),
                off60=off,
                def60=dfn,
                finish_per_shot=fin.get(pid, 0.0),
                shots_per60=shot_count[pid] * 3600 / total_s if total_s else 0.0,
                gsax_per_shot=gsax.get(pid, 0.0),
                ev_toi_pg=sum(r[1] for r in recent) / len(recent) / 60,
                pp_toi_pg=sum(r[2] for r in recent) / len(recent) / 60,
                games=len(recs),
                name=names.get(pid, str(pid)),
                last_team=recs[-1][0],
            )
        return out

    def last_game(self) -> dict[int, int]:
        out: dict[int, int] = {}
        for g in self.games:
            for pid in g.seconds:
                out[pid] = g.order
        return out

    def team_games(self, team: str, season: int) -> list[GameData]:
        return [
            g
            for g in self.games
            if team in (g.home, g.away) and g.game_id // 1_000_000 == season // 10000
        ]


def spots(
    team: str,
    roster: list[dict[str, Any]],
    season: Season,
    current: int,
    values: dict[int, PlayerValue],
    last: dict[int, int],
    now: datetime,
) -> list[dict[str, Any]]:
    games = season.team_games(team, current)
    ids = {int(r["id"]) for r in roster}
    order = [g.order for g in games]
    goalies = {int(r["id"]) for r in roster if group(str(r.get("positionCode"))) == "G"}
    playing = lineup(order, last, ids - goalies) | lineup(order, last, goalies, GOALIE_GAMES)
    recent = games[-GOALIE_GAMES:]
    goalie_s: dict[int, int] = defaultdict(int)
    for g in recent:
        for pid, (t, _, _, tot) in g.seconds.items():
            if t == team and g.positions.get(pid) == "G":
                goalie_s[pid] += tot
    total_g = sum(goalie_s.values()) or 1
    rows = []
    for r in roster:
        pid = int(r["id"])
        v = values.get(pid)
        rows.append(
            {
                "team": team,
                "player_id": pid,
                "name": f"{r['firstName']['default']} {r['lastName']['default']}",
                "position": group(str(r.get("positionCode"))),
                "in_lineup": pid in playing,
                "ev_toi_pg": v.ev_toi_pg if v else 0.0,
                "pp_toi_pg": v.pp_toi_pg if v else 0.0,
                "toi_share": goalie_s.get(pid, 0) / total_g,
                "computed_at": now,
            }
        )
    return rows


def _alpha_path(settings: Settings) -> Any:
    return settings.ml_dir / "artifacts" / f"{MODEL_VERSION}.json"


def value_from_row(r: PlayerValueRow) -> PlayerValue:
    return PlayerValue(
        player_id=r.player_id,
        position=r.position,
        off60=r.off60,
        def60=r.def60,
        finish_per_shot=r.finish_per_shot,
        shots_per60=r.shots_per60,
        gsax_per_shot=r.gsax_per_shot,
        ev_toi_pg=r.ev_toi_pg,
        pp_toi_pg=r.pp_toi_pg,
        games=r.games,
        name=r.name,
        last_team=r.last_team,
    )


async def load_roster_state() -> tuple[dict[str, list[Spot]], dict[int, PlayerValue]]:
    """Every team's roster spots and every player's value, as stored."""
    async with session_scope() as s:
        values = {
            r.player_id: value_from_row(r)
            for r in (await s.execute(select(PlayerValueRow))).scalars()
        }
        rosters: dict[str, list[Spot]] = defaultdict(list)
        for r in (await s.execute(select(RosterSpot).order_by(RosterSpot.team))).scalars():
            rosters[r.team].append(
                Spot(
                    r.player_id,
                    r.team,
                    r.position,
                    r.in_lineup,
                    r.ev_toi_pg,
                    r.pp_toi_pg,
                    r.toi_share,
                )
            )
    return dict(rosters), values


def season_points(d_off: float, d_def: float, params: StrengthParams | None = None) -> float:
    """Standings points over 82 games a rating change is worth to an
    average team against average opponents."""
    engine = RatingEngine(params=params or StrengthParams())
    base = engine.points_per_game("X")
    r = engine.team("Y")
    r.off, r.defense = d_off, d_def
    return 82 * (engine.points_per_game("Y") - base)


def realism(
    rosters: dict[str, list[Spot]],
    values: dict[int, PlayerValue],
    goal_diff: dict[str, float],
    league_avg: float = 2.95,
) -> dict[str, Any]:
    """The checks the Roster Lab must pass (docs/superpowers/specs/
    2026-10-24-roster-lab-design.md): what losing a top-five player costs,
    what a fourth-line swap moves, and how lineups track team results."""
    today = date.today()

    def pts(moves: list[Any]) -> dict[str, float]:
        return {
            w.team: season_points(w.d_off, w.d_def)
            for w in team_deltas(moves, rosters, values, league_avg, today)
            if w.end is None
        }

    losses = []
    for team, spots in rosters.items():
        for s in spots:
            if s.in_lineup and s.position != "G":
                losses.append((-pts([Injury(s.player_id, None)]).get(team, 0.0), s.player_id))
    losses.sort(reverse=True)
    top5 = [(values[p].name if p in values else str(p), round(x, 2)) for x, p in losses[:5]]

    def fourth(team: str) -> int:
        fw = sorted(
            (s for s in rosters[team] if s.in_lineup and s.position == "F"),
            key=lambda s: -s.ev_toi_pg,
        )
        return fw[min(11, len(fw) - 1)].player_id

    teams = sorted(rosters)
    swap = max(
        (
            abs(v)
            for a, b in zip(teams[::2], teams[1::2], strict=False)
            for v in pts([Trade(fourth(a), b), Trade(fourth(b), a)]).values()
        ),
        default=0.0,
    )
    net: dict[str, float] = {}
    for t, spots in rosters.items():
        lu = [s for s in spots if s.in_lineup]
        gf, ga = team_goals(lu, lu, values)
        net[t] = gf - ga
    common = [t for t in teams if t in goal_diff]
    corr = (
        float(np.corrcoef([net[t] for t in common], [goal_diff[t] for t in common])[0, 1])
        if len(common) > 2
        else 0.0
    )
    passed = all(7.0 <= x <= 11.0 for _, x in top5) and swap < 1.0 and corr > 0.4
    report: dict[str, Any] = {
        "top5_full_season_points": top5,
        "fourth_line_swap_points": round(swap, 3),
        "corr_lineup_vs_goal_diff": round(corr, 3),
        "passed": passed,
    }
    return report


async def _game_ids(seasons: list[int], settings: Settings) -> list[int]:
    years = {str(s // 10000) for s in seasons}
    ids = {
        int(p.name.split(".")[0])
        for p in (settings.raw_cache_dir / "play-by-play").glob("*.json.gz")
        if p.name[:4] in years and p.name[4:6] == "02"
    }
    try:
        async with session_scope() as s:
            rows = await s.execute(
                select(Game.id).where(
                    Game.season.in_(seasons),
                    Game.game_type == 2,
                    Game.state.in_(FINISHED_STATES),
                )
            )
            ids |= {int(r[0]) for r in rows}
    except Exception as exc:  # no database (a laptop run from raw files)
        log.warning("player_values.no_db", error=str(exc))
    return sorted(ids)


async def load_season(seasons: list[int], settings: Settings | None = None) -> Season:
    s = settings or get_settings()
    model = default_model()
    season = Season()
    raw: list[tuple[str, dict[str, Any], list[dict[str, Any]]]] = []
    async with NhlClient() as client:
        for gid in await _game_ids(seasons, s):
            pbp = await client.play_by_play(gid)
            if pbp.get("gameState") not in FINISHED_STATES:
                continue
            shifts = (await client.shiftcharts(gid)).get("data", [])
            if not shifts:
                continue
            raw.append((str(pbp.get("startTimeUTC", "")), pbp, shifts))
    raw.sort(key=lambda r: r[0])
    for i, (_, pbp, shifts) in enumerate(raw):
        season.games.append(read_game(i, pbp, shifts, model))
    return season


async def run_player_values(
    seasons: list[int], *, refit_alpha: bool = False, settings: Settings | None = None
) -> dict[str, int]:
    s = settings or get_settings()
    current = max(seasons)
    season = await load_season(seasons, s)
    path = _alpha_path(s)
    if refit_alpha or not path.exists():
        stints = [st for g in season.games for st in g.stints]
        alpha = await asyncio.to_thread(choose_alpha, stints)
        path.write_text(json.dumps({"version": MODEL_VERSION, "alpha": alpha}, indent=2) + "\n")
    alpha = float(json.loads(path.read_text())["alpha"])
    values = await asyncio.to_thread(season.values, alpha)
    last = season.last_game()
    now = datetime.now(UTC)
    teams: list[str] = list(league_config(current, s)["teams"])
    spot_rows: list[dict[str, Any]] = []
    async with NhlClient() as client:
        for team in teams:
            body = await client.roster(team)
            roster = [
                *body.get("forwards", []),
                *body.get("defensemen", []),
                *body.get("goalies", []),
            ]
            spot_rows += spots(team, roster, season, current, values, last, now)
    value_rows = [
        {
            "player_id": v.player_id,
            "name": v.name,
            "position": v.position,
            "last_team": v.last_team,
            "off60": v.off60,
            "def60": v.def60,
            "finish_per_shot": v.finish_per_shot,
            "shots_per60": v.shots_per60,
            "gsax_per_shot": v.gsax_per_shot,
            "ev_toi_pg": v.ev_toi_pg,
            "pp_toi_pg": v.pp_toi_pg,
            "games": v.games,
            "model_version": MODEL_VERSION,
            "computed_at": now,
        }
        for v in values.values()
    ]
    async with session_scope() as sess:
        await sess.execute(delete(PlayerValueRow))
        await sess.execute(delete(RosterSpot))
        for i in range(0, len(value_rows), 1000):
            await sess.execute(insert(PlayerValueRow).values(value_rows[i : i + 1000]))
        for i in range(0, len(spot_rows), 1000):
            await sess.execute(insert(RosterSpot).values(spot_rows[i : i + 1000]))
    lineups = sum(1 for r in spot_rows if r["in_lineup"])
    log.info(
        "player_values.done",
        games=len(season.games),
        players=len(value_rows),
        spots=len(spot_rows),
        lineup=lineups,
        alpha=alpha,
    )
    return {
        "games": len(season.games),
        "players": len(value_rows),
        "spots": len(spot_rows),
        "lineup": lineups,
    }
