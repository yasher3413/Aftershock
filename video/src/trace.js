// The seismograph trace: the one object that runs through the whole film.
import { noise1, clamp, smooth } from "./motion.js";
import { T, PQ, NIGHT, nightTau } from "./timeline.js";

/** The goal's tremor, recorded on paper time u (seconds). */
export function goalTrace(u) {
  const nerves = 1 + 2.4 * smooth(clamp((u - 0.8) / 1.2)) * (u < T.goal ? 1 : 0);
  let y = (noise1(u * 13) * 0.022 + noise1(u * 41 + 7) * 0.011) * nerves;
  const k = u - T.goal;
  if (k > 0) y += 1.05 * Math.exp(-k * 3.0) * Math.sin(2 * Math.PI * 6.5 * k) * Math.min(1, k * 45);
  return y;
}

/** The night's trace: every tremor of October 16, by game second tau. */
const TREMORS = PQ.night.tremors;
export function nightTrace(tau, timeScale = 1) {
  let y = noise1(tau * 0.05) * 0.015 + noise1(tau * 0.31 + 3) * 0.01;
  for (const tr of TREMORS) {
    const k = (tau - tr.t) / timeScale;
    if (k < 0 || k > 900) continue;
    const a = Math.pow(tr.magnitude / 6.8, 1.6);
    y += a * Math.exp(-k / 110) * Math.sin(k / 18) * Math.min(1, k / 6);
  }
  return y;
}

export const NIGHT_LEN = PQ.night.durationS;
export { NIGHT, nightTau };
