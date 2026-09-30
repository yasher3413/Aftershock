import { scaleLinear, scaleTime } from "d3-scale";
import { line } from "d3-shape";
import { useId, useState } from "react";
import { pct } from "../lib/format";

export interface Series {
  name: string;
  color: string;
  points: { t: number; v: number }[];
  dashed?: boolean;
}

export interface Marker {
  t: number;
  v: number;
  kind: "up" | "down";
  label: string;
  href?: string;
}

interface Props {
  series: Series[];
  markers?: Marker[];
  height?: number;
  width: number;
  yMax?: number;
  formatX?: (t: number) => string;
  xTicks?: number[];
  formatY?: (v: number) => string;
  ariaLabel: string;
}

/** Quiet multi-series time chart: probabilities on a 0 to 1 axis. */
export function LineChart({
  series,
  markers = [],
  height = 220,
  width,
  yMax = 1,
  formatX,
  xTicks,
  formatY,
  ariaLabel,
}: Props) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 40, r: 12, t: 10, b: 24 };
  const all = series.flatMap((s) => s.points);
  if (!all.length) return <p className="text-[13px] text-ink-soft">No history yet.</p>;
  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t), t0 + 1);
  const x = scaleTime()
    .domain([t0, t1])
    .range([pad.l, width - pad.r]);
  const y = scaleLinear()
    .domain([0, yMax])
    .range([height - pad.b, pad.t]);
  const path = line<{ t: number; v: number }>()
    .x((p) => x(p.t))
    .y((p) => y(p.v));
  const ticks = y.ticks(4);
  const fx =
    formatX ??
    ((t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  // Over a short span several ticks share a date; label each date once.
  const xticks = (xTicks ?? x.ticks(Math.max(2, Math.floor(width / 130))).map(Number)).filter(
    (t, i, all) => i === 0 || fx(t) !== fx(all[i - 1]!),
  );
  const nearest = (px: number) => {
    const t = x.invert(px).getTime();
    return all.reduce(
      (best, p) => (Math.abs(p.t - t) < Math.abs(best - t) ? p.t : best),
      all[0]!.t,
    );
  };
  return (
    <figure className="relative" aria-labelledby={`${id}-cap`}>
      <figcaption id={`${id}-cap`} className="sr-only">
        {ariaLabel}
      </figcaption>
      <svg
        width={width}
        height={height}
        className="block overflow-visible"
        onPointerMove={(e) => setHover(nearest(e.nativeEvent.offsetX))}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={ariaLabel}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke="var(--ice-scratch)" />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--ink-soft)">
              {formatY ? formatY(v) : `${Math.round(v * 100)}%`}
            </text>
          </g>
        ))}
        {xticks.map((t) => (
          <text
            key={+t}
            x={x(t)}
            y={height - 6}
            textAnchor="middle"
            fontSize={11}
            fill="var(--ink-soft)"
          >
            {fx(+t)}
          </text>
        ))}
        {series.map((s) => (
          <path
            key={s.name}
            d={path(s.points) ?? ""}
            fill="none"
            stroke={s.color}
            strokeWidth={1.8}
            strokeDasharray={s.dashed ? "4 3" : undefined}
          />
        ))}
        {markers.map((m, i) => (
          <circle
            key={i}
            cx={x(m.t)}
            cy={y(m.v)}
            r={3.5}
            fill={m.kind === "up" ? "var(--blue-line)" : "var(--goal)"}
            stroke="var(--ice)"
            strokeWidth={1}
          >
            <title>{m.label}</title>
          </circle>
        ))}
        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={pad.t}
            y2={height - pad.b}
            stroke="var(--ink-soft)"
            strokeDasharray="2 3"
          />
        )}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 text-[12px]">
        {series.map((s) => {
          const at =
            hover !== null
              ? s.points.reduce((b, p) => (Math.abs(p.t - hover) < Math.abs(b.t - hover) ? p : b))
              : s.points.at(-1);
          return (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4" style={{ background: s.color }} />
              {s.name}{" "}
              <span className="tabular-nums text-ink-soft">
                {at ? (formatY ? formatY(at.v) : pct(at.v)) : ""}
              </span>
            </span>
          );
        })}
        {hover !== null && <span className="text-ink-soft">{fx(hover)}</span>}
      </div>
    </figure>
  );
}
