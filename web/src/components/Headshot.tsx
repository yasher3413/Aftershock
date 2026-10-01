import { useState } from "react";

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.at(-1)?.[0] ?? "")).toUpperCase();
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
  const [failed, setFailed] = useState(false);
  return (
    <span
      className="relative inline-flex shrink-0 items-end justify-center overflow-hidden rounded-full bg-ice-land"
      style={{ width: size, height: size }}
    >
      {url && !failed ? (
        <img
          src={url}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover object-top"
          onError={() => setFailed(true)}
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
