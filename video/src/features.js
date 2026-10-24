// The product, up close: one panel that becomes, in turn, Caufield's share
// card, his player page, Montreal's team page, the What-If Lab, and the
// season's calendar of nights. Shared elements carry each cut.
import { clamp, lerp, smooth, spring, expoOut, expoIn, expoInOut, life, track } from "./motion.js";
import { T, PQ, G, BEAT } from "./timeline.js";
import { C, DISPLAY, TEXT, MINUS, font, mask, label, pp, pct, roundRect, mix, tri } from "./type.js";
import { TREMOR_ROW } from "./ui.js";

// The share card's light theme (services/aftershock/share/cards.py).
const L = { ice: "#EEF3F6", land: "#DDE7ED", scratch: "#C9D6DF", ink: "#14212B", soft: "#5D707E", goal: "#C8102E", blue: "#0B4FA8" };
const SURFACE = "#111D27";

// Panel geometry per state; one spring per change of target.
const R = TREMOR_ROW;
const STATES = [
  [0, { x: R.x, y: R.y, w: R.w, h: R.h, r: 8 }],
  [T.card, { x: 780, y: 272, w: 1020, h: 536, r: 18 }],
  [T.player, { x: 780, y: 170, w: 1020, h: 740, r: 26 }],
  [T.team, { x: 780, y: 190, w: 1020, h: 700, r: 26 }],
  [T.whatif, { x: 780, y: 200, w: 1020, h: 680, r: 30 }],
  [T.nights, { x: 700, y: 300, w: 1100, h: 476, r: 22 }],
];
function panel(t) {
  const k = (key) => track(t, STATES.map(([at, s]) => [at, s[key]]), 9, 1);
  return { x: k("x"), y: k("y"), w: k("w"), h: k("h"), r: k("r") };
}
// Content of each page enters after its container starts to move and
// leaves before the next morph, so text never overlaps.
const page = (t, t0, t1) => life(t, t0 + 0.2, t1 - 0.22, 0.5, 0.2);

export function drawFeatures(ctx, t) {
  if (t < T.card - 0.05 || t > T.finale + 0.3) return;
  // The world steps back behind the product.
  const dim = smooth(clamp((t - T.card) / 0.6)) * (1 - smooth(clamp((t - T.finale + 0.2) / 0.6)));
  ctx.fillStyle = `rgba(5,9,14,${0.66 * dim})`;
  ctx.fillRect(0, 0, 1920, 1080);

  const P = panel(t);
  const zoom = drawZoomPrep(t);
  ctx.save();
  if (zoom) applyZoom(ctx, zoom);
  // The panel: light while it is the share card, dark product surface otherwise.
  const light = smooth(clamp((t - T.card) / 0.25)) * (1 - smooth(clamp((t - T.player + 0.15) / 0.18)));
  const handoff = 1 - smooth(clamp((t - T.card) / 0.2));
  ctx.save();
  roundRect(ctx, P.x, P.y, P.w, P.h, P.r);
  ctx.fillStyle = mix(SURFACE, L.ice, light);
  if (handoff > 0) ctx.fillStyle = mix(C.ice, L.ice, 1 - handoff);
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 80;
  ctx.shadowOffsetY = 30;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = light > 0.5 ? "rgba(201,214,223,0.9)" : C.scratch;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.clip();
  drawCard(ctx, t, P);
  drawPlayer(ctx, t, P);
  drawTeam(ctx, t, P);
  drawWhatIf(ctx, t, P);
  drawNights(ctx, t, P);
  ctx.restore();
  drawShared(ctx, t, P);
  ctx.restore();
  drawCaptions(ctx, t);
}

// ---------------------------------------------------------------- captions

const CAPTIONS = [
  [T.card, ["Every goal", "gets a card."], "The magnitude, the scorer, and who it moved. Ready to share."],
  [T.player, ["Every player,", "scored by the race."], "PPA: the playoff odds his goals added, all season."],
  [T.team, ["Every team,", "every night."], "Its odds, and who to root for this week."],
  [T.whatif, ["What if they win", "the next three?"], "Pick results. The What-If Lab reruns 10,000 seasons in your browser."],
  [T.nights, ["Every night,", "replayable."], "Each square is a night of 2025-26, shaded by how hard it shook the race."],
];
function wrap(ctx, str, width) {
  const words = str.split(" ");
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? line + " " + w : w;
    if (ctx.measureText(next).width > width && line) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
function drawCaptions(ctx, t) {
  CAPTIONS.forEach(([t0, head, sub], i) => {
    const t1 = (CAPTIONS[i + 1]?.[0] ?? T.finale - 0.5) - 0.25;
    if (t < t0 || t > t1 + 0.6) return;
    head.forEach((line, j) => mask(ctx, line, 120, 420 + j * 78, { t, t0: t0 + 0.15 + j * 0.07, t1, size: 78, weight: 800 }));
    ctx.font = font(27, 400, TEXT);
    wrap(ctx, sub, 560).forEach((line, j) =>
      label(ctx, line, 123, 420 + head.length * 78 - 22 + j * 38, { t, t0: t0 + 0.4 + j * 0.05, t1, size: 27, weight: 400 }));
  });
}

// ---------------------------------------------------------------- shared elements

/** The magnitude and the name fly from the rail row to the card, then the name becomes the player page heading. */
function drawShared(ctx, t, P) {
  if (t > T.team + 0.6) return;
  const s = P.w / 1200; // the card is drawn at 1200 x 630 scale
  const k1 = expoOut(clamp((t - T.card) / 0.75));
  const k2 = expoOut(clamp((t - T.player) / 0.75));
  // Magnitude: rail (36 px, right-aligned) to card (150 px, red).
  if (t < T.player + 0.1) {
    const out = 1 - smooth(clamp((t - T.player + 0.2) / 0.25));
    const x = lerp(R.x + 16, P.x + 54 * s, k1);
    const y = lerp(R.y + 32, P.y + 228 * s, k1);
    const size = lerp(36, 150 * s, k1);
    ctx.save();
    ctx.globalAlpha = out;
    ctx.font = font(size, 800);
    ctx.fillStyle = mix(C.ink, L.goal, k1);
    ctx.textAlign = "left";
    ctx.fillText(G.magnitude.toFixed(1), x, y);
    ctx.restore();
  }
  // Name: rail (16 px) to card (56 px) to player heading (92 px, white).
  const xs = [R.x + 70, P.x + 60 * s, P.x + 56];
  const ys = [R.y + 16, P.y + 354 * s, P.y + 132];
  const sizes = [16, 56 * s, 96];
  const x = t < T.player ? lerp(xs[0], xs[1], k1) : lerp(xs[1], xs[2], k2);
  const y = t < T.player ? lerp(ys[0], ys[1], k1) : lerp(ys[1], ys[2], k2);
  const size = t < T.player ? lerp(sizes[0], sizes[1], k1) : lerp(sizes[1], sizes[2], k2);
  const family = k2 > 0.5 ? DISPLAY : TEXT;
  const weight = k2 > 0.5 ? 800 : t < T.card + 0.3 ? 700 : 600;
  const out = 1 - smooth(clamp((t - T.team + 0.25) / 0.25));
  ctx.save();
  ctx.globalAlpha = out;
  ctx.font = font(size, weight, family);
  ctx.fillStyle = t < T.player ? mix(C.ink, L.ink, k1) : mix(L.ink, C.ink, k2);
  ctx.fillText(G.scorer, x, y);
  ctx.restore();
}

// ---------------------------------------------------------------- the share card

function drawCard(ctx, t, P) {
  const v = page(t, T.card, T.player);
  if (v.v <= 0) return;
  const s = P.w / 1200;
  ctx.save();
  ctx.translate(P.x, P.y);
  ctx.scale(s, s);
  ctx.globalAlpha = v.v;
  const text = (str, x, y, size, o = {}) => {
    ctx.font = font(size, o.weight || 400, o.family || TEXT);
    ctx.fillStyle = o.fill || L.ink;
    ctx.textAlign = o.anchor === "end" ? "right" : "left";
    ctx.fillText(str, x, y);
  };
  text("October 16, 2025", 60, 88, 26, { fill: L.soft });
  text("Magnitude", 60, 268, 24, { fill: L.soft });
  text(`${G.away} ${G.after.away}, ${G.home} ${G.after.home}. Period ${G.period}, ${Math.floor(G.periodClock / 60)}:${String(G.periodClock % 60).padStart(2, "0")}.`, 60, 402, 30, { fill: L.soft });
  G.cardDeltas.forEach((d, i) => {
    const dv = clamp((t - T.card - 0.6 - i * 0.1) / 0.3);
    ctx.globalAlpha = v.v * dv;
    text(d.team, 60, 466 + i * 44, 38, { family: DISPLAY, weight: 800 });
    text(pp(d.d) + " pp", 163, 466 + i * 44, 32, { fill: d.d > 0 ? L.blue : L.goal });
  });
  ctx.globalAlpha = v.v;
  text("Puckquake", 1140, 88, 40, { family: DISPLAY, weight: 800, anchor: "end" });
  text("Data from NHL.com. Puckquake is not affiliated with or endorsed by the NHL.", 1140, 605, 15, { fill: L.soft, anchor: "end" });
  drawMiniMap(ctx, t, 560, 100, 600, 470);
  ctx.restore();
}

// The card's map: the land, the goal's rings, and every team as a dot.
let LAND_PATH = null;
function landPath() {
  if (LAND_PATH) return LAND_PATH;
  LAND_PATH = new Path2D();
  for (const r of PQ.land) {
    LAND_PATH.moveTo(r[0], r[1]);
    for (let i = 2; i < r.length; i += 2) LAND_PATH.lineTo(r[i], r[i + 1]);
    LAND_PATH.closePath();
  }
  return LAND_PATH;
}
function drawMiniMap(ctx, t, x, y, w, h) {
  // Fit the map stage's frame (the app's projection) into the box.
  const fx0 = 200, fx1 = 1720, fy0 = 130, fy1 = 990;
  const k = Math.min((w - 20) / (fx1 - fx0), (h - 20) / (fy1 - fy0));
  const ox = x + (w - (fx1 - fx0) * k) / 2 - fx0 * k, oy = y + (h - (fy1 - fy0) * k) / 2 - fy0 * k;
  const pt = (px, py) => [ox + px * k, oy + py * k];
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.save();
  ctx.setTransform(ctx.getTransform().multiply(new DOMMatrix([k, 0, 0, k, ox, oy])));
  ctx.fillStyle = L.land;
  ctx.fill(landPath());
  ctx.strokeStyle = L.scratch;
  ctx.lineWidth = 1 / k;
  ctx.stroke(landPath());
  ctx.restore();
  const mtl = PQ.teams.find((tm) => tm.abbrev === "MTL");
  const [cx, cy] = pt(mtl.x, mtl.y);
  const reach = Math.hypot(w, h) * 0.42;
  const grow = expoOut(clamp((t - T.card - 0.35) / 1.1));
  ctx.strokeStyle = L.goal;
  ctx.globalAlpha *= 1;
  const ga = ctx.globalAlpha;
  ctx.globalAlpha = ga * 0.55;
  ctx.lineWidth = 2 + G.magnitude * 0.6;
  ctx.beginPath();
  ctx.arc(cx, cy, reach * grow, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = ga * 0.3;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, reach * 0.72 * grow, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = ga * 0.85;
  ctx.fillStyle = L.goal;
  ctx.beginPath();
  ctx.arc(cx, cy, 9 + G.magnitude, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = ga;
  for (const tm of PQ.teams) {
    const [px, py] = pt(tm.x, tm.y);
    const dist = Math.hypot(px - cx, py - cy);
    const big = Math.abs(tm.delta) >= 0.001 && dist <= reach;
    const hit = big && dist <= reach * grow;
    ctx.fillStyle = hit ? (tm.delta > 0 ? L.blue : L.goal) : L.soft;
    ctx.beginPath();
    ctx.arc(px, py, hit ? 5.5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- the player page

const SEASON0 = Date.parse("2025-10-01"), SEASON1 = Date.parse("2026-06-15");
function drawPlayer(ctx, t, P) {
  const v = page(t, T.player, T.team);
  if (v.v <= 0) return;
  const pl = PQ.player, se = pl.season;
  ctx.save();
  ctx.translate(P.x, P.y);
  ctx.globalAlpha = v.v;
  label(ctx, "Montreal Canadiens, right wing, #22", 58, 182, { t, t0: T.player + 0.35, t1: T.team - 0.3, size: 26, weight: 400 });
  const stats = [
    ["Goals", String(Math.round(se.goals * clamp(spring(t - T.player - 0.45, 5, 1)))), C.ink],
    ["PPA", pp(se.ppa * clamp(spring(t - T.player - 0.5, 4, 1))), C.blue],
    ["Assist PPA", pp(se.assist_ppa * clamp(spring(t - T.player - 0.55, 4, 1))), C.blue],
    ["On-ice PPA", pp(se.on_ice_ppa * clamp(spring(t - T.player - 0.6, 4, 1))), C.blue],
  ];
  stats.forEach(([k, val, col], i) => {
    const x = 58 + i * 236;
    label(ctx, k + (i ? ", pp" : ""), x, 262, { t, t0: T.player + 0.45 + i * 0.05, t1: T.team - 0.3, size: 19, weight: 600 });
    mask(ctx, val, x, 330, { t, t0: T.player + 0.45 + i * 0.05, t1: T.team - 0.3, size: 62, weight: 800, color: col });
  });
  ctx.fillStyle = C.scratch;
  ctx.fillRect(58, 372, P.w - 116, 1);
  label(ctx, "Every goal of the season, by magnitude", 58, 420, { t, t0: T.player + 0.6, t1: T.team - 0.3, size: 21, weight: 700, color: C.ink });
  // The season as a seismogram.
  const base = 668, x0 = 58, x1 = P.w - 58;
  const best = pl.goals.reduce((a, b) => (b.magnitude > a.magnitude ? b : a));
  ctx.fillStyle = C.scratch;
  ctx.fillRect(x0, base, x1 - x0, 1);
  pl.goals.forEach((g, i) => {
    const x = lerp(x0, x1, (Date.parse(g.date) - SEASON0) / (SEASON1 - SEASON0)) + (i % 3) * 2;
    const k = spring(t - T.player - 0.7 - ((x - x0) / (x1 - x0)) * 1.1, 16, 0.6) * v.v;
    if (k <= 0) return;
    const h = g.magnitude * 30 * k;
    const isBest = g === best;
    ctx.globalAlpha = v.v * (isBest ? 1 : 0.9);
    ctx.strokeStyle = isBest ? C.ink : C.blue;
    ctx.lineWidth = isBest ? 3.5 : 2.4;
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.lineTo(x, base - h);
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(x, base - h, isBest ? 5.5 : 3, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = v.v;
  const bx = lerp(x0, x1, (Date.parse(best.date) - SEASON0) / (SEASON1 - SEASON0));
  label(ctx, `Oct 16 vs ${best.opponent}. Magnitude ${best.magnitude.toFixed(1)}`, bx + 16, base - best.magnitude * 30 + 6, { t, t0: T.player + 1.3, t1: T.team - 0.3, size: 19, weight: 700, color: C.ink });
  [["2025-10-01", "Oct"], ["2025-12-01", "Dec"], ["2026-02-01", "Feb"], ["2026-04-01", "Apr"], ["2026-06-01", "Jun"]].forEach(([d, m]) =>
    label(ctx, m, lerp(x0, x1, (Date.parse(d) - SEASON0) / (SEASON1 - SEASON0)), base + 30, { t, t0: T.player + 0.7, t1: T.team - 0.3, size: 17, weight: 600 }));
  ctx.restore();
}

// ---------------------------------------------------------------- the team page

function drawTeam(ctx, t, P) {
  const v = page(t, T.team, T.whatif);
  if (v.v <= 0) return;
  const M = PQ.mtl;
  ctx.save();
  ctx.translate(P.x, P.y);
  ctx.globalAlpha = v.v;
  // The odds ring.
  const cx = 214, cy = 262, r = 148;
  const p = M.playoffs * clamp(spring(t - T.team - 0.45, 4, 1));
  ctx.lineWidth = 24;
  ctx.strokeStyle = C.scratch;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = C.ink;
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
  ctx.stroke();
  ctx.font = font(84, 900);
  ctx.textAlign = "center";
  ctx.fillStyle = C.ink;
  ctx.fillText(pct(p), cx, cy + 28);
  ctx.font = font(19, 600, TEXT);
  ctx.fillStyle = C.soft;
  ctx.fillText("playoff odds", cx, cy + 62);
  ctx.fillStyle = M.color;
  ctx.fillRect(cx - 18, cy + r + 28, 36, 6);
  ctx.textAlign = "left";
  mask(ctx, M.name, 420, 142, { t, t0: T.team + 0.3, t1: T.whatif - 0.3, size: 74, weight: 800 });
  label(ctx, `${M.division} Division, ${M.conference} Conference`, 422, 184, { t, t0: T.team + 0.4, t1: T.whatif - 0.3, size: 22, weight: 400 });
  [["Division title", pct(M.pDivision)], ["Stanley Cup", pct(M.cup)], ["Projected points", String(Math.round(M.points))]].forEach(([k, val], i) => {
    const x = 422 + i * 190;
    label(ctx, k, x, 262, { t, t0: T.team + 0.5 + i * 0.05, t1: T.whatif - 0.3, size: 18, weight: 600 });
    mask(ctx, val, x, 322, { t, t0: T.team + 0.5 + i * 0.05, t1: T.whatif - 0.3, size: 54, weight: 800 });
  });
  ctx.fillStyle = C.scratch;
  ctx.fillRect(56, 470, P.w - 112, 1);
  mask(ctx, "Who to root for this week", 56, 532, { t, t0: T.team + 0.7, t1: T.whatif - 0.3, size: 34, weight: 700 });
  M.rooting.slice(0, 3).forEach((rw, i) => {
    const y = 586 + i * 40;
    const day = new Date(Date.parse(rw.start) - 4 * 3600e3).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
    const t0 = T.team + 0.85 + i * 0.08;
    ctx.save();
    const lv = life(t, t0, T.whatif - 0.3, 0.4, 0.25);
    ctx.globalAlpha *= lv.v;
    ctx.translate(0, 10 * (1 - lv.i));
    ctx.font = font(21, 400, TEXT);
    ctx.fillStyle = C.ink;
    ctx.fillText("Root for ", 56, y);
    let x = 56 + ctx.measureText("Root for ").width;
    ctx.font = font(21, 700, TEXT);
    ctx.fillText(rw.rootFor, x, y);
    x += ctx.measureText(rw.rootFor + " ").width;
    ctx.font = font(21, 400, TEXT);
    ctx.fillStyle = C.soft;
    ctx.fillText(`(${rw.away} at ${rw.home}, ${day})`, x, y);
    ctx.textAlign = "right";
    ctx.fillStyle = C.ink;
    ctx.fillText(pp(rw.impact) + " pp", P.w - 56, y);
    ctx.restore();
  });
  ctx.restore();
}

// ---------------------------------------------------------------- the What-If Lab

const CLICKS = [0, 1, 2].map((i) => T.whatif + 0.95 + i * BEAT * 1.4);
function drawWhatIf(ctx, t, P) {
  const v = page(t, T.whatif, T.nights);
  if (v.v <= 0) return;
  const W = PQ.whatif;
  ctx.save();
  ctx.translate(P.x, P.y);
  ctx.globalAlpha = v.v;
  mask(ctx, "What-If Lab", 56, 104, { t, t0: T.whatif + 0.3, t1: T.nights - 0.3, size: 62, weight: 800 });
  label(ctx, "Pick the results", 58, 168, { t, t0: T.whatif + 0.4, t1: T.nights - 0.3, size: 24, weight: 700, color: C.ink });
  // The forecast readout: each pick reruns the season, landing 0.4 s later
  // (about what the simulator takes).
  const keys = [[0, W[0].p_playoffs], ...CLICKS.map((c, i) => [c + 0.4, W[i + 1].p_playoffs])];
  const p = track(t, keys, 9, 1);
  label(ctx, "MTL playoff odds", P.w - 56, 62, { t, t0: T.whatif + 0.4, t1: T.nights - 0.3, size: 19, weight: 600, align: "right" });
  mask(ctx, pct(p), P.w - 56, 152, { t, t0: T.whatif + 0.4, t1: T.nights - 0.3, size: 104, weight: 900, align: "right", color: mix(C.ink, C.blue, clamp((p - W[0].p_playoffs) / 0.04)) });
  const dp = p - W[0].p_playoffs;
  if (dp > 0.0005) label(ctx, `${pp(dp)} pp from today`, P.w - 56, 190, { t, t0: CLICKS[0] + 0.4, t1: T.nights - 0.3, size: 20, weight: 700, color: C.blue, align: "right" });
  // Montreal's next three games.
  PQ.picks.forEach((g, i) => {
    const y = 230 + i * 118;
    const lv = life(t, T.whatif + 0.45 + i * 0.07, T.nights - 0.3, 0.45, 0.25);
    if (lv.v <= 0) return;
    const picked = spring(t - CLICKS[i] - 0.03, 18, 0.8);
    ctx.save();
    ctx.globalAlpha *= lv.v;
    ctx.translate(18 * (1 - lv.i), 0);
    roundRect(ctx, 56, y, P.w - 112, 96, 16);
    ctx.fillStyle = C.ice;
    ctx.fill();
    const date = new Date(g.date + "T16:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
    ctx.font = font(19, 600, TEXT);
    ctx.fillStyle = C.soft;
    ctx.textBaseline = "middle";
    ctx.fillText(date, 84, y + 48);
    [g.away, g.home].forEach((ab, j) => {
      const bx = 260 + j * 250, by = y + 18, bw = 190, bh = 60;
      const isM = ab === "MTL";
      roundRect(ctx, bx, by, bw, bh, 12);
      ctx.fillStyle = isM ? mix(C.land, C.blue, clamp(picked) * 0.85) : C.land;
      ctx.fill();
      ctx.strokeStyle = isM && picked > 0.5 ? C.blue : C.scratch;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.font = font(36, 800);
      ctx.textAlign = "center";
      ctx.fillStyle = C.ink;
      ctx.fillText(ab, bx + bw / 2, by + bh / 2 + 2);
      ctx.textAlign = "left";
    });
    ctx.font = font(19, 600, TEXT);
    ctx.fillStyle = C.soft;
    ctx.textAlign = "center";
    ctx.fillText("at", 260 + 190 + 30, y + 48);
    const mtlWin = g.home === "MTL" ? g.homeWin : 1 - g.homeWin;
    ctx.textAlign = "right";
    ctx.font = font(38, 800);
    ctx.fillStyle = C.ink;
    ctx.fillText(pct(mtlWin, 0), P.w - 84, y + 40);
    ctx.font = font(15, 600, TEXT);
    ctx.fillStyle = C.soft;
    ctx.fillText("MTL win chance", P.w - 84, y + 68);
    ctx.restore();
  });
  // Footer.
  const sp = life(t, CLICKS[0], T.nights - 0.3, 0.3, 0.25);
  if (sp.v > 0) {
    const y = P.h - 62;
    const busy = CLICKS.some((c) => t > c && t < c + 0.4);
    ctx.save();
    ctx.globalAlpha *= sp.v;
    ctx.strokeStyle = busy ? C.blue : C.soft;
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    const a = (t - CLICKS[0]) * 8;
    if (busy) ctx.arc(74, y, 11, a, a + 4.2);
    else ctx.arc(74, y, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    label(ctx, "10,000 seasons, rerun in your browser on every pick", 100, y + 8, { t, t0: CLICKS[0] + 0.1, t1: T.nights - 0.3, size: 21, weight: 600, color: C.ink });
  }
  drawCursor(ctx, t, P);
  ctx.restore();
}
function drawCursor(ctx, t, P) {
  const lv = life(t, T.whatif + 0.55, T.nights - 0.3, 0.4, 0.25);
  if (lv.v <= 0) return;
  const target = (i) => [260 + (PQ.picks[i].home === "MTL" ? 250 : 0) + 120, 230 + i * 118 + 58];
  const kx = [[0, P.w + 80], ...CLICKS.map((c, i) => [c - 0.3, target(i)[0]])];
  const ky = [[0, P.h + 60], ...CLICKS.map((c, i) => [c - 0.3, target(i)[1]])];
  const x = track(t, kx, 13, 1), y = track(t, ky, 13, 1);
  const press = CLICKS.reduce((m, c) => Math.max(m, Math.exp(-Math.pow((t - c) / 0.06, 2))), 0);
  ctx.save();
  ctx.globalAlpha *= lv.v;
  for (const c of CLICKS) {
    const k = t - c;
    if (k < 0 || k > 0.5) continue;
    ctx.strokeStyle = C.blue;
    ctx.lineWidth = 2;
    ctx.globalAlpha = lv.v * (1 - k / 0.5);
    ctx.beginPath();
    ctx.arc(track(c, kx, 13, 1), track(c, ky, 13, 1), 8 + 44 * expoOut(k / 0.5), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = lv.v;
  ctx.translate(x, y);
  ctx.scale(1 - press * 0.14, 1 - press * 0.14);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 38);
  ctx.lineTo(9.5, 29.5);
  ctx.lineTo(17, 45);
  ctx.lineTo(23.5, 42);
  ctx.lineTo(16, 27);
  ctx.lineTo(28.5, 27);
  ctx.closePath();
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 12;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#05090E";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- the nights

const NIGHTS = PQ.nights;
const NE = NIGHTS.map((n) => Math.log10(1 + n.energy));
const NMIN = Math.min(...NE), NMAX = Math.max(...NE);
const D0 = Date.parse(NIGHTS[0].date);
const DAY0 = new Date(D0).getUTCDay();
const CELL = 23, GAP = 5;
function cellOf(i) {
  const dd = Math.round((Date.parse(NIGHTS[i].date) - D0) / 86400000) + DAY0;
  return [Math.floor(dd / 7), dd % 7];
}
const COLS = cellOf(NIGHTS.length - 1)[0] + 1;
const OCT16 = NIGHTS.findIndex((n) => n.date === "2025-10-16");
function gridOrigin(P) {
  return [P.x + (P.w - COLS * (CELL + GAP)) / 2, P.y + 176];
}
function drawNights(ctx, t, P) {
  const v = page(t, T.nights, T.finale + 2);
  if (v.v <= 0) return;
  ctx.save();
  ctx.translate(P.x, P.y);
  mask(ctx, "Nights", 56, 96, { t, t0: T.nights + 0.3, t1: T.finale - 1.0, size: 60, weight: 800 });
  label(ctx, "2025-26, every night with games", 58, 132, { t, t0: T.nights + 0.4, t1: T.finale - 1.0, size: 20, weight: 400 });
  ctx.restore();
  const [gx, gy] = gridOrigin(P);
  const ga = ctx.globalAlpha;
  const months = new Map();
  NIGHTS.forEach((n, i) => {
    const [col, row] = cellOf(i);
    const x = gx + col * (CELL + GAP), y = gy + row * (CELL + GAP);
    const m = n.date.slice(0, 7);
    if (!months.has(m)) months.set(m, x);
    const k = clamp((t - T.nights - 0.35 - col * 0.012) / 0.25);
    if (k <= 0) return;
    const e = (NE[i] - NMIN) / (NMAX - NMIN);
    const s = CELL * expoOut(k);
    ctx.fillStyle = e > 0.78 ? mix(C.scratch, C.goal, (e - 0.55) / 0.45) : mix(C.scratch, C.ink, e * 0.85);
    ctx.globalAlpha = ga * v.v;
    roundRect(ctx, x + (CELL - s) / 2, y + (CELL - s) / 2, s, s, 4);
    ctx.fill();
    if (i === OCT16) {
      const hk = clamp((t - T.nights - 0.9) / 0.3);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = ga * v.v * hk * (0.65 + 0.35 * Math.cos((t - T.nights) * Math.PI * 4));
      roundRect(ctx, x - 3, y - 3, CELL + 6, CELL + 6, 6);
      ctx.stroke();
    }
  });
  ctx.globalAlpha = ga;
  const names = { "2025-10": "Oct", "2025-11": "Nov", "2025-12": "Dec", "2026-01": "Jan", "2026-02": "Feb", "2026-03": "Mar", "2026-04": "Apr", "2026-05": "May", "2026-06": "Jun" };
  for (const [m, x] of months) label(ctx, names[m] || "", x, gy - 14, { t, t0: T.nights + 0.4, t1: T.finale - 1.0, size: 17, weight: 600 });
  const [c16, r16] = cellOf(OCT16);
  // The night from the start of the film, called out under the grid.
  const cxl = gx + c16 * (CELL + GAP) + CELL / 2, cyb = gy + r16 * (CELL + GAP) + CELL + 4;
  const ll = clamp((t - T.nights - 1.0) / 0.35) * (1 - clamp((t - T.finale + 1.0) / 0.3));
  if (ll > 0) {
    ctx.save();
    ctx.globalAlpha = ga * ll;
    ctx.fillStyle = "#fff";
    ctx.fillRect(cxl - 0.75, cyb, 1.5, (7 - r16) * (CELL + GAP) + 8);
    ctx.restore();
  }
  label(ctx, "October 16", cxl - 6, gy + 7 * (CELL + GAP) + 34, { t, t0: T.nights + 1.05, t1: T.finale - 1.0, size: 19, weight: 700, color: C.ink });
  // Legend.
  const ly2 = gy + 7 * (CELL + GAP) + 80;
  label(ctx, "Quieter", gx, ly2 + 6, { t, t0: T.nights + 0.6, t1: T.finale - 1.0, size: 16, weight: 600 });
  for (let i = 0; i < 5; i++) {
    const e = i / 4;
    ctx.globalAlpha = ga * clamp((t - T.nights - 0.6) / 0.3) * (1 - clamp((t - T.finale + 1.0) / 0.3));
    ctx.fillStyle = e > 0.78 ? mix(C.scratch, C.goal, (e - 0.55) / 0.45) : mix(C.scratch, C.ink, e * 0.85);
    roundRect(ctx, gx + 70 + i * 22, ly2 - 9, 17, 17, 3);
    ctx.fill();
  }
  ctx.globalAlpha = ga;
  label(ctx, "Stronger", gx + 70 + 5 * 22 + 6, ly2 + 6, { t, t0: T.nights + 0.6, t1: T.finale - 1.0, size: 16, weight: 600 });
}

// The camera dives into October 16: the panel scales about that square
// until it fills the frame, and the frame becomes the ice.
function drawZoomPrep(t) {
  const k = expoInOut(clamp((t - (T.finale - 1.0)) / 1.1));
  if (k <= 0) return null;
  const P = panel(t);
  const [gx, gy] = gridOrigin(P);
  const [c16, r16] = cellOf(OCT16);
  const cx = gx + c16 * (CELL + GAP) + CELL / 2, cy = gy + r16 * (CELL + GAP) + CELL / 2;
  return { k, cx, cy };
}
function applyZoom(ctx, z) {
  const s = Math.pow(120, z.k);
  ctx.translate(960, 540);
  ctx.scale(s, s);
  const f = Math.min(1, z.k * 3);
  ctx.translate(-lerp(960, z.cx, f), -lerp(540, z.cy, f));
  ctx.globalAlpha = 1 - smooth(clamp((z.k - 0.88) / 0.12));
}
