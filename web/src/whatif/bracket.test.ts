import { expect, test } from "vitest";
import { projectBracket, seriesWin } from "./bracket";
import type { TeamResult } from "./useSimulator";

test("a best-of-seven between equal teams is a coin flip", () => {
  expect(seriesWin(0.5, 0.5)).toBeCloseTo(0.5, 10);
  expect(seriesWin(1, 1)).toBe(1);
  expect(seriesWin(0, 0)).toBe(0);
});

test("a 60% game favorite wins the series about 71% of the time", () => {
  // Sum over k losses of C(3+k, k) 0.6^4 0.4^k.
  expect(seriesWin(0.6, 0.6)).toBeCloseTo(0.71021, 5);
  // Home ice helps the higher seed: four of seven games at home.
  expect(seriesWin(0.6, 0.5)).toBeGreaterThan(seriesWin(0.5, 0.6));
});

const team = (abbrev: string, pts: number, slot: string): TeamResult => ({
  team: abbrev,
  p_playoffs: 1,
  p_division: 0,
  p_cup: 0,
  p_round2: 0,
  p_conf_final: 0,
  p_final: 0,
  exp_points: pts,
  seed_dist: { [slot]: 1 },
});

test("the better division winner meets the second wild card, and favorites advance", () => {
  const east = [
    team("A1", 100, "div1"),
    team("A2", 95, "div2"),
    team("A3", 90, "div3"),
    team("M1", 110, "div1"),
    team("M2", 96, "div2"),
    team("M3", 91, "div3"),
    team("W1", 89, "wc1"),
    team("W2", 88, "wc2"),
  ];
  const west = east.map((t) => ({ ...t, team: `x${t.team}` }));
  const info: Record<string, { conference: string; division: string }> = {};
  for (const t of east)
    info[t.team] = { conference: "Eastern", division: t.team[0] === "M" ? "Metro" : "Atl" };
  for (const t of west)
    info[t.team] = { conference: "Western", division: t.team[1] === "M" ? "Pac" : "Cen" };
  const all = [...east, ...west];
  const order = all.map((t) => t.team);
  // Every team is a 55% favorite at home; nobody is better on the road.
  const p = order.map(() => order.map(() => 0.55));
  const b = projectBracket(all, info, order, p);
  const r1 = b.conferences[0]!.rounds[0]!;
  const pairs = r1.map((s) => `${s.high.team}-${s.low.team}`);
  // Atlantic sorts first; M1 has more points than A1, so A1 gets W1.
  expect(pairs).toEqual(["A1-W1", "A2-A3", "M1-W2", "M2-M3"]);
  // Home ice alone makes the higher seed the favorite.
  expect(r1.every((s) => s.pHigh > 0.5)).toBe(true);
  expect(b.conferences[0]!.rounds[2]![0]!.high.team).toBe("M1");
  expect(b.final).not.toBeNull();
});
