import { scaleLinear, scaleTime } from "d3-scale";
import { line } from "d3-shape";
import { Link } from "react-router";
import { magnitude as fmtMag, pct } from "../lib/format";
import { TeamLogo } from "../components/TeamLogo";

/**
 * The team's map node at scoreboard size: the arc is its playoff odds, the
 * tick under it is the team color, exactly as on the map.
 */
export function TeamRing({
  code,
  odds,
  color,
  size = 200,
}: {
  code: string;
  odds: number | null;
  color: string;
  size?: number;
}) {
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, odds ?? 0));
  return (
    <svg
      width={size}
      height={size + 14}
      viewBox={`0 0 ${size} ${size + 14}`}
      role="img"
      aria-label={`${code} playoff odds ${pct(odds)}`}
      className="block shrink-0"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="var(--surface)"
        stroke="var(--ice-scratch)"
        strokeWidth={10}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--ink)"
        strokeWidth={10}
        strokeDasharray={`${c * p} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <foreignObject
        x={size / 2 - size * 0.14}
        y={size / 2 - size * 0.34}
        width={size * 0.28}
        height={size * 0.28}
      >
        <TeamLogo team={code} size={Math.round(size * 0.28)} />
      </foreignObject>
      <text
        x={size / 2}
        y={size / 2 + size * 0.14}
        textAnchor="middle"
        className="display"
        fontSize={size * 0.26}
        fontWeight={800}
        fill="var(--ink)"
      >
        {odds == null ? "-" : pct(odds)}
      </text>
      <rect x={size / 2 - 16} y={size + 4} width={32} height={6} fill={color} />
    </svg>
  );
}

export interface Spike {
  id: number;
  t: number;
  v: number;
  magnitude: number;
  up: boolean;
  label: string;
}

/**
 * The season as a seismogram: one playoff-odds trace on seismograph paper,
 * with the biggest goals for (up, blue) and against (down, red) as spikes
 * whose length follows their magnitude.
 */
export function SeasonSeismogram({
  points,
  spikes,
  width,
  label,
}: {
  points: { t: number; v: number }[];
  spikes: Spike[];
  width: number;
  label: string;
}) {
  const h = 300;
  const pad = { l: 44, r: 16, t: 50, b: 44 };
  if (points.length === 0)
    return <p className="text-[15px] text-ink-soft">The trace starts with the first game.</p>;
  const t0 = Math.min(...points.map((p) => p.t));
  const t1 = Math.max(...points.map((p) => p.t), t0 + 3600_000);
  const x = scaleTime()
    .domain([t0, t1])
    .range([pad.l, width - pad.r]);
  const y = scaleLinear()
    .domain([0, 1])
    .range([h - pad.b, pad.t]);
  const path = line<{ t: number; v: number }>()
    .x((p) => x(p.t))
    .y((p) => y(p.v));
  const fmt = (t: number) =>
    new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const xticks = x
    .ticks(Math.max(2, Math.floor(width / 120)))
    .map(Number)
    .filter((t, i, all) => i === 0 || fmt(t) !== fmt(all[i - 1]!));
  const last = points[points.length - 1]!;
  // Place labels biggest first: each spike ends where its label clears every
  // label already placed, so goals close in time never print on top of each other.
  const tips = new Map<number, number>();
  const placed: { x: number; y: number }[] = [];
  for (const s of [...spikes].sort((a, b) => b.magnitude - a.magnitude)) {
    const x0 = x(s.t);
    const y0 = y(s.v);
    let len = 12 + s.magnitude * 5;
    let tip = y0;
    for (let tries = 0; tries < 12; tries++) {
      tip = Math.max(18, Math.min(h - 32, y0 + (s.up ? -len : len)));
      const ly = s.up ? tip - 4 : tip + 13;
      if (!placed.some((p) => Math.abs(p.x - x0) < 24 && Math.abs(p.y - ly) < 15)) break;
      len += 15;
    }
    tips.set(s.id, tip);
    placed.push({ x: x0, y: s.up ? tip - 4 : tip + 13 });
  }
  return (
    <svg width={width} height={h} role="group" aria-label={label} className="block">
      <rect
        x={pad.l}
        y={pad.t}
        width={width - pad.l - pad.r}
        height={h - pad.t - pad.b}
        fill="var(--ice-land)"
      />
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line
            x1={pad.l}
            x2={width - pad.r}
            y1={y(v)}
            y2={y(v)}
            stroke="var(--ice-scratch)"
            strokeDasharray={v === 0.5 ? undefined : "2 4"}
          />
          <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--ink-soft)">
            {Math.round(v * 100)}%
          </text>
        </g>
      ))}
      {xticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={pad.t} y2={h - pad.b} stroke="var(--ice-scratch)" />
          <text x={x(t) + 4} y={h - 4} fontSize={11} fill="var(--ink-soft)">
            {fmt(t)}
          </text>
        </g>
      ))}
      <path
        d={path(points) ?? ""}
        fill="none"
        stroke="var(--ink)"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {spikes.map((s, i) => {
        const x0 = x(s.t);
        const y0 = y(s.v);
        const y1 = tips.get(s.id) ?? y0;
        const color = s.up ? "var(--blue-line)" : "var(--goal)";
        return (
          <Link key={s.id} to={`/tremor/${s.id}`} aria-label={s.label}>
            <rect
              x={x0 - 6}
              y={Math.min(y0, y1) - 16}
              width={12}
              height={Math.abs(y1 - y0) + 32}
              fill="transparent"
            />
            <line x1={x0} x2={x0} y1={y0} y2={y1} stroke={color} strokeWidth={2} />
            <circle cx={x0} cy={y0} r={3} fill={color} />
            <text
              key={i}
              x={x0}
              y={s.up ? y1 - 4 : y1 + 13}
              textAnchor="middle"
              className="display"
              fontSize={15}
              fontWeight={700}
              fill={color}
            >
              {fmtMag(s.magnitude)}
            </text>
            <title>{s.label}</title>
          </Link>
        );
      })}
      <circle cx={x(last.t)} cy={y(last.v)} r={4} fill="var(--ink)" />
    </svg>
  );
}
