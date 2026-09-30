import { applyScenario, chaos, cycle, decode, encode, resultFor, type Bootstrap } from "./scenario";

const boot: Bootstrap = {
  season: 20262027,
  config: "nhl-2026-27",
  teams: ["AAA", "BBB"],
  outcomes: [],
  playoff_p: [],
  tie_theta: 1.5,
  games: [
    {
      game_id: 1,
      start_utc: "2026-10-01T23:00:00Z",
      home: "AAA",
      away: "BBB",
      status: "final",
      result: { home_goals: 2, away_goals: 1, end: "REG" },
    },
    {
      game_id: 2,
      start_utc: "2026-10-02T23:00:00Z",
      home: "BBB",
      away: "AAA",
      status: "future",
      probs: [0.4, 0.05, 0.05, 0.4, 0.05, 0.05],
      lam: [3, 3],
    },
    {
      game_id: 3,
      start_utc: "2026-11-30T23:00:00Z",
      home: "AAA",
      away: "BBB",
      status: "future",
      probs: [0.4, 0.05, 0.05, 0.4, 0.05, 0.05],
      lam: [3, 3],
    },
  ],
};

it("cycles through all six outcomes and back to unset", () => {
  const seen = [];
  let o = cycle(undefined);
  while (o) {
    seen.push(o);
    o = cycle(o);
  }
  expect(seen).toHaveLength(6);
});

it("round-trips the URL encoding and ignores junk", () => {
  const s = { 2: "away_ot" as const, 3: "home_reg" as const };
  expect(decode(encode(s))).toEqual(s);
  expect(decode("2.zz_abc_3.hr")).toEqual({ 3: "home_reg" });
  expect(decode(null)).toEqual({});
});

it("turns chosen games into finals with the right winner and end", () => {
  const out = applyScenario(boot, { 2: "away_so", 1: "away_reg" });
  expect(out.games[1]).toMatchObject({
    status: "final",
    result: { end: "SO", home_goals: 2, away_goals: 3 },
  });
  expect(out.games[0]).toBe(boot.games[0]); // already final: untouched
  expect(resultFor("home_reg")).toEqual({ home_goals: 3, away_goals: 1, end: "REG" });
});

it("chaos only fills unset games within the window", () => {
  const s = chaos(boot, {}, Date.parse("2026-10-01T00:00:00Z"), 7, () => 0.1);
  expect(Object.keys(s)).toEqual(["2"]);
  expect(s[2]).toBe("home_reg");
});
