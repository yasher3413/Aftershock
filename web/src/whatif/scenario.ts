/** What-If scenarios: which future games the viewer has decided, and how. */

export const OUTCOMES = [
  "home_reg",
  "home_ot",
  "home_so",
  "away_reg",
  "away_ot",
  "away_so",
] as const;
export type Outcome = (typeof OUTCOMES)[number];
const CODES: Record<Outcome, string> = {
  home_reg: "hr",
  home_ot: "ho",
  home_so: "hs",
  away_reg: "ar",
  away_ot: "ao",
  away_so: "as",
};
const FROM_CODE = Object.fromEntries(Object.entries(CODES).map(([k, v]) => [v, k as Outcome]));

export interface BootstrapGame {
  game_id: number;
  start_utc: string;
  home: string;
  away: string;
  status: "final" | "future";
  result?: { home_goals: number; away_goals: number; end: string };
  probs?: number[];
  /** Headline pregame home-win odds, for display; the simulation uses probs. */
  p_home_win?: number;
  lam?: number[];
  stakes?: number;
}

export interface Bootstrap {
  season: number;
  config: string;
  teams: string[];
  outcomes: string[];
  games: BootstrapGame[];
  playoff_p: number[][];
  tie_theta: number;
  team_sigma?: number;
}

export type Scenario = Record<number, Outcome>;

/** Unset, then each of the six outcomes, then unset again. */
/**
 * Clicking a team: the first click makes it win in regulation, the next ones
 * step through overtime and a shootout, and one more clears the pick.
 * Clicking the other team switches straight to that team in regulation.
 */
export function pickTeam(current: Outcome | undefined, side: "home" | "away"): Outcome | undefined {
  if (!current || !current.startsWith(side)) return `${side}_reg`;
  if (current.endsWith("reg")) return `${side}_ot`;
  if (current.endsWith("ot")) return `${side}_so`;
  return undefined;
}

export function encode(s: Scenario): string {
  return Object.entries(s)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([id, o]) => `${id}.${CODES[o]}`)
    .join("_");
}

export function decode(text: string | null): Scenario {
  const out: Scenario = {};
  if (!text) return out;
  for (const part of text.split("_")) {
    const [id, code] = part.split(".");
    const o = code ? FROM_CODE[code] : undefined;
    if (id && /^\d+$/.test(id) && o) out[Number(id)] = o;
  }
  return out;
}

/** A plausible final score for a chosen outcome (only goal difference matters for tiebreaks). */
export function resultFor(o: Outcome): { home_goals: number; away_goals: number; end: string } {
  const end = o.endsWith("reg") ? "REG" : o.endsWith("ot") ? "OT" : "SO";
  const homeWins = o.startsWith("home");
  const [w, l] = end === "REG" ? [3, 1] : [3, 2];
  return { home_goals: homeWins ? w : l, away_goals: homeWins ? l : w, end };
}

/** The simulator input with the scenario's games made final. */
export function applyScenario(b: Bootstrap, s: Scenario): Bootstrap {
  return {
    ...b,
    games: b.games.map((g) => {
      const o = s[g.game_id];
      if (!o || g.status !== "future") return g;
      return {
        game_id: g.game_id,
        start_utc: g.start_utc,
        home: g.home,
        away: g.away,
        status: "final",
        result: resultFor(o),
      };
    }),
  };
}

/** Random plausible results for the unset games in the next `days` days. */
export function chaos(
  b: Bootstrap,
  s: Scenario,
  now: number,
  days = 7,
  rand: () => number = Math.random,
): Scenario {
  const out: Scenario = { ...s };
  const until = now + days * 86_400_000;
  for (const g of b.games) {
    const t = Date.parse(g.start_utc);
    if (g.status !== "future" || out[g.game_id] || t < now || t > until || !g.probs) continue;
    let u = rand();
    let k = 0;
    for (; k < 5; k++) {
      u -= g.probs[k] ?? 0;
      if (u < 0) break;
    }
    out[g.game_id] = OUTCOMES[k]!;
  }
  return out;
}

/** Exactly the fields the WASM simulator accepts (it rejects unknown ones). */
export function toSimInput(b: Bootstrap): unknown {
  return {
    config: b.config,
    playoff_p: b.playoff_p,
    tie_theta: b.tie_theta,
    team_sigma: b.team_sigma ?? 0,
    games: b.games.map((g) =>
      g.status === "final"
        ? { home: g.home, away: g.away, status: "final", result: g.result }
        : { home: g.home, away: g.away, status: "future", probs: g.probs, lam: g.lam },
    ),
  };
}
