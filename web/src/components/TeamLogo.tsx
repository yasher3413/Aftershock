import { useState } from "react";

/**
 * A team's logo, loaded from the NHL's public asset server (never copied
 * into this repo). Follows the color scheme, and falls back to the team code
 * in the display face if the image cannot load.
 */
export function TeamLogo({
  team,
  size = 24,
  className = "",
}: {
  team: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed || !team)
    return (
      <span
        className={`display inline-flex items-center justify-center font-bold ${className}`}
        style={{ width: size, height: size, fontSize: Math.max(9, size * 0.42) }}
        aria-hidden
      >
        {team}
      </span>
    );
  const base = `https://assets.nhle.com/logos/nhl/svg/${team}`;
  return (
    <picture className={`inline-flex shrink-0 ${className}`} style={{ width: size, height: size }}>
      <source srcSet={`${base}_dark.svg`} media="(prefers-color-scheme: dark)" />
      <img
        src={`${base}_light.svg`}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-contain"
        onError={() => setFailed(true)}
      />
    </picture>
  );
}
