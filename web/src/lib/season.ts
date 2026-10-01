/** Seasons with data, newest first (the backfill and the current season). */
export const SEASONS = [20262027, 20252026, 20242025] as const;

/** 20252026 -> "2025-26". */
export function seasonLabel(season: number): string {
  const y = Math.floor(season / 10000);
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

/** The season a night belongs to: August starts a new one. */
export function seasonOf(isoDate: string): number {
  const [y, m] = isoDate.split("-").map(Number) as [number, number];
  const start = m >= 8 ? y : y - 1;
  return start * 10000 + start + 1;
}
