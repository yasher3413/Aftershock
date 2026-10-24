// Motion primitives. Everything is a pure function of time.

export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, k) => a + (b - a) * k;
export const smooth = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
/** Close to cubic-bezier(0.16, 1, 0.3, 1): fast out, long settle. */
export const expoOut = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));
export const expoIn = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : Math.pow(2, 10 * k - 10));
export const expoInOut = (k) =>
  k <= 0 ? 0 : k >= 1 ? 1 : k < 0.5 ? Math.pow(2, 20 * k - 10) / 2 : (2 - Math.pow(2, -20 * k + 10)) / 2;

/** Damped spring from 0 to 1, starting at dt = 0. z >= 1 never overshoots. */
export function spring(dt, w = 10, z = 1) {
  if (dt <= 0) return 0;
  if (z >= 0.999) return 1 - Math.exp(-w * dt) * (1 + w * dt);
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * dt) * (Math.cos(wd * dt) + ((z * w) / wd) * Math.sin(wd * dt));
}

/** A value whose target changes at keyed times: one spring per change, summed. */
export function track(t, keys, w = 6, z = 1) {
  let v = keys[0][1];
  for (let i = 1; i < keys.length; i++) v += (keys[i][1] - keys[i - 1][1]) * spring(t - keys[i][0], w, z);
  return v;
}
/** The same for vectors: keys are [time, [x, y, z]]. */
export function trackVec(t, keys, w = 6, z = 1) {
  return keys[0][1].map((_, i) => track(t, keys.map(([k, v]) => [k, v[i]]), w, z));
}

/** Visibility of something that enters at t0 and leaves at t1. */
export function life(t, t0, t1 = Infinity, inDur = 0.55, outDur = 0.32) {
  const i = expoOut(clamp((t - t0) / inDur));
  const o = t1 === Infinity ? 0 : expoIn(clamp((t - t1) / outDur));
  return { i, o, v: i * (1 - o) };
}

export function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function noise1(x) {
  const i = Math.floor(x), f = x - i;
  return lerp(hash(i) * 2 - 1, hash(i + 1) * 2 - 1, f * f * (3 - 2 * f));
}
export function shake(t, t0, amp, dur) {
  const k = t - t0;
  if (k < 0 || k > dur) return [0, 0];
  const e = amp * Math.pow(1 - k / dur, 2);
  return [noise1(k * 55) * e, noise1(k * 55 + 40) * e];
}
