import type { TeamInfo, Tremor } from "../api/types.gen";

function spokenPp(delta: number): string {
  const v = Math.abs(delta * 100).toFixed(1);
  return `${delta >= 0 ? "up" : "down"} ${v} percentage points`;
}

/** Screen reader sentence for a tremor, e.g. for the ARIA live region. */
export function announceTremor(
  t: Tremor,
  teams: Record<string, TeamInfo>,
  myTeam: string | null,
): string {
  const scorer = teams[t.team]?.name ?? t.team;
  if (t.overturned) return `Goal overturned, ${scorer}. Odds moved back.`;
  const sorted = [...t.deltas].sort((a, b) => Math.abs(b.d_playoffs) - Math.abs(a.d_playoffs));
  const mine = myTeam ? t.deltas.find((d) => d.team === myTeam) : undefined;
  const mover = mine && Math.abs(mine.d_playoffs) >= 0.0005 ? mine : sorted[0];
  const base = `Goal, ${scorer}. Magnitude ${t.magnitude.toFixed(1)}.`;
  if (!mover || Math.abs(mover.d_playoffs) < 0.0005) return base;
  const name = teams[mover.team]?.name ?? mover.team;
  return `${base} ${name} playoff odds ${spokenPp(mover.d_playoffs)}.`;
}
