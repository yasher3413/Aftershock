// Typography and small drawing helpers for the 2D layer.
import { clamp, expoOut, expoIn, life } from "./motion.js";

export const C = {
  ice: "#0D1822", land: "#16242F", scratch: "#233543", ink: "#E3EBF0",
  soft: "#8EA2B0", goal: "#FF4A57", blue: "#5AA2FF", deep: "#05090E", surface: "#111D27",
};
export const DISPLAY = '"Big Shoulders Display"';
export const TEXT = '"Overpass"';
export const MINUS = "−";
export const font = (size, weight = 700, family = DISPLAY) => `${weight} ${size}px ${family}`;
export const pp = (d, digits = 1) => (d > 0 ? "+" : d < 0 ? MINUS : "") + Math.abs(d * 100).toFixed(digits);
export const pct = (p, digits = 1) => (p * 100).toFixed(digits) + "%";

/**
 * Masked type: the line rises into view from behind its own baseline and
 * leaves upward the same way. Type moves as one designed object.
 */
export function mask(ctx, str, x, y, o) {
  const { size = 40, weight = 700, family = DISPLAY, color = C.ink, align = "left", t, t0, t1 = Infinity,
    inDur = 0.6, outDur = 0.35, tracking = 0, alpha = 1 } = o;
  const i = expoOut(clamp((t - t0) / inDur));
  const out = t1 === Infinity ? 0 : expoIn(clamp((t - t1) / outDur));
  if (i <= 0.001 || out >= 0.999) return;
  ctx.save();
  ctx.font = font(size, weight, family);
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.letterSpacing = tracking + "px";
  const w = ctx.measureText(str).width;
  const x0 = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
  ctx.beginPath();
  ctx.rect(x0 - size, y - size * 1.08, w + size * 2, size * 1.42);
  ctx.clip();
  ctx.globalAlpha *= alpha * (0.35 + 0.65 * i) * (1 - out * 0.5);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y + (1 - i) * size * 1.15 - out * size * 1.15);
  ctx.restore();
}

/** Plain fade-and-rise text for small labels. */
export function label(ctx, str, x, y, o) {
  const { size = 20, weight = 600, family = TEXT, color = C.soft, align = "left", base = "alphabetic",
    t, t0 = -9, t1 = Infinity, rise = 10, alpha = 1 } = o;
  const L = life(t, t0, t1, 0.45, 0.3);
  if (L.v <= 0.002) return;
  ctx.save();
  ctx.font = font(size, weight, family);
  ctx.textAlign = align;
  ctx.textBaseline = base;
  ctx.globalAlpha *= L.v * alpha;
  ctx.fillStyle = color;
  ctx.fillText(str, x, y + rise * (1 - L.i) - rise * L.o);
  ctx.restore();
}

export function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function tri(ctx, x, y, s, up, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  if (up) { ctx.moveTo(x, y - s); ctx.lineTo(x + s, y + s * 0.75); ctx.lineTo(x - s, y + s * 0.75); }
  else { ctx.moveTo(x, y + s); ctx.lineTo(x + s, y - s * 0.75); ctx.lineTo(x - s, y - s * 0.75); }
  ctx.fill();
}

export function mix(a, b, k) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const m = (s) => Math.round(((pa >> s) & 255) + (((pb >> s) & 255) - ((pa >> s) & 255)) * clamp(k));
  return `rgb(${m(16)},${m(8)},${m(0)})`;
}

export const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
export const ordinal = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : "OT");
