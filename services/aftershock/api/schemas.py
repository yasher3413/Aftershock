"""API response and WebSocket message models.

These are the single source of truth for the wire format. ``aftershock
export-schema`` writes their JSON Schema, and the web app generates
``web/src/api/types.gen.ts`` from it. All probabilities are floats in [0, 1];
the UI does the formatting.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Prob = Annotated[float, Field(ge=0.0, le=1.0)]


class Model(BaseModel):
    model_config = ConfigDict(
        from_attributes=True, json_schema_serialization_defaults_required=True
    )


class TeamInfo(Model):
    abbrev: str
    name: str
    conference: str
    division: str
    arena: str
    lat: float
    lon: float
    color_primary: str
    color_secondary: str


class VenueInfo(Model):
    name: str
    city: str
    country: str
    lat: float
    lon: float


class SixWay(Model):
    home_reg: Prob
    home_ot: Prob
    home_so: Prob
    away_reg: Prob
    away_ot: Prob
    away_so: Prob


class TeamOdds(Model):
    team: str
    p_playoffs: Prob
    p_division: Prob
    p_top3_div: Prob
    p_wildcard: Prob
    p_presidents: Prob
    p_conf_first: Prob
    p_round2: Prob
    p_conf_final: Prob
    p_final: Prob
    p_cup: Prob
    p_last: Prob
    exp_points: float


class StandingsRow(Model):
    team: str
    conference: str
    division: str
    gp: int
    w: int
    l: int  # noqa: E741
    otl: int
    points: int
    points_pct: float
    rw: int
    row: int
    gf: int
    ga: int
    division_rank: int
    conference_rank: int
    league_rank: int
    wildcard_rank: int | None = None


class GameSummary(Model):
    id: int
    season: int
    game_type: int
    night_date: date
    start_utc: datetime
    home: str
    away: str
    venue: str | None
    state: str
    period: int | None = None
    period_type: str | None = None
    clock_seconds: int | None = None
    in_intermission: bool = False
    home_score: int | None = None
    away_score: int | None = None
    home_sog: int | None = None
    away_sog: int | None = None
    last_period_type: str | None = None
    pregame: SixWay | None = None
    wp: SixWay | None = None
    stakes: float | None = None


class Origin(Model):
    venue: str | None
    lat: float
    lon: float
    off_map: bool = False
    label: str | None = None


class PlayerRef(Model):
    id: int
    name: str


class TeamDelta(Model):
    team: str
    d_playoffs: float
    d_division: float
    d_cup: float
    p_playoffs_after: Prob


class Score(Model):
    home: int
    away: int


class Tremor(Model):
    id: int
    season: int
    game_id: int
    event_id: int
    night_date: date
    team: str
    opponent: str
    home: str
    away: str
    scorer: PlayerRef | None = None
    assists: list[PlayerRef] = Field(default_factory=list)
    goalie: PlayerRef | None = None
    period: int
    period_type: str
    t_period_s: int
    t_game_s: int
    shootout: bool = False
    score_before: Score
    score_after: Score
    wp_before: SixWay
    wp_after: SixWay
    deltas: list[TeamDelta]
    total_shift: float
    magnitude: float
    ppa: float
    cpa: float
    origin: Origin
    overturned: bool = False
    created_at: datetime


class ReplayInfo(Model):
    night_date: date
    season: int
    speed: float
    next_live_utc: datetime | None = None


class StateResponse(Model):
    mode: Literal["live", "demo"]
    replay: ReplayInfo | None = None
    server_time: datetime
    state_version: int
    season: int
    sim_run_id: int | None
    teams: list[TeamInfo]
    venues: list[VenueInfo]
    standings: list[StandingsRow]
    odds: list[TeamOdds]
    odds_day_start: list[TeamOdds] = Field(default_factory=list)
    live_games: list[GameSummary]
    tonight: list[GameSummary]
    game_of_the_night: int | None = None
    clinch_scenarios: list[str] = Field(default_factory=list)
    tremors: list[Tremor]


class OddsPoint(Model):
    t: datetime
    sim_run_id: int
    trigger: str
    value: Prob


class HistBin(Model):
    x: int
    p: Prob


class RootingLine(Model):
    game_id: int
    start_utc: datetime
    home: str
    away: str
    involves_team: bool
    impact: float  # P(team makes playoffs | home wins) - P(... | away wins)
    stderr: float
    root_for: str
    best_outcome: str
    best_outcome_p: Prob
    worst_outcome: str
    worst_outcome_p: Prob


class ScheduleGame(Model):
    game_id: int
    start_utc: datetime
    opponent: str
    home: bool
    p_win: Prob
    p_points: Prob


class TeamPlayerPpa(Model):
    player: PlayerRef
    goals: int
    ppa: float
    assists: int
    assist_ppa: float


class ClinchOut(Model):
    status: Literal["clinched", "eliminated", "alive"]
    magic_number: int | None = None
    max_points: int


class TeamResponse(Model):
    team: TeamInfo
    clinch: ClinchOut | None = None
    odds: TeamOdds | None
    history: dict[str, list[OddsPoint]]
    points_hist: list[HistBin]
    seed_dist: dict[str, Prob]
    rooting: list[RootingLine]
    remaining: list[ScheduleGame]
    tremors_for: list[Tremor]
    tremors_against: list[Tremor]
    players: list[TeamPlayerPpa]


class WpPoint(Model):
    t_game_s: int
    event_id: int | None
    p_home: Prob
    p_away: Prob
    p_tie: Prob


class ShotOut(Model):
    event_id: int
    team: str
    period: int
    t_period_s: int
    x: float
    y: float
    xg: float
    goal: bool
    shooter: PlayerRef | None = None
    shot_type: str | None = None


class GameResponse(Model):
    game: GameSummary
    wp: list[WpPoint]
    shots: list[ShotOut]
    xg_home: float
    xg_away: float
    tremors: list[Tremor]


class TremorPage(Model):
    items: list[Tremor]
    next_cursor: str | None = None


class LeaderRow(Model):
    rank: int
    player: PlayerRef | None = None
    team: str
    value: float
    count: int


class LeadersResponse(Model):
    season: int
    kind: Literal["skater", "assist", "goalie", "team_chaos"]
    rows: list[LeaderRow]


class NightInfo(Model):
    night_date: date
    season: int
    total_energy: float
    n_games: int
    n_tremors: int


class HealthResponse(Model):
    ok: bool
    server_time: datetime
    last_poll: dict[str, datetime | None]
    worker_lag_s: float | None
    last_sim_ms: float | None
    last_sim_at: datetime | None
    mode: Literal["live", "demo"]


class JobRunOut(Model):
    id: int
    job: str
    status: str
    started_at: datetime
    finished_at: datetime | None
    detail: dict[str, Any]


class StatusResponse(Model):
    health: HealthResponse
    sim_runs: list[dict[str, Any]]
    reconcile: list[dict[str, Any]]
    jobs: list[JobRunOut]


class PushKeys(Model):
    p256dh: str
    auth: str


class PushSubscriptionIn(Model):
    endpoint: str
    keys: PushKeys


class PushSubscribeRequest(Model):
    subscription: PushSubscriptionIn
    team: str
    min_magnitude: float = Field(ge=0, le=10)


class RecapResponse(Model):
    night_date: date
    headline: str
    body: str
    key_numbers: list[str]
    model: str
    validated: bool


# ----------------------------------------------------------------------
# WebSocket messages


class Msg(Model):
    seq: int
    ts: datetime


class HelloMsg(Msg):
    type: Literal["hello"] = "hello"
    mode: Literal["live", "demo"]
    server_time: datetime
    state_version: int


class GameUpdateMsg(Msg):
    type: Literal["game_update"] = "game_update"
    game: GameSummary


class EventMsg(Msg):
    type: Literal["event"] = "event"
    game_id: int
    event_id: int
    kind: str
    period: int
    t_period_s: int
    team: str | None = None
    x: float | None = None
    y: float | None = None


class TremorMsg(Msg):
    type: Literal["tremor"] = "tremor"
    tremor: Tremor


class TremorUpdatedMsg(Msg):
    type: Literal["tremor_updated"] = "tremor_updated"
    tremor_id: int
    changes: dict[str, Any]


class TremorReversedMsg(Msg):
    type: Literal["tremor_reversed"] = "tremor_reversed"
    tremor_id: int
    game_id: int
    origin: Origin
    deltas: list[TeamDelta]


class OddsUpdateMsg(Msg):
    type: Literal["odds_update"] = "odds_update"
    sim_run_id: int
    trigger: str
    odds: list[TeamOdds]


class StandingsUpdateMsg(Msg):
    type: Literal["standings_update"] = "standings_update"
    standings: list[StandingsRow]


class RecapReadyMsg(Msg):
    type: Literal["recap_ready"] = "recap_ready"
    night_date: date


class HeartbeatMsg(Msg):
    type: Literal["heartbeat"] = "heartbeat"


LiveMessage = Annotated[
    HelloMsg
    | GameUpdateMsg
    | EventMsg
    | TremorMsg
    | TremorUpdatedMsg
    | TremorReversedMsg
    | OddsUpdateMsg
    | StandingsUpdateMsg
    | RecapReadyMsg
    | HeartbeatMsg,
    Field(discriminator="type"),
]


class ReplayInitial(Model):
    odds: list[TeamOdds]
    standings: list[StandingsRow]
    games: list[GameSummary]


class ReplayFrame(Model):
    t: int  # milliseconds after the night's first puck drop
    message: LiveMessage


class ReplayBundleOut(Model):
    """A whole night, playable by the web client's timeline player."""

    night_date: date
    season: int
    start_utc: datetime
    duration_ms: int
    initial: ReplayInitial
    frames: list[ReplayFrame]


class Schema(BaseModel):
    """Root that references every wire type, for JSON Schema export."""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    state: StateResponse
    team: TeamResponse
    game: GameResponse
    tremor_page: TremorPage
    leaders: LeadersResponse
    nights: list[NightInfo]
    health: HealthResponse
    status: StatusResponse
    recap: RecapResponse
    message: LiveMessage
    replay: ReplayBundleOut
