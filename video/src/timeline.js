// The film's clock, its world coordinates, and the camera path.
import { track, trackVec, spring, clamp, lerp, smooth } from "./motion.js";

export const PQ = window.PQ;
export const BEAT = 0.5;
export const DURATION = 45;

// Cue times in seconds, on the 120 BPM grid.
export const T = {
  goal: 2.0, // Caufield ties it
  crane: 3.5, // the camera leaves ice level
  lights: 3.75, // arenas light up
  quake: 5.5, // the shockwave leaves Montreal
  wide: 9.0,
  rank: 11.0, // columns line up
  home: 14.0, // columns go home, camera rises
  product: 15.0, // the map is the app
  card: 20.6, // Caufield's tremor row becomes his share card
  player: 24.6, // his name becomes his player page
  team: 28.6, // his team becomes its team page
  whatif: 32.1, // its next games go into the What-If Lab
  nights: 36.1, // every night, and the camera dives into October 16
  finale: 39.1, // back on the ice
  engrave: 39.9, // the last shockwave writes the name into the ice
  tagline: 41.7,
  url: 42.4,
  end: 45.0,
};

// World: one unit is 100 px of the 1920x1080 map stage, Y is up.
export const W = (x, y) => [(x - 960) / 100, (y - 540) / 100];
export const TEAMS = PQ.teams.map((t) => {
  const [x, z] = W(t.x, t.y);
  return { ...t, wx: x, wz: z, before: t.after - t.delta };
});
export const MTL = TEAMS.find((t) => t.abbrev === "MTL");
export const G = PQ.goal;

export const WAVE = { speed: 3.6, amp: 0.085, wavelength: 0.95, decay: 2.4 };
export const arrival = (team) => T.quake + Math.hypot(team.wx - MTL.wx, team.wz - MTL.wz) / WAVE.speed;
export const lightsOn = (team) => T.lights + Math.hypot(team.wx - MTL.wx, team.wz - MTL.wz) * 0.07;

// The ranking row floats over the ocean south of the continent.
export const RANKED = [...TEAMS].sort((a, b) => a.delta - b.delta); // biggest loss first, Montreal last
export const ROW = { x0: -7.0, x1: 7.0, z: 4.7, y: 1.5, scale: 0.5 };
export const rowX = (i) => lerp(ROW.x0, ROW.x1, i / 31);

// The product shot: top-down, the map region of the real app layout.
export const APP = { header: 56, title: 74, rail: 440, strip: 124, pxPerUnit: 96 };
const mapCenterPx = [(1920 - APP.rail) / 2, (APP.header + APP.title + 1080 - APP.strip) / 2];
export const TOP = (() => {
  const fov = 20;
  const d = 1080 / APP.pxPerUnit / (2 * Math.tan((fov * Math.PI) / 360));
  // Shift the camera so the continent's center lands in the middle of the map region.
  const cx = 0 + (960 - mapCenterPx[0]) / APP.pxPerUnit;
  const cz = 0.15 + (540 - mapCenterPx[1]) / APP.pxPerUnit;
  return { pos: [cx, d, cz + 0.004], target: [cx, 0, cz], fov };
})();

// Camera path: position, target, field of view. Critically damped, so
// nothing overshoots; the low w values give the long settle of a crane.
const M = [MTL.wx, MTL.wz];
export function camera(t) {
  const pos = trackVec(t, [
    [0, [M[0] - 2.6, 0.13, M[1] + 9.0]],
    [T.crane, [M[0] + 1.9, 3.9, M[1] + 6.2]],
    [T.quake + 0.4, [M[0] - 3.2, 2.3, M[1] + 5.0]],
    [T.wide, [0.6, 9.2, 10.0]],
    [T.rank, [0.0, 2.2, 19.5]],
    [T.home, TOP.pos],
    [T.card, [3.6, 7.2, 10.5]], // a slow drift behind the product pages
    [T.whatif, [-3.4, 6.4, 10.0]],
    [T.finale - 0.9, [0.0, 9.6, 10.6]],
    [T.engrave, [0.0, 8.7, 9.7]],
  ], 2.4);
  const target = trackVec(t, [
    [0, [M[0] - 2.6, 0.76, M[1]]], // looking up 4 degrees puts the horizon low
    [T.crane, [M[0] - 2.2, 0.0, M[1] + 0.4]],
    [T.quake + 0.4, [M[0] - 7.6, 0.0, M[1] + 0.9]],
    [T.wide, [0.0, 0.0, 0.7]],
    [T.rank, [0.0, 2.3, ROW.z]],
    [T.home, TOP.target],
    [T.card, [0.6, 0.0, 0.4]],
    [T.whatif, [-0.6, 0.0, 0.2]],
    [T.finale - 0.9, [0.0, 0.0, 1.05]],
    [T.engrave, [0.0, 0.0, 1.0]],
  ], 2.4);
  const fov = track(t, [[0, 30], [T.crane, 40], [T.wide, 40], [T.rank, 33], [T.home, TOP.fov],
    [T.card, 36], [T.finale - 0.9, 30]], 2.4);
  return { pos, target, fov };
}

/** Where each team's column is, how tall, and how it looks, at time t. */
export function teamState(team, t) {
  const at = arrival(team);
  const hitK = spring(t - at, 7, 0.85); // a small, physical jolt
  let odds = lerp(team.before, team.after, hitK);
  // In the product view the rings follow the replayed night: each one takes
  // the odds after a goal when that goal's wave reaches it, easing over 0.6 s.
  if (t > T.home) {
    let nightP = 0;
    for (let i = 0; i < 6; i++) nightP += nightOdds(team, t - i * 0.1) / 6;
    odds = lerp(odds, nightP, spring(t - T.home - 0.3, 4, 1));
  }
  const rank = RANKED.indexOf(team);
  const go = spring(t - T.rank - rank * 0.018, 5.5, 1);
  const back = spring(t - T.home - (31 - rank) * 0.01, 5.5, 1);
  const away = clamp(go - back, 0, 1);
  // Column height: odds on the map, the change itself in the ranking.
  const oddsH = 0.06 + odds * 1.5;
  const deltaH = team.delta * 100 * ROW.scale;
  const lit = smooth(clamp((t - lightsOn(team)) / 0.5));
  const sink = 1 - smooth(clamp((t - T.home - 0.5) / 0.6)); // columns retract for the product view
  const gone = 1 - smooth(clamp((t - T.nights - 0.4) / 0.8)); // arenas dim before the finale
  return {
    hit: t - at,
    odds,
    lit: lit * gone,
    away,
    x: lerp(team.wx, rowX(rank), away),
    z: lerp(team.wz, ROW.z, away),
    y: lerp(0, ROW.y, away),
    h: lerp(oddsH, deltaH, away) * lit * Math.max(sink, away),
    up: lerp(1, Math.sign(team.delta) || 1, away),
  };
}

// The product shot replays the night: game seconds 7,900 to 9,000 (the
// late rush, ending on Caufield) run across film seconds 15.4 to 19.4.
export const NIGHT = { t0: 15.4, t1: 19.4, tau0: 7900, tau1: 9000 };
export const nightTau = (t) =>
  NIGHT.tau0 + ((t - NIGHT.t0) / (NIGHT.t1 - NIGHT.t0)) * (NIGHT.tau1 - NIGHT.tau0);
export const filmTime = (tau) =>
  NIGHT.t0 + ((tau - NIGHT.tau0) / (NIGHT.tau1 - NIGHT.tau0)) * (NIGHT.t1 - NIGHT.t0);

const BY_ABBREV = Object.fromEntries(TEAMS.map((t) => [t.abbrev, t]));
// Every shockwave in the film: the goal itself, then the night's big ones.
export const WAVES = [
  { team: MTL, t0: T.quake, amp: 1, magnitude: G.magnitude, scorer: G.scorer, hero: true },
  ...PQ.night.tremors
    .filter((tr) => tr.t >= NIGHT.tau0 && tr.t <= NIGHT.tau1 && tr.magnitude >= 3.3)
    .map((tr) => ({
      team: BY_ABBREV[tr.home], // a tremor starts at the arena the game is in
      t0: filmTime(tr.t),
      amp: 0.45 * Math.pow(tr.magnitude / G.magnitude, 1.5),
      magnitude: tr.magnitude,
      scorer: tr.scorer,
      scorerTeam: tr.team,
      tremor: tr,
    })),
  // The last one crosses the empty ice and engraves the name.
  { team: { wx: -6.9, wz: 0.25 }, t0: T.engrave, amp: 0.55, magnitude: 0, finale: true },
];

/** The night's playoff odds for a team at game second tau (from the replay). */
export function replayOdds(teamIndex, tau) {
  const o = PQ.night.odds;
  let p = o[0].p[teamIndex];
  for (const f of o) {
    if (f.t > tau) break;
    p = f.p[teamIndex];
  }
  return p;
}

/** The strongest shockwave passing a team right now: 0..1, and up or down. */
export function pulse(team, t) {
  const idx = TEAMS.indexOf(team);
  let best = { k: 0, up: true };
  for (const w of WAVES) {
    if (w.finale) continue;
    const at = w.t0 + Math.hypot(team.wx - w.team.wx, team.wz - w.team.wz) / WAVE.speed;
    const dt = t - at;
    if (dt < 0 || dt > 1.4) continue;
    const d = w.hero ? team.delta : replayOdds(idx, w.tremor.t + 0.5) - replayOdds(idx, w.tremor.t - 0.5);
    if (Math.abs(d) < 0.001) continue;
    const k = Math.exp(-dt * 2.6) * Math.min(1, 0.35 + Math.abs(d) * 100 * 0.4);
    if (k > best.k) best = { k, up: d > 0 };
  }
  return best;
}

function nightOdds(team, t) {
  const idx = TEAMS.indexOf(team);
  let p = replayOdds(idx, NIGHT.tau0);
  for (const w of WAVES) {
    if (w.hero || w.finale) continue;
    if (t >= w.t0 + Math.hypot(team.wx - w.team.wx, team.wz - w.team.wz) / WAVE.speed) p = replayOdds(idx, w.tremor.t + 0.5);
  }
  return p;
}
