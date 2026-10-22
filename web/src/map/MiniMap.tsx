import { geoPath } from "d3-geo";
import { useEffect, useId, useState } from "react";
import type { TeamInfo, Tremor } from "../api/types.gen";
import { loadGeo, type Geo } from "./basemap";
import { makeProjection, placeVenue } from "./projection";

/** A still of a tremor: the continent, every team, and the ring frozen mid-spread. */
export function MiniMap({
  tremor,
  teams,
  width,
}: {
  tremor: Tremor;
  teams: TeamInfo[];
  width: number;
}) {
  const [geo, setGeo] = useState<Geo | null>(null);
  const id = `mm${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  useEffect(() => {
    loadGeo()
      .then(setGeo)
      .catch(() => setGeo(null));
  }, []);
  const height = Math.round(width * 0.62);
  const vp = { width, height, padding: 18 };
  const proj = makeProjection(vp);
  const path = geoPath(proj);
  const origin = placeVenue(proj, tremor.origin.lon, tremor.origin.lat, vp);
  const deltas = Object.fromEntries(tremor.deltas.map((d) => [d.team, d.d_playoffs]));
  const reach = Math.hypot(width, height) * 0.42;
  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label={`Map of the tremor spreading from ${tremor.origin.venue ?? tremor.home}`}
    >
      {/* The land and rings fade out at the frame instead of being cut by it. */}
      <defs>
        <linearGradient id={`${id}-v`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="white" stopOpacity="0" />
          <stop offset="0.06" stopColor="white" />
          <stop offset="0.86" stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-h`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="black" stopOpacity="1" />
          <stop offset="0.05" stopColor="black" stopOpacity="0" />
          <stop offset="0.95" stopColor="black" stopOpacity="0" />
          <stop offset="1" stopColor="black" stopOpacity="1" />
        </linearGradient>
        <mask id={`${id}-m`} maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={height}>
          <rect width={width} height={height} fill={`url(#${id}-v)`} />
          <rect width={width} height={height} fill={`url(#${id}-h)`} />
        </mask>
      </defs>
      <g mask={`url(#${id}-m)`}>
        {geo && (
          <>
            <path
              d={path(geo.land) ?? ""}
              fill="var(--ice-land)"
              stroke="var(--ice-scratch)"
              strokeWidth={0.8}
            />
            <path d={path(geo.lakes) ?? ""} fill="var(--ice)" />
            <path
              d={path(geo.borders) ?? ""}
              fill="none"
              stroke="var(--ice-scratch)"
              strokeWidth={0.5}
            />
          </>
        )}
        {[reach, reach * 0.72].map((r, i) => (
          <circle
            key={r}
            cx={origin.x}
            cy={origin.y}
            r={r}
            fill="none"
            stroke="var(--goal)"
            strokeWidth={i === 0 ? 1.5 + tremor.magnitude * 0.5 : 1}
            opacity={i === 0 ? 0.55 : 0.3}
          />
        ))}
      </g>
      <circle
        cx={origin.x}
        cy={origin.y}
        r={7 + tremor.magnitude}
        fill="var(--goal)"
        opacity={0.85}
      />
      {teams.map((t) => {
        const p = placeVenue(proj, t.lon, t.lat, vp);
        const d = deltas[t.abbrev] ?? 0;
        const inside = Math.hypot(p.x - origin.x, p.y - origin.y) <= reach;
        const color =
          !inside || Math.abs(d) < 0.001
            ? "var(--ink-soft)"
            : d > 0
              ? "var(--blue-line)"
              : "var(--goal)";
        return (
          <circle
            key={t.abbrev}
            cx={p.x}
            cy={p.y}
            r={Math.abs(d) >= 0.001 && inside ? 4.5 : 3}
            fill={color}
          />
        );
      })}
    </svg>
  );
}
