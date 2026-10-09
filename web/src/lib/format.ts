/** Formatting helpers. All odds are floats in [0, 1] from the API. */

const MINUS = "−";

/** Odds as a percentage with one decimal, e.g. 0.4567 -> "45.7%". */
export function pct(p: number | null | undefined, digits = 1): string {
  if (p == null || Number.isNaN(p)) return "";
  const v = p * 100;
  if (v > 0 && v < 0.05) return "<0.1%";
  if (v < 100 && v > 99.95) return ">99.9%";
  return `${v.toFixed(digits)}%`;
}

/** A change in odds, in signed percentage points, e.g. +0.023 -> "+2.3 pp". */
export function pp(delta: number, digits = 1, suffix = " pp"): string {
  const v = delta * 100;
  const rounded = Number(v.toFixed(digits));
  if (rounded === 0) return `0.${"0".repeat(digits)}${suffix}`;
  const sign = rounded > 0 ? "+" : MINUS;
  return `${sign}${Math.abs(rounded).toFixed(digits)}${suffix}`;
}

/** Direction of a change: "up", "down", or "flat" (under the display threshold). */
export function direction(delta: number, threshold = 0.0005): "up" | "down" | "flat" {
  if (delta > threshold) return "up";
  if (delta < -threshold) return "down";
  return "flat";
}

export function arrow(delta: number): string {
  const d = direction(delta);
  return d === "up" ? "▲" : d === "down" ? "▼" : "";
}

export function magnitude(m: number): string {
  return m.toFixed(1);
}

/** mm:ss from seconds. */
export function clock(seconds: number | null | undefined): string {
  if (seconds == null) return "";
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const ORDINAL = ["1st", "2nd", "3rd"];

export function periodLabel(period: number | null | undefined, periodType?: string | null): string {
  if (!period) return "";
  if (periodType === "SO") return "SO";
  if (periodType === "OT" || period > 3) return period > 4 ? `${period - 3}OT` : "OT";
  return ORDINAL[period - 1] ?? `${period}th`;
}

/** Relative duration like "3h 12m" or "45m". */
export function duration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function localTime(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    ...opts,
  });
}

/** "October 8": a date in the current season, where the year is implied. */
export function monthDay(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function longDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
