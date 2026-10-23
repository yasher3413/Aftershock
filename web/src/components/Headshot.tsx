import { useState } from "react";

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.at(-1)?.[0] ?? "")).toUpperCase();
}

// NHL headshots are full-size PNGs (100 to 150 KB each), far bigger than the
// avatars here. On Vercel they go through its image resizer at one of these
// widths (see vercel.json); anywhere else, or if it fails, the original loads.
const WIDTHS = [64, 128, 384];
const RESIZE = import.meta.env.PROD && !["localhost", "127.0.0.1"].includes(location.hostname);

function resized(url: string, size: number): string {
  const w = WIDTHS.find((x) => x >= size * 2) ?? WIDTHS.at(-1)!;
  return `/_vercel/image?url=${encodeURIComponent(url)}&w=${w}&q=75`;
}

/** NHL headshot for a player in a season, from the NHL's servers; initials if missing. */
export function Headshot({
  playerId,
  name,
  team,
  season,
  src,
  size = 40,
}: {
  playerId: number;
  name: string;
  team?: string | null;
  season?: number;
  src?: string | null;
  size?: number;
}) {
  const url =
    src ??
    (team && season ? `https://assets.nhle.com/mugs/nhl/${season}/${team}/${playerId}.png` : null);
  // 0: resized, 1: original, 2: initials.
  const [attempt, setAttempt] = useState(RESIZE ? 0 : 1);
  return (
    <span
      className="relative inline-flex shrink-0 items-end justify-center overflow-hidden rounded-full bg-ice-land"
      style={{ width: size, height: size }}
    >
      {url && attempt < 2 ? (
        <img
          src={attempt === 0 ? resized(url, size) : url}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover object-top"
          onError={() => setAttempt((a) => a + 1)}
        />
      ) : (
        <span
          aria-hidden
          className="display self-center font-bold text-ink-soft"
          style={{ fontSize: size * 0.38 }}
        >
          {initials(name)}
        </span>
      )}
    </span>
  );
}
