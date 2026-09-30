/** Timing math for shockwaves. Pure functions so the schedule is testable. */

/** Seconds for a ring to cross the continent (the viewport diagonal). */
export const CROSSING_S = 2.5;
export const GAUGE_MS = 600;
export const LABEL_MS = 1400;
export const SHAKE_MS = 250;
export const SHAKE_MAGNITUDE = 6;
/** Changes smaller than this (0.1 percentage points) only shimmer. */
export const SHIMMER_BELOW = 0.001;

export function ringSpeed(width: number, height: number): number {
  return Math.hypot(width, height) / CROSSING_S; // px per second
}

export interface Target {
  id: string;
  x: number;
  y: number;
  delta: number;
}

export interface Arrival {
  id: string;
  /** Milliseconds after the tremor starts. */
  atMs: number;
  delta: number;
  kind: "gauge" | "shimmer";
}

/** When the ring front reaches each node. Reversal runs the clock backwards. */
export function schedule(
  origin: { x: number; y: number },
  targets: Target[],
  speed: number,
  reverse = false,
): Arrival[] {
  const dists = targets.map((t) => Math.hypot(t.x - origin.x, t.y - origin.y));
  const maxD = Math.max(1, ...dists);
  return targets
    .map((t, i) => {
      const d = reverse ? maxD - dists[i]! : dists[i]!;
      return {
        id: t.id,
        atMs: (d / speed) * 1000,
        delta: t.delta,
        kind: Math.abs(t.delta) < SHIMMER_BELOW ? ("shimmer" as const) : ("gauge" as const),
      };
    })
    .sort((a, b) => a.atMs - b.atMs);
}

/** Ring radius at time t (ms), and when the ring is done. */
export function ringRadius(tMs: number, speed: number, maxRadius: number, reverse = false): number {
  const r = (tMs / 1000) * speed;
  return reverse ? Math.max(0, maxRadius - r) : Math.min(r, maxRadius);
}

export function ringDurationMs(maxRadius: number, speed: number): number {
  return (maxRadius / speed) * 1000;
}

/** Ring stroke width and alpha from magnitude (0 to 10). */
export function ringStyle(magnitude: number): { width: number; alpha: number; rings: number } {
  const m = Math.max(0, Math.min(10, magnitude));
  return {
    width: 1.5 + m * 0.9,
    alpha: 0.35 + m * 0.06,
    rings: m >= 6 ? 3 : m >= 3 ? 2 : 1,
  };
}

export function shouldShake(magnitude: number, reducedMotion: boolean): boolean {
  return !reducedMotion && magnitude >= SHAKE_MAGNITUDE;
}

/** Deterministic decaying shake offset at t ms into the shake. */
export function shakeOffset(tMs: number, magnitude: number): { x: number; y: number } {
  if (tMs >= SHAKE_MS) return { x: 0, y: 0 };
  const amp = (1 - tMs / SHAKE_MS) * (2 + (magnitude - SHAKE_MAGNITUDE) * 1.5);
  return { x: Math.sin(tMs * 0.21) * amp, y: Math.cos(tMs * 0.17) * amp * 0.6 };
}

/** Ease out cubic, for gauge sweeps. */
export function easeOut(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1 - (1 - c) ** 3;
}
