/** A shareable image of a What-If scenario, drawn on a canvas in the browser. */

export interface CardTeam {
  team: string;
  before: number;
  after: number;
}

export interface CardInput {
  picks: string[]; // already worded, e.g. "TOR beat EDM in overtime"
  movers: CardTeam[]; // biggest changes first
  pickCount: number;
  site: string; // where to make your own, e.g. "puckquake.com"
}

// The site's light palette (tokens.css), fixed so a card looks the same
// whoever made it.
const ICE = "#eef3f6";
const LAND = "#dde7ed";
const INK = "#14212b";
const SOFT = "#5d707e";
const UP = "#0b4fa8";
const DOWN = "#c8102e";

const W = 1200;
const H = 675;

const pct = (p: number) => `${(p * 100).toFixed(p >= 0.995 || p < 0.005 ? 0 : 1)}%`;

export async function drawScenarioCard(input: CardInput): Promise<Blob> {
  await Promise.all([
    document.fonts.load('800 64px "Big Shoulders Display"'),
    document.fonts.load('700 30px "Big Shoulders Display"'),
    document.fonts.load('400 24px "Overpass"'),
    document.fonts.load('600 24px "Overpass"'),
  ]).catch(() => undefined);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const display = (size: number, weight = 800) =>
    `${weight} ${size}px "Big Shoulders Display", "Arial Narrow", sans-serif`;
  const text = (size: number, weight = 400) =>
    `${weight} ${size}px Overpass, system-ui, sans-serif`;

  g.fillStyle = ICE;
  g.fillRect(0, 0, W, H);

  // Header
  g.fillStyle = INK;
  g.font = display(64);
  g.fillText("My NHL what-if", 60, 104);
  g.font = display(40);
  g.textAlign = "right";
  g.fillText("Puckquake", W - 60, 96);
  g.textAlign = "left";
  g.fillStyle = SOFT;
  g.font = text(24);
  g.fillText(
    `${input.pickCount} ${input.pickCount === 1 ? "pick" : "picks"}, 10,000 seasons simulated`,
    60,
    146,
  );

  // Picks, left column
  g.fillStyle = INK;
  g.font = text(22, 600);
  g.fillText("MY PICKS", 60, 214);
  g.font = text(26);
  const shown = input.picks.slice(0, 6);
  shown.forEach((p, i) => g.fillText(p, 60, 262 + i * 44, 460));
  if (input.picks.length > shown.length) {
    g.fillStyle = SOFT;
    g.fillText(`and ${input.picks.length - shown.length} more`, 60, 262 + shown.length * 44);
  }

  // Biggest changes, right column: before → after bars
  const x0 = 580;
  const barW = 360;
  g.fillStyle = INK;
  g.font = text(22, 600);
  g.fillText("PLAYOFF ODDS, BEFORE → AFTER", x0, 214);
  input.movers.slice(0, 5).forEach((m, i) => {
    const y = 262 + i * 70;
    g.fillStyle = INK;
    g.font = display(34, 700);
    g.fillText(m.team, x0, y + 8);
    const bx = x0 + 80;
    g.fillStyle = LAND;
    g.fillRect(bx, y - 10, barW, 14);
    const lo = Math.min(m.before, m.after);
    const hi = Math.max(m.before, m.after);
    g.fillStyle = INK;
    g.fillRect(bx, y - 10, barW * lo, 14);
    g.fillStyle = m.after >= m.before ? UP : DOWN;
    g.fillRect(bx + barW * lo, y - 10, Math.max(3, barW * (hi - lo)), 14);
    g.font = text(22);
    g.fillStyle = SOFT;
    g.fillText(`${pct(m.before)} →`, bx, y + 34);
    g.fillStyle = m.after >= m.before ? UP : DOWN;
    g.font = text(22, 600);
    g.fillText(pct(m.after), bx + g.measureText(`${pct(m.before)} → `).width + 6, y + 34);
  });

  // Footer
  g.fillStyle = SOFT;
  g.font = text(18);
  g.fillText(`Make your own at ${input.site}/what-if. Not affiliated with the NHL.`, 60, H - 40);

  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas"))), "image/png"),
  );
}
