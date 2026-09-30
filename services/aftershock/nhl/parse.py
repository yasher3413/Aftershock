"""Parse NHL API responses into normalized, typed records.

Everything downstream (database, models, live engine, replay) consumes these
records instead of raw JSON. See ``docs/DATA.md`` for the observed schema.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

JSON = dict[str, Any]

REG_PERIOD_S = 1200
REG_GAME_S = 3 * REG_PERIOD_S
REG_SEASON_OT_S = 300

SHOT_TYPES = frozenset({"shot-on-goal", "missed-shot", "goal"})
UNBLOCKED = SHOT_TYPES
FENWICK_AND_BLOCKED = SHOT_TYPES | {"blocked-shot"}

KNOWN_STATES = frozenset({"FUT", "PRE", "LIVE", "CRIT", "FINAL", "OFF"})
LIVE_STATES = frozenset({"LIVE", "CRIT"})
FINISHED_STATES = frozenset({"FINAL", "OFF"})


def mmss_to_seconds(value: str | None) -> int:
    if not value:
        return 0
    minutes, _, seconds = value.partition(":")
    return int(minutes) * 60 + int(seconds)


def game_seconds(period: int, period_type: str, t_period_s: int, game_type: int) -> int:
    """Elapsed game time in seconds at a point in a given period.

    Regular-season overtime is 5 minutes and the shootout is placed after it.
    Playoff overtime periods are 20 minutes each.
    """
    if period <= 3:
        return (period - 1) * REG_PERIOD_S + t_period_s
    if period_type == "SO":
        return REG_GAME_S + REG_SEASON_OT_S
    if game_type == 3:
        return REG_GAME_S + (period - 4) * REG_PERIOD_S + t_period_s
    return REG_GAME_S + t_period_s


@dataclass(frozen=True, slots=True)
class Situation:
    """Decoded ``situationCode``: away goalie, away skaters, home skaters, home goalie."""

    away_goalie: bool
    away_skaters: int
    home_skaters: int
    home_goalie: bool

    @classmethod
    def parse(cls, code: str | None) -> Situation | None:
        if not code or len(code) != 4 or not code.isdigit():
            return None
        return cls(code[0] == "1", int(code[1]), int(code[2]), code[3] == "1")

    def for_team(self, is_home: bool) -> tuple[int, int, bool, bool]:
        """(own skaters, opponent skaters, own goalie in, opponent goalie in)."""
        if is_home:
            return self.home_skaters, self.away_skaters, self.home_goalie, self.away_goalie
        return self.away_skaters, self.home_skaters, self.away_goalie, self.home_goalie


@dataclass(slots=True)
class Play:
    event_id: int
    sort_order: int
    period: int
    period_type: str
    t_period_s: int
    t_game_s: int
    situation_code: str | None
    type: str
    owner_team_id: int | None
    x: float | None
    y: float | None
    zone: str | None
    shot_type: str | None
    shooter_id: int | None
    scorer_id: int | None
    assist1_id: int | None
    assist2_id: int | None
    goalie_id: int | None
    home_score: int | None
    away_score: int | None
    penalty_minutes: int | None
    penalty_type: str | None
    penalty_desc: str | None
    home_defending_side: str | None
    reason: str | None
    raw: JSON = field(repr=False)
    x_norm: float | None = None
    y_norm: float | None = None

    @property
    def situation(self) -> Situation | None:
        return Situation.parse(self.situation_code)

    @property
    def is_shootout(self) -> bool:
        return self.period_type == "SO"


@dataclass(frozen=True, slots=True)
class TeamRef:
    id: int
    abbrev: str
    score: int | None
    sog: int | None


@dataclass(slots=True)
class GameMeta:
    id: int
    season: int
    game_type: int
    game_date: date
    start_utc: datetime
    venue: str | None
    venue_city: str | None
    state: str
    schedule_state: str | None
    period: int | None
    period_type: str | None
    clock_seconds: int | None
    clock_running: bool
    in_intermission: bool
    home: TeamRef
    away: TeamRef
    last_period_type: str | None
    ot_periods: int | None

    @property
    def is_live(self) -> bool:
        return self.state in LIVE_STATES

    @property
    def is_finished(self) -> bool:
        return self.state in FINISHED_STATES


@dataclass(slots=True)
class ParsedGame:
    meta: GameMeta
    plays: list[Play]
    roster: dict[int, JSON]


def _int(value: Any) -> int | None:
    return None if value is None else int(value)


def _float(value: Any) -> float | None:
    return None if value is None else float(value)


def _team(raw: JSON) -> TeamRef:
    return TeamRef(
        id=int(raw["id"]),
        abbrev=str(raw["abbrev"]),
        score=_int(raw.get("score")),
        sog=_int(raw.get("sog")),
    )


def _default(value: Any) -> str | None:
    if isinstance(value, dict):
        v = value.get("default")
        return None if v is None else str(v)
    return None if value is None else str(value)


def parse_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def parse_meta(raw: JSON) -> GameMeta:
    pd = raw.get("periodDescriptor") or {}
    clock = raw.get("clock") or {}
    outcome = raw.get("gameOutcome") or {}
    return GameMeta(
        id=int(raw["id"]),
        season=int(raw["season"]),
        game_type=int(raw["gameType"]),
        game_date=date.fromisoformat(raw["gameDate"]),
        start_utc=parse_datetime(raw["startTimeUTC"]),
        venue=_default(raw.get("venue")),
        venue_city=_default(raw.get("venueLocation")),
        state=str(raw.get("gameState", "FUT")),
        schedule_state=raw.get("gameScheduleState"),
        period=_int(pd.get("number")),
        period_type=pd.get("periodType"),
        clock_seconds=_int(clock.get("secondsRemaining")),
        clock_running=bool(clock.get("running", False)),
        in_intermission=bool(clock.get("inIntermission", False)),
        home=_team(raw["homeTeam"]),
        away=_team(raw["awayTeam"]),
        last_period_type=outcome.get("lastPeriodType"),
        ot_periods=_int(outcome.get("otPeriods")),
    )


def parse_play(raw: JSON, game_type: int) -> Play:
    pd = raw.get("periodDescriptor") or {}
    d = raw.get("details") or {}
    period = int(pd.get("number", 0))
    period_type = str(pd.get("periodType", "REG"))
    t_period = mmss_to_seconds(raw.get("timeInPeriod"))
    kind = str(raw.get("typeDescKey", ""))
    shooter = d.get("shootingPlayerId")
    if kind == "goal":
        shooter = d.get("scoringPlayerId")
    return Play(
        event_id=int(raw["eventId"]),
        sort_order=int(raw.get("sortOrder", 0)),
        period=period,
        period_type=period_type,
        t_period_s=t_period,
        t_game_s=game_seconds(period, period_type, t_period, game_type),
        situation_code=raw.get("situationCode"),
        type=kind,
        owner_team_id=_int(d.get("eventOwnerTeamId")),
        x=_float(d.get("xCoord")),
        y=_float(d.get("yCoord")),
        zone=d.get("zoneCode"),
        shot_type=d.get("shotType"),
        shooter_id=_int(shooter),
        scorer_id=_int(d.get("scoringPlayerId")),
        assist1_id=_int(d.get("assist1PlayerId")),
        assist2_id=_int(d.get("assist2PlayerId")),
        goalie_id=_int(d.get("goalieInNetId")),
        home_score=_int(d.get("homeScore")),
        away_score=_int(d.get("awayScore")),
        penalty_minutes=_int(d.get("duration")),
        penalty_type=d.get("typeCode"),
        penalty_desc=d.get("descKey"),
        home_defending_side=raw.get("homeTeamDefendingSide"),
        reason=d.get("reason"),
        raw=raw,
    )


def parse_play_by_play(raw: JSON) -> ParsedGame:
    meta = parse_meta(raw)
    plays = [parse_play(p, meta.game_type) for p in raw.get("plays", [])]
    plays.sort(key=lambda p: (p.sort_order, p.event_id))
    normalize_coordinates(plays, meta.home.id)
    roster = {int(r["playerId"]): r for r in raw.get("rosterSpots", [])}
    return ParsedGame(meta=meta, plays=plays, roster=roster)


# ----------------------------------------------------------------------
# Coordinate normalization


def home_attack_signs(plays: list[Play], home_id: int) -> dict[int, int]:
    """Direction the home team attacks in each period: +1 toward +x, -1 toward -x.

    The direction is voted by unblocked shots taken in the shooter's
    offensive zone. When the vote is decisive (a margin of at least three),
    it wins; otherwise ``homeTeamDefendingSide`` is used ("left" means the home
    team defends the -x end, so it attacks +x). The vote is preferred because
    the field is wrong in a few 2019-20 and 2020-21 periods (see DATA.md),
    and it is the only source for seasons before 2019-20.
    """
    explicit: dict[int, int] = {}
    votes: dict[int, int] = {}
    for p in plays:
        if p.home_defending_side in ("left", "right") and p.period not in explicit:
            explicit[p.period] = 1 if p.home_defending_side == "left" else -1
        if (
            p.type in SHOT_TYPES
            and p.zone == "O"
            and p.x is not None
            and abs(p.x) > 25
            and p.owner_team_id is not None
            and p.period_type != "SO"
        ):
            sign = 1 if p.x > 0 else -1
            if p.owner_team_id != home_id:
                sign = -sign
            votes[p.period] = votes.get(p.period, 0) + sign
    periods = sorted({p.period for p in plays})
    signs: dict[int, int] = {}
    for period in periods:
        v = votes.get(period, 0)
        if abs(v) >= 3:
            signs[period] = 1 if v > 0 else -1
        elif period in explicit:
            signs[period] = explicit[period]
        elif v:
            signs[period] = 1 if v > 0 else -1
        elif period - 1 in signs:
            signs[period] = -signs[period - 1]
        else:
            signs[period] = 1
    return signs


def normalize_coordinates(plays: list[Play], home_id: int) -> None:
    """Rotate every located event so its owner attacks toward +x (goal at x=89)."""
    signs = home_attack_signs(plays, home_id)
    for p in plays:
        if p.x is None or p.y is None or p.owner_team_id is None:
            continue
        s = signs.get(p.period, 1)
        if p.owner_team_id != home_id:
            s = -s
        p.x_norm = p.x * s
        p.y_norm = p.y * s


# ----------------------------------------------------------------------
# Scoreboard and schedule


@dataclass(slots=True)
class ScheduledGame:
    id: int
    season: int
    game_type: int
    game_date: date
    start_utc: datetime
    venue: str | None
    neutral_site: bool
    state: str
    schedule_state: str | None
    home: TeamRef
    away: TeamRef
    last_period_type: str | None


def parse_scheduled_game(raw: JSON) -> ScheduledGame:
    outcome = raw.get("gameOutcome") or {}
    return ScheduledGame(
        id=int(raw["id"]),
        season=int(raw["season"]),
        game_type=int(raw["gameType"]),
        game_date=date.fromisoformat(raw.get("gameDate") or raw["startTimeUTC"][:10]),
        start_utc=parse_datetime(raw["startTimeUTC"]),
        venue=_default(raw.get("venue")),
        neutral_site=bool(raw.get("neutralSite", False)),
        state=str(raw.get("gameState", "FUT")),
        schedule_state=raw.get("gameScheduleState"),
        home=_team(raw["homeTeam"]),
        away=_team(raw["awayTeam"]),
        last_period_type=outcome.get("lastPeriodType"),
    )


@dataclass(frozen=True, slots=True)
class StandingsRow:
    team: str
    season: int
    conference: str
    division: str
    gp: int
    w: int
    l: int  # noqa: E741
    otl: int
    points: int
    rw: int
    row: int
    gf: int
    ga: int
    so_wins: int
    so_losses: int
    league_seq: int
    conference_seq: int
    division_seq: int
    wildcard_seq: int | None
    clinch: str | None


def parse_standings(raw: JSON) -> list[StandingsRow]:
    rows: list[StandingsRow] = []
    for r in raw.get("standings", []):
        rows.append(
            StandingsRow(
                team=r["teamAbbrev"]["default"],
                season=int(r["seasonId"]),
                conference=r.get("conferenceName") or "",
                division=r.get("divisionName") or "",
                gp=int(r["gamesPlayed"]),
                w=int(r["wins"]),
                l=int(r["losses"]),
                otl=int(r["otLosses"]),
                points=int(r["points"]),
                rw=int(r.get("regulationWins") or 0),
                row=int(r.get("regulationPlusOtWins") or 0),
                gf=int(r["goalFor"]),
                ga=int(r["goalAgainst"]),
                so_wins=int(r.get("shootoutWins") or 0),
                so_losses=int(r.get("shootoutLosses") or 0),
                league_seq=int(r["leagueSequence"]),
                conference_seq=int(r["conferenceSequence"]),
                division_seq=int(r["divisionSequence"]),
                wildcard_seq=_int(r.get("wildcardSequence")),
                clinch=r.get("clinchIndicator"),
            )
        )
    return rows
