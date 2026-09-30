// WASM timing harness (a proxy for desktop Chrome: same V8 engine, single
// thread). Build first:
//
//   wasm-pack build crates/aftershock-wasm --release --target nodejs --out-dir pkg-node
//   node crates/aftershock-wasm/bench/node_bench.mjs [n_sims] [reps]
//
// Times `simulate` on a synthetic 2026-27 schedule, both from opening night
// (all 1,344 games future) and from mid-season (672 remaining).

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { simulate } = require("../pkg-node/aftershock_wasm.js");

const TEAMS = [
  "ANA", "BOS", "BUF", "CAR", "CBJ", "CGY", "CHI", "COL",
  "DAL", "DET", "EDM", "FLA", "LAK", "MIN", "MTL", "NJD",
  "NSH", "NYI", "NYR", "OTT", "PHI", "PIT", "SEA", "SJS",
  "STL", "TBL", "TOR", "UTA", "VAN", "VGK", "WPG", "WSH",
];

// Circle-method schedule, 84 games per team.
function schedule() {
  const n = TEAMS.length;
  const order = [...Array(n).keys()];
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) pairs.push([order[i], order[n - 1 - i]]);
    rounds.push(pairs);
    order.splice(1, 0, order.pop());
  }
  const games = [];
  for (let k = 0; k < 84; k++) {
    rounds[k % rounds.length].forEach(([a, b], i) => {
      const flip = (Math.floor(k / rounds.length) + i + k) % 2 === 1;
      games.push(flip ? [b, a] : [a, b]);
    });
  }
  return games;
}

function state(nFinal) {
  const games = schedule().map(([h, a], i) => {
    const g = { home: TEAMS[h], away: TEAMS[a] };
    if (i < nFinal) {
      return { ...g, status: "final", result: { home_goals: 3, away_goals: 2, end: i % 3 ? "REG" : "OT" } };
    }
    return { ...g, status: "future", probs: [0.4, 0.07, 0.04, 0.37, 0.07, 0.05], lam: [3.1, 2.9] };
  });
  const playoff_p = TEAMS.map(() => TEAMS.map(() => 0.55));
  return JSON.stringify({ config: "nhl-2026-27", games, playoff_p, tie_theta: 1.2 });
}

const nSims = Number(process.argv[2] ?? 10000);
const reps = Number(process.argv[3] ?? 10);
for (const [label, nFinal] of [["full season", 0], ["half season", 672]]) {
  const json = state(nFinal);
  simulate(json, 500, 1n); // warm up
  const ms = [];
  for (let r = 0; r < reps; r++) {
    const t = performance.now();
    const out = simulate(json, nSims, BigInt(r + 2));
    ms.push(performance.now() - t);
    if (r === 0) {
      const v = JSON.parse(out);
      const cup = v.teams.reduce((s, x) => s + x.p_cup, 0);
      if (Math.abs(cup - 1) > 1e-9) throw new Error(`p_cup sums to ${cup}`);
    }
  }
  ms.sort((a, b) => a - b);
  const q = (p) => ms[Math.round((ms.length - 1) * p)];
  console.log(
    `${label}: n_sims=${nSims} reps=${reps} median=${q(0.5).toFixed(0)}ms ` +
      `p95=${q(0.95).toFixed(0)}ms min=${ms[0].toFixed(0)}ms ` +
      `per_sim=${((q(0.5) * 1000) / nSims).toFixed(1)}us`,
  );
}
