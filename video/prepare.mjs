// Builds data.js for the demo video from the repo's own basemap, team list,
// and the API responses captured as end-to-end fixtures. Every number the
// video shows comes from here.
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { geoConicConformal, geoPath } from "d3-geo";
import { feature, mesh } from "topojson-client";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root));
const fixture = (name) => JSON.parse(gunzipSync(read(`web/e2e/fixtures/${name}.json.gz`)));

// The map is laid out once on a 1920x1080 stage, with the app's projection.
const W = 1920;
const H = 1080;
const FRAME = {
  type: "Feature",
  properties: {},
  geometry: {
    type: "MultiPoint",
    coordinates: [
      [-125.5, 49.5],
      [-114, 54.5],
      [-66.5, 46],
      [-80.5, 24.8],
      [-118, 32],
      [-97, 25.5],
    ],
  },
};
const proj = geoConicConformal().parallels([30, 55]).rotate([96, 0]).center([0, 40]);
proj.fitExtent(
  [
    [230, 150],
    [W - 230, H - 120],
  ],
  FRAME,
);

const topo = JSON.parse(read("web/public/geo/north-america.topo.json"));
const land = feature(topo, topo.objects.land);
const lakes = feature(topo, topo.objects.lakes);
const borders = mesh(topo, topo.objects.borders);

// Flatten projected geometry into rings of [x, y, x, y, ...] at 0.1 px.
function rings(geo) {
  const out = [];
  let cur = null;
  const ctx = {
    moveTo(x, y) {
      cur = [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
      out.push(cur);
    },
    lineTo(x, y) {
      cur.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
    },
    closePath() {},
    arc() {},
  };
  geoPath(proj, ctx)(geo);
  return out.filter((r) => r.length >= 6);
}

const teams = JSON.parse(read("config/teams.json")).teams;
const player = fixture("player-8481540");
const team = fixture("team-MTL");
const nights = fixture("nights-20252026");
const whatif = fixture("whatif");
const replay = fixture("replay");

// The video's goal: the biggest tremor in Cole Caufield's season.
const goal = player.goals.reduce((a, b) => ((b.magnitude ?? 0) > (a.magnitude ?? 0) ? b : a));
const deltas = Object.fromEntries(goal.deltas.map((d) => [d.team, d]));

const wpHome = (wp) => wp.home_reg + wp.home_ot + wp.home_so;

const data = {
  stage: { w: W, h: H },
  land: rings(land),
  lakes: rings(lakes),
  borders: rings(borders),
  teams: teams.map((t) => {
    const [x, y] = proj([t.lon, t.lat]);
    const d = deltas[t.abbrev];
    return {
      abbrev: t.abbrev,
      name: t.name,
      color: t.color_primary,
      conference: t.conference,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      after: d.p_playoffs_after,
      delta: d.d_playoffs,
    };
  }),
  goal: {
    date: goal.night_date,
    scorer: goal.scorer.name,
    assists: goal.assists.map((a) => a.name),
    goalie: goal.goalie.name,
    team: goal.team,
    opponent: goal.opponent,
    home: goal.home,
    away: goal.away,
    venue: goal.origin.venue,
    period: goal.period,
    periodClock: goal.t_period_s,
    before: goal.score_before,
    after: goal.score_after,
    magnitude: goal.magnitude,
    totalShift: goal.total_shift,
    ppa: goal.ppa,
    homeWinBefore: wpHome(goal.wp_before),
    homeWinAfter: wpHome(goal.wp_after),
  },
  player: {
    name: player.name,
    team: player.team,
    sweater: player.sweater,
    season: player.seasons[0],
    goals: player.goals.map((g) => ({
      date: g.night_date,
      magnitude: g.magnitude ?? 0,
      ppa: g.ppa ?? 0,
      opponent: g.opponent,
    })),
  },
  mtl: {
    name: team.team.name,
    playoffs: team.odds.p_playoffs,
    division: team.odds.p_division,
    cup: team.odds.p_cup,
    points: team.odds.exp_points,
    history: team.history.p_playoffs.map((h) => h.value),
  },
  // Montreal's next three games in the What-If Lab, with the model's odds.
  picks: whatif.games
    .filter((g) => g.status === "future" && (g.home === "MTL" || g.away === "MTL"))
    .slice(0, 3)
    .map((g) => ({
      date: g.start_utc.slice(0, 10),
      home: g.home,
      away: g.away,
      homeWin: g.probs[0] + g.probs[1] + g.probs[2],
    })),
  // The whole night of October 16, 2025, as the replay shows it.
  night: (() => {
    const games = new Map();
    const tremors = [];
    const updates = [];
    const odds = [];
    const order = teams.map((t) => t.abbrev);
    const wp = (w) => (w ? Math.round((w.home_reg + w.home_ot + w.home_so) * 1000) / 1000 : null);
    for (const f of replay.frames) {
      const m = f.message;
      if (m.type === "odds_update") {
        const by = Object.fromEntries(m.odds.map((o) => [o.team, o.p_playoffs]));
        odds.push({ t: f.t / 1000, p: order.map((ab) => by[ab]) });
      }
      if (m.type === "game_update") {
        const g = m.game;
        games.set(g.id, g);
        updates.push({ t: f.t / 1000, id: g.id, state: g.state, period: g.period, clock: g.clock_seconds,
          inter: g.in_intermission, hs: g.home_score, as: g.away_score, wp: wp(g.wp) ?? wp(g.pregame) });
      }
      if (m.type === "tremor") {
        const tr = m.tremor;
        tremors.push({
          t: f.t / 1000,
          team: tr.team,
          scorer: tr.scorer.name,
          magnitude: tr.magnitude ?? 0,
          home: tr.home,
          away: tr.away,
          after: tr.score_after,
          period: tr.period,
          clock: tr.t_period_s,
        });
      }
    }
    return {
      date: replay.night_date,
      durationS: replay.duration_ms / 1000,
      odds,
      updates,
      games: [...games.values()].map((g) => ({
        id: g.id,
        home: g.home,
        away: g.away,
        homeScore: g.home_score,
        awayScore: g.away_score,
        end: g.period > 3 ? (g.period_type === "SO" ? "SO" : "OT") : "",
        start: g.start_utc,
      })),
      tremors,
    };
  })(),
  nights: nights.map((n) => ({ date: n.night_date, energy: n.total_energy, tremors: n.n_tremors })),
};

writeFileSync(new URL("data.js", import.meta.url), `window.PQ = ${JSON.stringify(data)};\n`);
console.log(
  `data.js: ${data.land.length} land rings, ${data.teams.length} teams, goal M ${goal.magnitude.toFixed(1)} by ${goal.scorer.name}, ${data.nights.length} nights`,
);
