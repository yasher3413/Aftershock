/** League energy over a night: the tremors' total shift, smoothed in time. */

export interface Spike {
  id: number;
  at: number; // epoch ms
  magnitude: number;
  shift: number;
}

export const KERNEL_MS = 4 * 60 * 1000;

/**
 * Energy sampled at `n` points between `from` and `to`: each tremor adds a
 * Gaussian bump of width KERNEL_MS scaled by its total shift. Only the past
 * is drawn (nothing after `now`).
 */
export function energyTrace(
  spikes: Spike[],
  from: number,
  to: number,
  now: number,
  n: number,
): { t: number; e: number }[] {
  const out: { t: number; e: number }[] = [];
  const step = (to - from) / Math.max(1, n - 1);
  for (let i = 0; i < n; i++) {
    const t = from + i * step;
    if (t > now) break;
    let e = 0;
    for (const s of spikes) {
      if (s.at > t) continue;
      const d = (t - s.at) / KERNEL_MS;
      if (d < 4) e += s.shift * Math.exp(-0.5 * d * d);
    }
    out.push({ t, e });
  }
  return out;
}

/** Time window for a night: from 15 minutes before first puck drop to the later of now or the last expected end. */
export function nightWindow(starts: number[], now: number): { from: number; to: number } {
  if (!starts.length) return { from: now - 3 * 3600_000, to: now + 15 * 60_000 };
  const first = Math.min(...starts);
  const last = Math.max(...starts) + 2.75 * 3600_000;
  return { from: first - 15 * 60_000, to: Math.max(last, now + 5 * 60_000) };
}

/** Keep nearby goals in one reachable marker instead of overlapping hit areas. */
export function groupSpikes(
  spikes: Spike[],
  position: (at: number) => number,
  width: number,
): { x: number; spikes: Spike[] }[] {
  const groups: { x: number; spikes: Spike[] }[] = [];
  if (width < 24) return groups;
  for (const spike of [...spikes].sort((a, b) => a.at - b.at)) {
    const anchor = Math.floor(position(spike.at) / 36) * 36 + 18;
    const x = Math.max(12, Math.min(width - 12, anchor));
    const previous = groups.at(-1);
    if (previous && x - previous.x < 28) previous.spikes.push(spike);
    else groups.push({ x, spikes: [spike] });
  }
  return groups;
}
