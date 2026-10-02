import { energyTrace, groupSpikes, KERNEL_MS, nightWindow } from "./trace";

it("draws nothing after now and peaks at a tremor", () => {
  const spikes = [{ id: 1, at: 1000_000, magnitude: 4, shift: 0.05 }];
  const tr = energyTrace(spikes, 0, 3000_000, 2000_000, 301);
  expect(tr.at(-1)!.t).toBeLessThanOrEqual(2000_000);
  const peak = tr.reduce((a, b) => (b.e > a.e ? b : a));
  expect(Math.abs(peak.t - 1000_000)).toBeLessThanOrEqual(10_000);
  const later = tr.find((p) => p.t >= 1000_000 + 2 * KERNEL_MS)!;
  expect(later.e).toBeLessThan(peak.e * 0.2);
  expect(tr[0]!.e).toBe(0);
});

it("covers the night from before the first puck drop", () => {
  const w = nightWindow([10_000_000, 12_000_000], 11_000_000);
  expect(w.from).toBe(10_000_000 - 15 * 60_000);
  expect(w.to).toBeGreaterThan(12_000_000 + 2 * 3600_000);
});

it("groups crowded goals into distinct markers without losing a goal", () => {
  const spikes = [0, 10, 70, 100].map((at, i) => ({ id: i + 1, at, magnitude: i, shift: 0.01 }));
  const groups = groupSpikes(spikes, (at) => at, 120);
  expect(groups.map((g) => g.spikes.map((s) => s.id))).toEqual([[1, 2], [3], [4]]);
  expect(groups.map((g) => g.x)).toEqual([18, 54, 90]);
});

it("keeps edge markers inside the chart and merges a narrow final bin", () => {
  const spikes = [0, 39, 40].map((at, i) => ({ id: i + 1, at, magnitude: 2, shift: 0.01 }));
  const groups = groupSpikes(spikes, (at) => at, 40);
  expect(groups).toHaveLength(1);
  expect(groups[0]!.spikes.map((s) => s.id)).toEqual([1, 2, 3]);
  expect(groups[0]!.x).toBe(18);
});
