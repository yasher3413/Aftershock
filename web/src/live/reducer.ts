import type {
  GameSummary,
  StandingsRow,
  StateResponse,
  TeamInfo,
  TeamOdds,
  Tremor,
  VenueInfo,
} from "../api/types.gen";
import type { LiveMessage } from "./messages";

export const MAX_TREMORS = 200;

/** A tremor or reversal waiting to be animated by the map. */
export interface Quake {
  seq: number;
  kind: "tremor" | "reversed";
  tremor: Tremor;
}

export interface LiveData {
  mode: StateResponse["mode"];
  replay: StateResponse["replay"];
  season: number;
  stateVersion: number;
  simRunId: number | null;
  teams: Record<string, TeamInfo>;
  venues: VenueInfo[];
  standings: StandingsRow[];
  odds: Record<string, TeamOdds>;
  oddsDayStart: Record<string, TeamOdds>;
  games: Record<number, GameSummary>;
  tonight: number[];
  gameOfTheNight: number | null;
  clinchScenarios: string[];
  tremors: Tremor[];
  quakes: Quake[];
  lastSeq: number;
  lastMessageAt: number | null;
  recapReady: string | null;
}

export const emptyLiveData: LiveData = {
  mode: "live",
  replay: null,
  season: 0,
  stateVersion: 0,
  simRunId: null,
  teams: {},
  venues: [],
  standings: [],
  odds: {},
  oddsDayStart: {},
  games: {},
  tonight: [],
  gameOfTheNight: null,
  clinchScenarios: [],
  tremors: [],
  quakes: [],
  lastSeq: 0,
  lastMessageAt: null,
  recapReady: null,
};

function byTeam(rows: TeamOdds[]): Record<string, TeamOdds> {
  return Object.fromEntries(rows.map((r) => [r.team, r]));
}

/** Build client state from the /api/state bootstrap payload. */
export function fromState(s: StateResponse): LiveData {
  const games: Record<number, GameSummary> = {};
  for (const g of [...s.tonight, ...s.live_games]) games[g.id] = g;
  return {
    ...emptyLiveData,
    mode: s.mode,
    replay: s.replay ?? null,
    season: s.season,
    stateVersion: s.state_version,
    simRunId: s.sim_run_id ?? null,
    teams: Object.fromEntries(s.teams.map((t) => [t.abbrev, t])),
    venues: s.venues,
    standings: s.standings,
    odds: byTeam(s.odds),
    oddsDayStart: byTeam(s.odds_day_start ?? []),
    games,
    tonight: s.tonight.map((g) => g.id),
    gameOfTheNight: s.game_of_the_night ?? null,
    clinchScenarios: s.clinch_scenarios ?? [],
    tremors: s.tremors,
  };
}

/** Apply one live message. Pure: returns a new state object. */
export function applyMessage(state: LiveData, msg: LiveMessage, now = Date.now()): LiveData {
  if (msg.seq <= state.lastSeq && msg.type !== "hello") return state;
  const base = { ...state, lastSeq: Math.max(state.lastSeq, msg.seq), lastMessageAt: now };
  switch (msg.type) {
    case "hello":
      return { ...base, mode: msg.mode, stateVersion: msg.state_version };
    case "heartbeat":
      return base;
    case "game_update": {
      const g = msg.game;
      const tonight = base.tonight.includes(g.id) ? base.tonight : [...base.tonight, g.id];
      return { ...base, games: { ...base.games, [g.id]: g }, tonight };
    }
    case "event":
      return base;
    case "tremor": {
      const t = msg.tremor;
      const tremors = [t, ...base.tremors.filter((x) => x.id !== t.id)].slice(0, MAX_TREMORS);
      return {
        ...base,
        tremors,
        quakes: [...base.quakes, { seq: msg.seq, kind: "tremor" as const, tremor: t }].slice(-20),
      };
    }
    case "tremor_updated": {
      const tremors = base.tremors.map((t) =>
        t.id === msg.tremor_id ? ({ ...t, ...msg.changes } as Tremor) : t,
      );
      return { ...base, tremors };
    }
    case "tremor_reversed": {
      const target = base.tremors.find((t) => t.id === msg.tremor_id);
      const tremors = base.tremors.map((t) =>
        t.id === msg.tremor_id ? { ...t, overturned: true } : t,
      );
      const quakes = target
        ? [
            ...base.quakes,
            { seq: msg.seq, kind: "reversed" as const, tremor: { ...target, overturned: true } },
          ].slice(-20)
        : base.quakes;
      return { ...base, tremors, quakes };
    }
    case "odds_update":
      return { ...base, simRunId: msg.sim_run_id, odds: { ...base.odds, ...byTeam(msg.odds) } };
    case "standings_update":
      return { ...base, standings: msg.standings };
    case "recap_ready":
      return { ...base, recapReady: msg.night_date };
  }
}
