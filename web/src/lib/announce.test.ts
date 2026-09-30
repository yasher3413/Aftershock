import { announceTremor } from "./announce";
import type { TeamInfo, Tremor } from "../api/types.gen";

const teams = {
  SEA: { name: "Seattle Kraken" },
  CGY: { name: "Calgary Flames" },
  TOR: { name: "Toronto Maple Leafs" },
} as unknown as Record<string, TeamInfo>;

const tremor = {
  team: "SEA",
  magnitude: 4.06,
  overturned: false,
  deltas: [
    { team: "SEA", d_playoffs: 0.019, d_division: 0, d_cup: 0, p_playoffs_after: 0.5 },
    { team: "CGY", d_playoffs: -0.023, d_division: 0, d_cup: 0, p_playoffs_after: 0.4 },
    { team: "TOR", d_playoffs: -0.001, d_division: 0, d_cup: 0, p_playoffs_after: 0.6 },
  ],
} as unknown as Tremor;

it("names the biggest mover in plain language", () => {
  expect(announceTremor(tremor, teams, null)).toBe(
    "Goal, Seattle Kraken. Magnitude 4.1. Calgary Flames playoff odds down 2.3 percentage points.",
  );
});

it("prefers the viewer's team", () => {
  expect(announceTremor(tremor, teams, "TOR")).toContain(
    "Toronto Maple Leafs playoff odds down 0.1",
  );
});
