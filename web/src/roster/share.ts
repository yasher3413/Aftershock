import { api } from "../api/client";
import type { RosterRunOut } from "../api/types.gen";
import type { ShareSpec } from "../components/ShareMenu";
import { fetchCard } from "../lib/fetchCard";
import { pct } from "../lib/format";
import { headline } from "./moves";

// Saved moves, by their short form: the link and the card share one id.
const saved = new Map<string, Promise<string>>();
function savedId(encoded: string): Promise<string> {
  let p = saved.get(encoded);
  if (!p) {
    p = api<{ id: string }>("/roster-moves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encoded }),
    }).then((r) => r.id);
    p.catch(() => saved.delete(encoded));
    saved.set(encoded, p);
  }
  return p;
}

/** "TOR gets Quinn Hughes: TOR 41% to 52%, VAN 38% to 31% to make the
 * playoffs." The numbers are the ones on screen when it was shared. */
export function rosterTweet(run: RosterRunOut): string {
  const lines = run.changed
    .map((t) => run.teams.find((x) => x.team === t))
    .filter((t) => t != null)
    .map((t) => `${t.team} ${pct(t.playoffs_before, 0)} to ${pct(t.playoffs_after, 0)}`);
  return `${headline(run.moves)}: ${lines.join(", ")} to make the playoffs. Try your own on Puckquake:`;
}

/** What the share menu posts for a Roster Lab trade: a short link and the
 * server's card of the same trade (also the link's preview). */
export function rosterShare(run: RosterRunOut): ShareSpec {
  return {
    label: "Share trade",
    tweet: rosterTweet(run),
    link: async () => {
      try {
        return `${window.location.origin}/roster-lab?id=${await savedId(run.encoded)}`;
      } catch {
        return window.location.href;
      }
    },
    image: async () => fetchCard(`/api/og/roster/${await savedId(run.encoded)}.png`),
    key: `roster:${run.encoded}:${run.computed_at}`,
    fileName: "puckquake-trade.png",
    linkHint: "Opens this exact trade",
    imageHint: "A 1200 by 630 picture of the trade and the odds",
  };
}
