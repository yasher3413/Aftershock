// The 2D layer over the 3D world: the cold open, the labels that ride on
// the map, the ranking, and the wordmark.
import { clamp, lerp, smooth, spring, expoOut, expoIn, life, shake } from "./motion.js";
import { T, G, MTL, TEAMS, RANKED, ROW, rowX, WAVES, teamState } from "./timeline.js";
import { C, DISPLAY, TEXT, MINUS, font, mask, label, pp, pct, roundRect, tri, mix } from "./type.js";
import { goalTrace } from "./trace.js";

// ---------------------------------------------------------------- cold open

const EYE = 0.13;
const PAPER = 1.9; // world units of paper per second

/** The trace lying on the ice through Montreal, seen edge-on it is a seismograph. */
export function drawGoalTrace(ctx, t, project) {
  const fade = 1 - smooth(clamp((t - T.crane - 0.1) / 1.0));
  if (fade <= 0) return;
  const amp = 1 - smooth(clamp((t - T.crane) / 0.6));
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  let first = true;
  const x1 = MTL.wx, x0 = MTL.wx - 16;
  for (let x = x0; x <= x1; x += 0.012) {
    const u = t - (x1 - x) / PAPER;
    const p = project(x, EYE + goalTrace(u) * amp, MTL.wz);
    if (!p) continue;
    if (first) { ctx.moveTo(p[0], p[1]); first = false; } else ctx.lineTo(p[0], p[1]);
  }
  const a = project(x0 + 6, EYE, MTL.wz), b = project(x1, EYE, MTL.wz);
  const g = ctx.createLinearGradient(a ? a[0] : 0, 0, b ? b[0] : 1920, 0);
  g.addColorStop(0, "rgba(227,235,240,0)");
  g.addColorStop(1, "rgba(227,235,240,1)");
  ctx.strokeStyle = g;
  ctx.globalAlpha = fade;
  ctx.lineWidth = 2.6;
  ctx.stroke();
  // The pen: it sits on the Bell Centre.
  const pen = project(x1, EYE + goalTrace(t) * amp, MTL.wz);
  if (pen) {
    ctx.fillStyle = C.goal;
    ctx.shadowColor = C.goal;
    ctx.shadowBlur = 22;
    ctx.beginPath();
    ctx.arc(pen[0], pen[1], 6.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawColdOpen(ctx, t) {
  const out = T.crane - 0.25;
  if (t > out + 0.5) return;
  const cx = 960;
  const sh = shake(t, T.goal, 14, 0.5);
  ctx.save();
  ctx.translate(sh[0], sh[1]);
  label(ctx, "Centre Bell, Montreal", 120, 112, { t, t0: 0.1, t1: out, size: 27, weight: 700, color: C.ink });
  label(ctx, "October 16, 2025", 120, 150, { t, t0: 0.2, t1: out, size: 25, weight: 400 });

  // Score.
  const yS = 548;
  mask(ctx, G.away, cx - 236, yS - 34, { t, t0: 0.35, t1: out, size: 88, weight: 700, color: C.soft, align: "right" });
  mask(ctx, G.home, cx + 236, yS - 34, { t, t0: 0.45, t1: out, size: 88, weight: 700, color: C.soft });
  mask(ctx, String(G.before.away), cx - 112, yS, { t, t0: 0.3, t1: out, size: 236, weight: 800, align: "center" });
  // Montreal's digit rolls from 1 to 2 on the goal, inside its own mask.
  const i = expoOut(clamp((t - 0.4) / 0.6)), o = expoIn(clamp((t - out) / 0.35));
  if (i > 0 && o < 1) {
    const roll = spring(t - T.goal, 15, 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx + 20, yS - 236 * 1.08, 190, 236 * 1.42);
    ctx.clip();
    ctx.font = font(236, 800);
    ctx.textAlign = "center";
    const off = (1 - i) * 270 - o * 270;
    ctx.fillStyle = C.ink;
    ctx.fillText(String(G.before.home), cx + 112, yS + off - 300 * roll);
    ctx.fillStyle = mix(C.ink, C.blue, clamp(spring(t - T.goal, 6, 1)));
    ctx.fillText(String(G.after.home), cx + 112, yS + off + 300 * (1 - roll));
    ctx.restore();
  }
  // The divider.
  const d = life(t, 0.35, out);
  ctx.fillStyle = C.scratch;
  ctx.globalAlpha = d.v;
  ctx.fillRect(cx - 1.5, yS - 168 * d.i, 3, 160 * d.i);
  ctx.globalAlpha = 1;

  // Below the horizon: the clock and the win chance, reflected in the ice's calm.
  const yc = 800;
  const clk = t < 1 ? "0:22" : t < 1.5 ? "0:21" : "0:20";
  mask(ctx, "3rd", cx - 14, yc, { t, t0: 0.6, t1: out, size: 48, weight: 600, color: C.soft, align: "right" });
  mask(ctx, clk, cx + 14, yc, { t, t0: 0.65, t1: out, size: 48, weight: 700 });
  const dot = life(t, 0.7, out);
  ctx.globalAlpha = dot.v * (0.5 + 0.5 * Math.cos(t * Math.PI * 4));
  ctx.fillStyle = C.goal;
  ctx.beginPath();
  ctx.arc(cx - 100, yc - 16, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  const wk = spring(t - T.goal - 0.25, 4.5, 1);
  label(ctx, "Montreal win chance", cx - 14, 862, { t, t0: 0.9, t1: out, size: 24, weight: 600, align: "right" });
  mask(ctx, pct(lerp(G.homeWinBefore, G.homeWinAfter, wk)), cx + 14, 868, { t, t0: 0.95, t1: out, size: 46, weight: 800, color: mix(C.ink, C.blue, wk) });

  // The scorer.
  const gl = life(t, T.goal + 0.35, out);
  if (gl.v > 0) {
    ctx.save();
    ctx.globalAlpha = gl.v;
    roundRect(ctx, 120, 934 + 12 * (1 - gl.i), 104, 40, 6);
    ctx.fillStyle = C.goal;
    ctx.fill();
    ctx.font = font(28, 800);
    ctx.letterSpacing = "2px";
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.fillText("GOAL", 172, 964 + 12 * (1 - gl.i));
    ctx.restore();
  }
  mask(ctx, G.scorer, 244, 972, { t, t0: T.goal + 0.42, t1: out, size: 62, weight: 800 });
  label(ctx, `Ties it with 20 seconds left. Assist: ${G.assists.join(", ")}.`, 122, 1018, { t, t0: T.goal + 0.6, t1: out, size: 25, weight: 400 });
  ctx.restore();
}

/** The goal lamp: a rotating red bloom from above. */
export function drawLamp(ctx, t) {
  const k = t - T.goal;
  if (k < 0 || k > 2.4) return;
  const env = Math.exp(-k * 1.7) * Math.min(1, k * 30);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 2; i++) {
    const a = k * 5 + i * Math.PI;
    const x = 960 + Math.cos(a) * 700, y = -140 + Math.sin(a) * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 1100);
    g.addColorStop(0, `rgba(255,74,87,${0.36 * env})`);
    g.addColorStop(0.5, `rgba(200,16,46,${0.12 * env})`);
    g.addColorStop(1, "rgba(200,16,46,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1920, 1080);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- the quake

const MOVERS = TEAMS.filter((tm) => Math.abs(tm.delta) >= 0.0025).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

export function drawQuakeLabels(ctx, t, project) {
  if (t < T.quake || t > T.rank + 0.5) return;
  const out = T.rank - 0.3;
  // Magnitude at the origin.
  const o = project(MTL.wx, 0, MTL.wz);
  const mv = life(t, T.quake + 0.05, out, 0.5, 0.3);
  if (o && mv.v > 0) {
    const m = G.magnitude * clamp(spring(t - T.quake, 4.2, 1));
    ctx.save();
    ctx.globalAlpha = mv.v;
    ctx.textAlign = "left";
    ctx.font = font(24, 700, TEXT);
    ctx.fillStyle = C.goal;
    const x = o[0] + 44, y = o[1] - 150 + 20 * (1 - mv.i);
    ctx.fillText("MAGNITUDE", x + 4, y - 108);
    ctx.font = font(124, 900);
    ctx.fillStyle = C.ink;
    ctx.shadowColor = "rgba(255,74,87,0.7)";
    ctx.shadowBlur = 40 * Math.exp(-(t - T.quake) * 1.4);
    ctx.fillText(m.toFixed(1), x, y);
    ctx.restore();
  }
  // Change labels at the column tips, skipped rather than stacked.
  const placed = [];
  for (const tm of MOVERS) {
    const s = teamState(tm, t);
    if (s.hit < 0.05) continue;
    const big = tm.abbrev === "MTL";
    const tip = project(s.x, 0.04 + s.y + s.h, s.z);
    if (!tip) continue;
    const size = big ? 46 : 27;
    const str = pp(tm.delta);
    ctx.font = font(size, 800);
    const w = ctx.measureText(str).width + (big ? 30 : 18);
    const x = tip[0], y = tip[1] - (big ? 34 : 22);
    const box = [x - w / 2 - 6, y - size, x + w / 2 + 6, y + 8];
    if (x < 40 || x > 1880 || y < 60 || y > 1040) continue;
    if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    placed.push(box);
    const lv = life(t, t - s.hit + 0.05, out, 0.4, 0.3); // t - s.hit is the arrival time
    if (lv.v <= 0) continue;
    const up = tm.delta > 0, col = up ? C.blue : C.goal;
    ctx.save();
    ctx.globalAlpha = lv.v;
    const yy = y + 12 * (1 - lv.i);
    tri(ctx, x - w / 2 + (big ? 11 : 7), yy - size * 0.36, big ? 9 : 6, up, col);
    ctx.font = font(size, 800);
    ctx.textAlign = "left";
    ctx.fillStyle = col;
    ctx.fillText(str, x - w / 2 + (big ? 26 : 16), yy);
    if (big) {
      ctx.font = font(19, 600, TEXT);
      ctx.fillStyle = C.soft;
      ctx.fillText("playoff odds, pp", x - w / 2 + 28, yy + 26);
    }
    ctx.restore();
  }
  mask(ctx, "Every team felt it.", 120, 930, { t, t0: T.wide + 0.35, t1: out, size: 76, weight: 800 });
  label(ctx, "All 32 teams' playoff odds, rerun the moment the goal went in.", 123, 978, { t, t0: T.wide + 0.6, t1: out, size: 26, weight: 400 });
}

// ---------------------------------------------------------------- the ranking

export function drawRankLabels(ctx, t, project) {
  if (t < T.rank || t > T.home + 0.6) return;
  const out = T.home - 0.2;
  for (let i = 0; i < 32; i++) {
    const tm = RANKED[i];
    const s = teamState(tm, t);
    if (s.away < 0.6) continue;
    const base = project(s.x, 0.04 + s.y, s.z);
    const tip = project(s.x, 0.04 + s.y + s.h, s.z);
    if (!base || !tip) continue;
    const lv = life(t, T.rank + 0.7 + i * 0.02, out, 0.4, 0.25);
    if (lv.v <= 0) continue;
    const up = tm.delta >= 0;
    const big = tm.abbrev === "MTL" || tm.abbrev === "NSH";
    const tiny = Math.abs(tm.delta) < 0.001;
    ctx.save();
    ctx.globalAlpha = lv.v;
    ctx.textAlign = "center";
    // Value at the tip.
    ctx.font = font(big ? 38 : 20, 800);
    ctx.fillStyle = tiny ? C.soft : up ? C.blue : C.goal;
    const str = tiny && tm.delta !== 0 ? pp(tm.delta, 2) : pp(tm.delta);
    ctx.fillText(str, tip[0], up ? tip[1] - 14 : tip[1] + (big ? 44 : 26));
    // Team code on the other side of the baseline.
    ctx.font = font(17, 700);
    ctx.fillStyle = C.soft;
    ctx.fillText(tm.abbrev, base[0], up ? base[1] + 26 : base[1] - 12);
    ctx.restore();
  }
  mask(ctx, "Who it moved", 120, 180, { t, t0: T.rank + 0.5, t1: out, size: 84, weight: 800 });
  label(ctx, "Change in playoff odds from one goal, in percentage points.", 123, 226, { t, t0: T.rank + 0.7, t1: out, size: 26, weight: 400 });
  label(ctx, "20,000 seasons simulated after every goal, in about 120 ms.", 960, 1000, { t, t0: T.rank + 1.2, t1: out, size: 24, weight: 600, align: "center" });
}

// ---------------------------------------------------------------- the finale

/** Under the name the shockwave engraved: the line, and where to find it. */
export function drawFinale(ctx, t) {
  if (t < T.tagline - 0.2) return;
  mask(ctx, "Every goal in the NHL is an earthquake.", 960, 790, { t, t0: T.tagline, size: 54, weight: 800, align: "center" });
  const u = life(t, T.url, Infinity, 0.6);
  if (u.v <= 0) return;
  ctx.save();
  ctx.globalAlpha = u.v;
  ctx.font = font(34, 700, TEXT);
  ctx.textAlign = "center";
  const w = ctx.measureText("puckquake.com").width;
  const y = 852 + 10 * (1 - u.i);
  ctx.fillStyle = C.ink;
  ctx.fillText("puckquake.com", 960 + 12, y);
  ctx.fillStyle = C.goal;
  ctx.shadowColor = C.goal;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.arc(960 - w / 2 - 8, y - 11, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
