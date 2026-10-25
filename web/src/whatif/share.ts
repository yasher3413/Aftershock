import { api } from "../api/client";
import type { ShareSpec } from "../components/ShareMenu";
import { drawScenarioCard, type CardInput } from "./shareCard";

/** A short link to these picks (/what-if?id=...), or the full address if the
 * server cannot save them. */
async function shortLink(encoded: string): Promise<string> {
  try {
    const r = await api<{ id: string }>("/scenarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encoded }),
    });
    return `${window.location.origin}/what-if?id=${r.id}`;
  } catch {
    return window.location.href;
  }
}

/** What the share menu posts for a What-If scenario. */
export function scenarioShare(card: CardInput, tweet: string, encoded: string): ShareSpec {
  return {
    label: "Share scenario",
    tweet,
    link: () => shortLink(encoded),
    // The card is drawn in the viewer's theme, the same for X and the share sheet.
    image: () => drawScenarioCard(card),
    key: `whatif:${encoded}:${JSON.stringify(card)}`,
    fileName: "puckquake-what-if.png",
    linkHint: "Opens these exact picks",
    imageHint: "A 1200 by 675 picture of your picks",
  };
}
