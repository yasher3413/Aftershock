/* Generated from services/aftershock/api/schemas.py. Do not edit; run `make types`. */

/**
 * Root that references every wire type, for JSON Schema export.
 */
export interface Schema {
  energy: EnergySeries[];
  game: GameResponse;
  health: HealthResponse;
  leaders: LeadersResponse;
  message:
    | HelloMsg
    | GameUpdateMsg
    | EventMsg
    | TremorMsg
    | TremorUpdatedMsg
    | TremorReversedMsg
    | OddsUpdateMsg
    | StandingsUpdateMsg
    | RecapReadyMsg
    | HeartbeatMsg;
  nights: NightInfo[];
  player: PlayerResponse;
  recap: RecapResponse;
  replay: ReplayBundleOut;
  state: StateResponse;
  status: StatusResponse;
  team: TeamResponse;
  tremor_page: TremorPage;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "EnergySeries".
 */
export interface EnergySeries {
  points: EnergyPoint[];
  season: number;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "EnergyPoint".
 */
export interface EnergyPoint {
  cumulative: number;
  day: number;
  shift: number;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "GameResponse".
 */
export interface GameResponse {
  game: GameSummary;
  shots: ShotOut[];
  tremors: Tremor[];
  wp: WpPoint[];
  xg_away: number;
  xg_home: number;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "GameSummary".
 */
export interface GameSummary {
  away: string;
  away_score: number | null;
  away_sog: number | null;
  clock_seconds: number | null;
  game_type: number;
  home: string;
  home_score: number | null;
  home_sog: number | null;
  id: number;
  in_intermission: boolean;
  last_period_type: string | null;
  night_date: string;
  period: number | null;
  period_type: string | null;
  pregame: SixWay | null;
  season: number;
  stakes: number | null;
  start_utc: string;
  state: string;
  venue: string | null;
  wp: SixWay | null;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "SixWay".
 */
export interface SixWay {
  away_ot: number;
  away_reg: number;
  away_so: number;
  home_ot: number;
  home_reg: number;
  home_so: number;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "ShotOut".
 */
export interface ShotOut {
  event_id: number;
  goal: boolean;
  period: number;
  shooter: PlayerRef | null;
  shot_type: string | null;
  t_period_s: number;
  team: string;
  x: number;
  xg: number;
  y: number;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "PlayerRef".
 */
export interface PlayerRef {
  id: number;
  name: string;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "Tremor".
 */
export interface Tremor {
  assists: PlayerRef[];
  away: string;
  cpa: number;
  created_at: string;
  deltas: TeamDelta[];
  event_id: number;
  game_id: number;
  goalie: PlayerRef | null;
  home: string;
  id: number;
  magnitude: number;
  night_date: string;
  opponent: string;
  origin: Origin;
  overturned: boolean;
  period: number;
  period_type: string;
  ppa: number;
  score_after: Score;
  score_before: Score;
  scorer: PlayerRef | null;
  season: number;
  shootout: boolean;
  t_game_s: number;
  t_period_s: number;
  team: string;
  total_shift: number;
  wp_after: SixWay;
  wp_before: SixWay;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "TeamDelta".
 */
export interface TeamDelta {
  d_cup: number;
  d_division: number;
  d_playoffs: number;
  p_playoffs_after: number;
  team: string;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "Origin".
 */
export interface Origin {
  label: string | null;
  lat: number;
  lon: number;
  off_map: boolean;
  venue: string | null;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "Score".
 */
export interface Score {
  away: number;
  home: number;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "WpPoint".
 */
export interface WpPoint {
  event_id: number | null;
  p_away: number;
  p_home: number;
  p_tie: number;
  t_game_s: number;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "HealthResponse".
 */
export interface HealthResponse {
  last_poll: {
    [k: string]: string | null;
  };
  last_sim_at: string | null;
  last_sim_ms: number | null;
  mode: "live" | "demo";
  ok: boolean;
  server_time: string;
  worker_lag_s: number | null;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "LeadersResponse".
 */
export interface LeadersResponse {
  kind: "skater" | "assist" | "goalie" | "team_chaos" | "on_ice";
  rows: LeaderRow[];
  season: number;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "LeaderRow".
 */
export interface LeaderRow {
  count: number;
  player: PlayerRef | null;
  rank: number;
  team: string;
  value: number;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "HelloMsg".
 */
export interface HelloMsg {
  mode: "live" | "demo";
  seq: number;
  server_time: string;
  state_version: number;
  ts: string;
  type: "hello";
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "GameUpdateMsg".
 */
export interface GameUpdateMsg {
  game: GameSummary;
  seq: number;
  ts: string;
  type: "game_update";
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "EventMsg".
 */
export interface EventMsg {
  event_id: number;
  game_id: number;
  kind: string;
  period: number;
  seq: number;
  t_period_s: number;
  team: string | null;
  ts: string;
  type: "event";
  x: number | null;
  y: number | null;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "TremorMsg".
 */
export interface TremorMsg {
  seq: number;
  tremor: Tremor;
  ts: string;
  type: "tremor";
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "TremorUpdatedMsg".
 */
export interface TremorUpdatedMsg {
  changes: {
    [k: string]: unknown;
  };
  seq: number;
  tremor_id: number;
  ts: string;
  type: "tremor_updated";
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "TremorReversedMsg".
 */
export interface TremorReversedMsg {
  deltas: TeamDelta[];
  game_id: number;
  origin: Origin;
  seq: number;
  tremor_id: number;
  ts: string;
  type: "tremor_reversed";
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "OddsUpdateMsg".
 */
export interface OddsUpdateMsg {
  odds: TeamOdds[];
  seq: number;
  sim_run_id: number;
  trigger: string;
  ts: string;
  type: "odds_update";
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "TeamOdds".
 */
export interface TeamOdds {
  exp_points: number;
  p_bottom3: number;
  p_conf_final: number;
  p_conf_first: number;
  p_cup: number;
  p_division: number;
  p_final: number;
  p_last: number;
  p_playoffs: number;
  p_presidents: number;
  p_round2: number;
  p_top3_div: number;
  p_wildcard: number;
  team: string;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "StandingsUpdateMsg".
 */
export interface StandingsUpdateMsg {
  seq: number;
  standings: StandingsRow[];
  ts: string;
  type: "standings_update";
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "StandingsRow".
 */
export interface StandingsRow {
  conference: string;
  conference_rank: number;
  division: string;
  division_rank: number;
  ga: number;
  gf: number;
  gp: number;
  l: number;
  league_rank: number;
  otl: number;
  points: number;
  points_pct: number;
  row: number;
  rw: number;
  team: string;
  w: number;
  wildcard_rank: number | null;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "RecapReadyMsg".
 */
export interface RecapReadyMsg {
  night_date: string;
  seq: number;
  ts: string;
  type: "recap_ready";
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "HeartbeatMsg".
 */
export interface HeartbeatMsg {
  seq: number;
  ts: string;
  type: "heartbeat";
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "NightInfo".
 */
export interface NightInfo {
  n_games: number;
  n_tremors: number;
  night_date: string;
  season: number;
  total_energy: number;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "PlayerResponse".
 */
export interface PlayerResponse {
  assists: Tremor[];
  current_team: string | null;
  goals: Tremor[];
  headshot: string | null;
  id: number;
  name: string;
  position: string | null;
  season: number;
  seasons: PlayerSeason[];
  shoots_catches: string | null;
  sweater: number | null;
  team: string | null;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "PlayerSeason".
 */
export interface PlayerSeason {
  assist_ppa: number;
  assists: number;
  cpa: number;
  goalie_ppa_allowed: number;
  goals: number;
  goals_allowed: number;
  on_ice_goals_against: number | null;
  on_ice_goals_for: number | null;
  on_ice_ppa: number | null;
  ppa: number;
  season: number;
  team: string | null;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "RecapResponse".
 */
export interface RecapResponse {
  body: string;
  headline: string;
  key_numbers: string[];
  model: string;
  night_date: string;
  validated: boolean;
}
/**
 * A whole night, playable by the web client's timeline player.
 *
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "ReplayBundleOut".
 */
export interface ReplayBundleOut {
  duration_ms: number;
  frames: ReplayFrame[];
  initial: ReplayInitial;
  night_date: string;
  season: number;
  start_utc: string;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "ReplayFrame".
 */
export interface ReplayFrame {
  message:
    | HelloMsg
    | GameUpdateMsg
    | EventMsg
    | TremorMsg
    | TremorUpdatedMsg
    | TremorReversedMsg
    | OddsUpdateMsg
    | StandingsUpdateMsg
    | RecapReadyMsg
    | HeartbeatMsg;
  t: number;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "ReplayInitial".
 */
export interface ReplayInitial {
  games: GameSummary[];
  odds: TeamOdds[];
  standings: StandingsRow[];
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "StateResponse".
 */
export interface StateResponse {
  clinch_scenarios: string[];
  game_of_the_night: number | null;
  live_games: GameSummary[];
  mode: "live" | "demo";
  odds: TeamOdds[];
  odds_day_start: TeamOdds[];
  replay: ReplayInfo | null;
  season: number;
  server_time: string;
  sim_run_id: number | null;
  standings: StandingsRow[];
  state_version: number;
  teams: TeamInfo[];
  tonight: GameSummary[];
  tremors: Tremor[];
  venues: VenueInfo[];
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "ReplayInfo".
 */
export interface ReplayInfo {
  next_live_utc: string | null;
  night_date: string;
  season: number;
  speed: number;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "TeamInfo".
 */
export interface TeamInfo {
  abbrev: string;
  arena: string;
  color_primary: string;
  color_secondary: string;
  conference: string;
  division: string;
  lat: number;
  lon: number;
  name: string;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "VenueInfo".
 */
export interface VenueInfo {
  city: string;
  country: string;
  lat: number;
  lon: number;
  name: string;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "StatusResponse".
 */
export interface StatusResponse {
  health: HealthResponse;
  jobs: JobRunOut[];
  reconcile: {
    [k: string]: unknown;
  }[];
  sim_runs: {
    [k: string]: unknown;
  }[];
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "JobRunOut".
 */
export interface JobRunOut {
  detail: {
    [k: string]: unknown;
  };
  finished_at: string | null;
  id: number;
  job: string;
  started_at: string;
  status: string;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "TeamResponse".
 */
export interface TeamResponse {
  clinch: ClinchOut | null;
  history: {
    [k: string]: OddsPoint[];
  };
  odds: TeamOdds | null;
  players: TeamPlayerPpa[];
  points_hist: HistBin[];
  remaining: ScheduleGame[];
  rooting: RootingLine[];
  seed_dist: {
    [k: string]: number;
  };
  team: TeamInfo;
  tremors_against: Tremor[];
  tremors_for: Tremor[];
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "ClinchOut".
 */
export interface ClinchOut {
  magic_number: number | null;
  max_points: number;
  status: "clinched" | "eliminated" | "alive";
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "OddsPoint".
 */
export interface OddsPoint {
  sim_run_id: number;
  t: string;
  trigger: string;
  value: number;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "TeamPlayerPpa".
 */
export interface TeamPlayerPpa {
  assist_ppa: number;
  assists: number;
  goals: number;
  player: PlayerRef;
  ppa: number;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "HistBin".
 */
export interface HistBin {
  p: number;
  x: number;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "ScheduleGame".
 */
export interface ScheduleGame {
  game_id: number;
  home: boolean;
  opponent: string;
  p_points: number;
  p_win: number;
  start_utc: string;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "RootingLine".
 */
export interface RootingLine {
  away: string;
  best_outcome: string;
  best_outcome_p: number;
  game_id: number;
  home: string;
  impact: number;
  involves_team: boolean;
  root_for: string;
  start_utc: string;
  stderr: number;
  worst_outcome: string;
  worst_outcome_p: number;
}
/**
 * This interface was referenced by `Schema`'s JSON-Schema
 * via the `definition` "TremorPage".
 */
export interface TremorPage {
  items: Tremor[];
  next_cursor: string | null;
}
