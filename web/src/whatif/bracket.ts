/** A projected playoff bracket from one simulated forecast. */
import type { TeamResult } from "./useSimulator";

/**
 * Chance the higher seed wins a best-of-seven with 2-2-1-1-1 home ice.
 * `pHome` and `pAway` are its chances of winning a single game at home and
 * on the road.
 */
export function seriesWin(pHome: number, pAway: number): number {
  // Games 1, 2, 5 and 7 are at the higher seed's rink.
  const home = [true, true, false, false, true, false, true];
  // memo[g][w]: chance of winning the series from game g with w wins so far.
  const memo = new Map<string, number>();
  const go = (g: number, w: number): number => {
    const l = g - w;
    if (w === 4) return 1;
    if (l === 4) return 0;
    const key = `${g}.${w}`;
    const hit = memo.get(key);
    if (hit != null) return hit;
    const p = home[g] ? pHome : pAway;
    const v = p * go(g + 1, w + 1) + (1 - p) * go(g + 1, w);
    memo.set(key, v);
    return v;
  };
  return go(0, 0);
}

export interface Series {
  /** The higher seed (home ice), then the lower. */
  high: TeamResult;
  low: TeamResult;
  /** Chance `high` wins the series. */
  pHigh: number;
}

export interface Bracket {
  conferences: { name: string; rounds: Series[][] }[];
  final: Series | null;
}

type Info = Record<string, { conference: string; division: string }>;

/**
 * The most likely field, seeded the NHL way (three per division plus two
 * wild cards, the better division winner meeting the second wild card),
 * with the favorite of each series advancing. Home ice goes to the team
 * with more expected points.
 */
export function projectBracket(
  teams: TeamResult[],
  info: Info,
  order: string[],
  playoffP: number[][],
): Bracket {
  const idx = Object.fromEntries(order.map((t, i) => [t, i]));
  const series = (a: TeamResult, b: TeamResult): Series => {
    const [high, low] = a.exp_points >= b.exp_points ? [a, b] : [b, a];
    const h = idx[high.team]!;
    const l = idx[low.team]!;
    const pHome = playoffP[h]?.[l] ?? 0.5;
    const pAway = 1 - (playoffP[l]?.[h] ?? 0.5);
    return { high, low, pHigh: seriesWin(pHome, pAway) };
  };
  const winner = (s: Series) => (s.pHigh >= 0.5 ? s.high : s.low);
  const advance = (prev: Series[]) =>
    prev.flatMap((s, i) => (i % 2 ? [] : [series(winner(s), winner(prev[i + 1]!))]));

  const conferences = ["Eastern", "Western"].map((name) => {
    const inConf = teams.filter((t) => info[t.team]?.conference === name);
    const used = new Set<string>();
    const pick = (cands: TeamResult[], slot: string) => {
      const best = cands
        .filter((t) => !used.has(t.team))
        .sort((a, b) => (b.seed_dist[slot] ?? 0) - (a.seed_dist[slot] ?? 0))[0];
      if (best) used.add(best.team);
      return best;
    };
    const divisions = [...new Set(inConf.map((t) => info[t.team]!.division))].sort().map((dv) => {
      const c = inConf.filter((t) => info[t.team]!.division === dv);
      return ["div1", "div2", "div3"].map((slot) => pick(c, slot));
    });
    const wc1 = pick(inConf, "wc1");
    const wc2 = pick(inConf, "wc2");
    const [a, b] = divisions;
    if (!a || !b || a.some((t) => !t) || b.some((t) => !t) || !wc1 || !wc2) {
      return { name, rounds: [] as Series[][] };
    }
    // The division winner with more expected points plays the second wild card.
    const aFirst = a[0]!.exp_points >= b[0]!.exp_points;
    const r1 = [
      series(a[0]!, aFirst ? wc2 : wc1),
      series(a[1]!, a[2]!),
      series(b[0]!, aFirst ? wc1 : wc2),
      series(b[1]!, b[2]!),
    ];
    const r2 = advance(r1);
    const r3 = advance(r2);
    return { name, rounds: [r1, r2, r3] };
  });
  const champs = conferences.map((c) => c.rounds[2]?.[0]);
  const final = champs[0] && champs[1] ? series(winner(champs[0]), winner(champs[1])) : null;
  return { conferences, final };
}
