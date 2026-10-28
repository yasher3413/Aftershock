/** Roster Lab moves and their short form in the address, which matches the
 * server's (services/aftershock/sim/roster.py): `t{player}-{TEAM}` trades a
 * player, `s{player}-{TEAM}` signs a free agent, `i{player}-{weeks}` takes a
 * player out (0 is the rest of the season), joined by `_` in sorted order. */

export const WEEKS = [1, 2, 4, 6, 8] as const;

export type Move =
  | { kind: "t"; id: number; to: string }
  | { kind: "s"; id: number; to: string }
  | { kind: "i"; id: number; weeks: number | null };

const PART = /^(?:([ts])(\d{1,8})-([A-Z]{3})|i(\d{1,8})-(\d))$/;

export function code(m: Move): string {
  return m.kind === "i" ? `i${m.id}-${m.weeks ?? 0}` : `${m.kind}${m.id}-${m.to}`;
}

export function encodeMoves(moves: Move[]): string {
  return moves.map(code).sort().join("_");
}

/** The moves in an address, sorted; parts it cannot read are dropped. */
export function parseMoves(encoded: string | null): Move[] {
  const out = new Map<number, Move>();
  for (const part of (encoded ?? "").split("_")) {
    const m = PART.exec(part);
    if (!m) continue;
    if (m[1]) {
      const id = Number(m[2]);
      out.set(id, { kind: m[1] as "t" | "s", id, to: m[3]! });
    } else {
      const weeks = Number(m[5]);
      if (weeks && !(WEEKS as readonly number[]).includes(weeks)) continue;
      const id = Number(m[4]);
      out.set(id, { kind: "i", id, weeks: weeks || null });
    }
  }
  return [...out.values()].sort((a, b) => (code(a) < code(b) ? -1 : 1));
}

/** The moves with this player's move replaced (or removed, for "none"). */
export function withMove(moves: Move[], next: Move | { kind: "none"; id: number }): Move[] {
  const rest = moves.filter((m) => m.id !== next.id);
  return parseMoves(encodeMoves(next.kind === "none" ? rest : [...rest, next]));
}

export function outLabel(weeks: number | null): string {
  if (weeks == null) return "Out for the season";
  return `Out ${weeks} week${weeks === 1 ? "" : "s"}`;
}

/** "TOR gets Quinn Hughes, Auston Matthews out 4 weeks", as the server
 * words it for the link preview. */
export function headline(
  moves: { name: string; move: string; to_team?: string | null; weeks?: number | null }[],
): string {
  const gets = new Map<string, string[]>();
  const out: string[] = [];
  for (const m of moves) {
    if (m.move === "injury") out.push(`${m.name} ${outLabel(m.weeks ?? null).toLowerCase()}`);
    else gets.set(m.to_team!, [...(gets.get(m.to_team!) ?? []), m.name]);
  }
  return [...[...gets].map(([t, names]) => `${t} gets ${names.join(" and ")}`), ...out].join(", ");
}
