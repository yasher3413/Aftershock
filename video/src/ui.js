// The product: Puckquake's home page in its dark theme, rebuilt from the
// web app's layout, replaying the night of October 16, 2025.
import { clamp, lerp, smooth, spring, expoOut, expoIn, life } from "./motion.js";
import { T, PQ, APP, WAVES, NIGHT, nightTau, filmTime } from "./timeline.js";
import { C, DISPLAY, TEXT, font, label, roundRect, mix, clock, ordinal } from "./type.js";
import { nightTrace, NIGHT_LEN } from "./trace.js";

const N = PQ.night;
const RAIL_X = 1920 - APP.rail;
const TOP = APP.header + APP.title;
const STRIP_Y = 1080 - APP.strip;

// The game list in the order the rail shows it: by start time.
const GAMES = [...N.games].sort((a, b) => a.start.localeCompare(b.start) || a.id - b.id);

function gameAt(id, tau) {
  let g = null;
  for (const u of N.updates) {
    if (u.t > tau) break;
    if (u.id === id) g = u;
  }
  return g;
}
function statusOf(u, game) {
  if (!u || u.state === "FUT" || u.state === "PRE") {
    const d = new Date(game.start);
    const h = ((d.getUTCHours() + 20) % 24) % 12 || 12; // Eastern time in October
    return { text: `${h}:${String(d.getUTCMinutes()).padStart(2, "0")} PM`, live: false };
  }
  if (u.state === "OFF" || u.state === "FINAL") return { text: game.end ? `Final/${game.end}` : "Final", live: false };
  if (u.inter) return { text: `${ordinal(u.period)} int`, live: true };
  return { text: `${ordinal(u.period)} ${clock(u.clock)}`, live: true };
}

// Chrome timing: in after the camera arrives overhead, out at the payoff.
const IN = T.product, OUT = T.payoff;
const slide = (t, t0) => expoOut(clamp((t - t0) / 0.7)) * (1 - expoIn(clamp((t - OUT - (t0 - IN) * 0.5) / 0.45)));

export function drawProduct(ctx, t, project) {
  if (t < IN - 0.1) return;
  const tau = clamp(nightTau(t), NIGHT.tau0, NIGHT.tau1);
  if (t > OUT + 1.2) return drawNightTrace(ctx, t, tau, 0); // the trace stays to the end
  drawMapLabels(ctx, t, project);
  drawStrip(ctx, t, tau);
  drawRail(ctx, t, tau);
  drawTitle(ctx, t);
  drawHeader(ctx, t);
}

function drawHeader(ctx, t) {
  const k = slide(t, IN);
  if (k <= 0) return;
  ctx.save();
  ctx.translate(0, -APP.header * (1 - k));
  ctx.globalAlpha = k;
  ctx.fillStyle = C.ice;
  ctx.fillRect(0, 0, 1920, APP.header);
  ctx.fillStyle = C.scratch;
  ctx.fillRect(0, APP.header - 1, 1920, 1);
  ctx.font = font(30, 700);
  ctx.fillStyle = C.ink;
  ctx.textBaseline = "middle";
  ctx.fillText("Puckquake", 24, APP.header / 2 + 2);
  ctx.font = font(15, 400, TEXT);
  ctx.fillStyle = C.soft;
  ctx.textAlign = "right";
  let x = 1896;
  for (const item of ["How it works", "What if", "Leaders", "Nights", "Tonight"]) {
    ctx.fillStyle = item === "Tonight" ? C.ink : C.soft;
    ctx.fillText(item, x, APP.header / 2 + 2);
    x -= ctx.measureText(item).width + 30;
  }
  ctx.restore();
}

function drawTitle(ctx, t) {
  const k = slide(t, IN + 0.1);
  if (k <= 0) return;
  ctx.save();
  ctx.globalAlpha = k;
  ctx.translate(0, -20 * (1 - k));
  ctx.fillStyle = C.land;
  ctx.fillRect(0, APP.header, 1920, APP.title);
  ctx.fillStyle = C.scratch;
  ctx.fillRect(0, TOP - 1, 1920, 1);
  ctx.font = font(32, 700);
  ctx.fillStyle = C.ink;
  ctx.fillText("October 16, replayed", 24, APP.header + 38);
  const w = ctx.measureText("October 16, replayed").width;
  roundRect(ctx, 24 + w + 14, APP.header + 15, 60, 24, 5);
  ctx.strokeStyle = "rgba(227,235,240,0.6)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = font(13, 600, TEXT);
  ctx.fillStyle = "rgba(227,235,240,0.85)";
  ctx.textAlign = "center";
  ctx.fillText("Replay", 24 + w + 44, APP.header + 32);
  ctx.textAlign = "left";
  ctx.font = font(14, 400, TEXT);
  ctx.fillStyle = "rgba(227,235,240,0.8)";
  ctx.fillText("No games are on, so the map is replaying that night's goals.", 24, APP.header + 62);
  ctx.textAlign = "right";
  ctx.font = font(14, 600, TEXT);
  ctx.fillStyle = C.blue;
  ctx.fillText("How to read this", 1896, APP.header + 44);
  ctx.restore();
}

function drawRail(ctx, t, tau) {
  const k = slide(t, IN + 0.18);
  if (k <= 0) return;
  ctx.save();
  ctx.translate(APP.rail * 0.35 * (1 - k), 0);
  ctx.globalAlpha = k;
  ctx.fillStyle = C.ice;
  ctx.fillRect(RAIL_X, TOP, APP.rail, STRIP_Y - TOP);
  ctx.fillStyle = C.scratch;
  ctx.fillRect(RAIL_X, TOP, 1, STRIP_Y - TOP);
  const x0 = RAIL_X + 26, x1 = 1920 - 26;
  ctx.font = font(28, 700);
  ctx.fillStyle = C.ink;
  ctx.fillText("That night", x0, TOP + 44);
  // Games.
  GAMES.forEach((g, i) => {
    const y = TOP + 64 + i * 51;
    const rk = expoOut(clamp((t - IN - 0.3 - i * 0.03) / 0.5));
    if (rk <= 0) return;
    const u = gameAt(g.id, tau);
    const st = statusOf(u, g);
    const hs = u ? u.hs : 0, as = u ? u.as : 0;
    // A goal in the last moment of film time lights the scoring side.
    const recent = N.tremors.filter((tr) => tr.home === g.home && tr.t <= tau && t - filmTime(tr.t) < 0.9);
    const flash = recent.length ? 1 - (t - filmTime(recent[recent.length - 1].t)) / 0.9 : 0;
    const scorer = recent.length ? recent[recent.length - 1].team : null;
    ctx.save();
    ctx.globalAlpha *= rk;
    ctx.translate(16 * (1 - rk), 0);
    if (flash > 0) {
      ctx.fillStyle = `rgba(90,162,255,${0.10 * flash})`;
      ctx.fillRect(RAIL_X + 1, y - 4, APP.rail - 1, 46);
    }
    ctx.textBaseline = "alphabetic";
    const row = (abbrev, score, x) => {
      ctx.font = font(23, 700);
      ctx.fillStyle = C.ink;
      ctx.textAlign = "left";
      ctx.fillText(abbrev, x, y + 22);
      ctx.font = font(25, 800);
      ctx.textAlign = "right";
      ctx.fillStyle = scorer === abbrev && flash > 0 ? mix(C.ink, C.blue, flash) : C.ink;
      ctx.fillText(String(score), x + 84, y + 23);
    };
    row(g.away, as, x0);
    ctx.font = font(13, 400, TEXT);
    ctx.fillStyle = C.soft;
    ctx.textAlign = "center";
    ctx.fillText("at", x0 + 108, y + 20);
    row(g.home, hs, x0 + 132);
    ctx.textAlign = "right";
    ctx.font = font(14, 600, TEXT);
    ctx.fillStyle = st.live ? C.ink : C.soft;
    ctx.fillText(st.text, x1, y + 20);
    if (st.live) {
      ctx.fillStyle = C.goal;
      ctx.beginPath();
      ctx.arc(x1 - ctx.measureText(st.text).width - 10, y + 15, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Win chance bar: home share in ink.
    const wp = u && u.wp != null ? u.wp : 0.5;
    const by = y + 33, bw = x1 - x0;
    ctx.fillStyle = C.scratch;
    ctx.fillRect(x0, by, bw, 3);
    ctx.fillStyle = C.ink;
    ctx.fillRect(x0 + bw * (1 - wp), by, bw * wp, 3);
    ctx.restore();
  });
  // Tremors: the latest three.
  const ty = TOP + 64 + GAMES.length * 51 + 28;
  ctx.font = font(28, 700);
  ctx.fillStyle = C.ink;
  ctx.textAlign = "left";
  ctx.fillText("Tremors", x0, ty);
  const latest = N.tremors.filter((tr) => tr.t <= tau).slice(-3).reverse();
  latest.forEach((tr, i) => {
    const y = ty + 22 + i * 46;
    const age = t - filmTime(tr.t);
    const nk = i === 0 ? expoOut(clamp(age / 0.4)) : 1;
    ctx.save();
    ctx.globalAlpha *= nk;
    ctx.translate(0, -10 * (1 - nk));
    ctx.font = font(36, 800);
    ctx.fillStyle = C.ink;
    ctx.textAlign = "right";
    ctx.fillText(tr.magnitude.toFixed(1), x0 + 54, y + 32);
    ctx.textAlign = "left";
    ctx.font = font(16, 700, TEXT);
    ctx.fillText(tr.scorer, x0 + 70, y + 16);
    ctx.font = font(16, 400, TEXT);
    ctx.fillStyle = C.soft;
    ctx.fillText(` (${tr.team})`, x0 + 70 + ctx.measureText(tr.scorer).width + 2, y + 16);
    ctx.font = font(13, 400, TEXT);
    ctx.fillText(`${tr.away} ${tr.after.away}, ${tr.home} ${tr.after.home}, ${ordinal(tr.period)} ${clock(tr.clock)}`, x0 + 70, y + 36);
    ctx.restore();
  });
  ctx.restore();
}

// The seismograph strip: the whole night along the bottom, with a playhead.
const SX0 = 24, SX1 = 1896;
const stripX = (tau) => lerp(SX0, SX1, tau / NIGHT_LEN);

function drawStrip(ctx, t, tau) {
  const k = slide(t, IN + 0.25);
  const pay = spring(t - OUT, 3.6, 1);
  ctx.save();
  if (k > 0) {
    ctx.globalAlpha = k;
    ctx.translate(0, APP.strip * (1 - Math.min(1, k + pay)));
    ctx.fillStyle = C.ice;
    ctx.fillRect(0, STRIP_Y, 1920, APP.strip);
    ctx.fillStyle = C.scratch;
    ctx.fillRect(0, STRIP_Y, 1920, 1);
    // Hours, Eastern.
    ctx.font = font(13, 400, TEXT);
    ctx.fillStyle = C.soft;
    ctx.textAlign = "center";
    for (let h = 0; h <= 5; h++) {
      const x = stripX(h * 3600);
      ctx.fillText(h === 5 ? "12 AM" : `${7 + h} PM`, x + (h === 0 ? 18 : 0), 1068);
      ctx.fillStyle = "rgba(35,53,67,0.9)";
      ctx.fillRect(x, STRIP_Y + 10, 1, APP.strip - 36);
      ctx.fillStyle = C.soft;
    }
  }
  ctx.restore();
  drawNightTrace(ctx, t, tau, k);
}

/** The night's trace, which at the payoff lifts off the strip and becomes the line under the wordmark. */
function drawNightTrace(ctx, t, tau, k) {
  const pay = spring(t - OUT, 3.6, 1);
  const vis = Math.max(k, pay > 0.001 ? 1 : 0);
  if (vis <= 0) return;
  const yStrip = STRIP_Y + 54;
  const yMid = 652;
  const amp = lerp(46, 0, pay);
  const sEnd = lerp(tau / NIGHT_LEN, 1, pay);
  ctx.save();
  ctx.globalAlpha = vis;
  ctx.lineJoin = "round";
  ctx.beginPath();
  let pen = null;
  for (let s = 0; s <= sEnd + 1e-9; s += 0.0006) {
    const xs = stripX(s * NIGHT_LEN);
    const xm = lerp(360, 1560, s);
    const x = lerp(xs, xm, pay);
    // A new tremor lands with the wordmark.
    const u = t - (1 - s) * 3.2;
    const kk = u - T.word;
    const fresh = kk > 0 ? 70 * Math.exp(-kk * 2.6) * Math.sin(2 * Math.PI * 5.5 * kk) * Math.min(1, kk * 40) * pay : 0;
    const y = lerp(yStrip, yMid, pay) - nightTrace(s * NIGHT_LEN) * amp - fresh;
    if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    pen = [x, y];
  }
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = lerp(1.6, 2.6, pay);
  ctx.stroke();
  // Labels on the night's big tremors.
  if (pay < 0.5) {
    for (const w of WAVES) {
      if (w.hero || w.magnitude < 5 || w.tremor.t > tau) continue;
      const x = stripX(w.tremor.t);
      ctx.globalAlpha = vis * (1 - pay * 2) * clamp((t - w.t0) / 0.3);
      ctx.font = font(18, 800);
      ctx.fillStyle = w.scorer === PQ.goal.scorer ? C.goal : C.ink;
      ctx.textAlign = "center";
      ctx.fillText(w.magnitude.toFixed(1), x, STRIP_Y + 22);
    }
  }
  ctx.globalAlpha = vis;
  // Playhead, which becomes the pen.
  if (pen) {
    ctx.fillStyle = C.goal;
    ctx.shadowColor = C.goal;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(pen[0], pen[1], lerp(4, 6.5, pay), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (pay < 0.9) {
      ctx.globalAlpha = vis * (1 - pay);
      ctx.fillRect(pen[0] - 0.75, STRIP_Y + 8, 1.5, APP.strip - 30);
    }
  }
  ctx.restore();
}

/** Magnitude at each tremor's arena, as the app labels its origin. */
function drawMapLabels(ctx, t, project) {
  for (const w of WAVES) {
    if (w.hero) continue;
    const lv = life(t, w.t0, Math.min(w.t0 + 3, OUT - 0.2), 0.35, 0.4);
    if (lv.v <= 0) continue;
    const p = project(w.team.wx, 0, w.team.wz);
    if (!p) continue;
    const size = 17 + clamp((w.magnitude - 3) / 4) * 14;
    ctx.save();
    ctx.globalAlpha = lv.v;
    ctx.font = font(size, 800);
    ctx.fillStyle = C.ink;
    ctx.textAlign = "left";
    ctx.shadowColor = "rgba(5,9,14,0.9)";
    ctx.shadowBlur = 8;
    const yy = p[1] - 22 + 8 * (1 - lv.i);
    ctx.fillText(w.magnitude.toFixed(1), p[0] + 22, yy);
    ctx.font = font(13, 600, TEXT);
    ctx.fillStyle = C.soft;
    ctx.fillText(w.scorer, p[0] + 23, yy + 17);
    ctx.restore();
  }
}
