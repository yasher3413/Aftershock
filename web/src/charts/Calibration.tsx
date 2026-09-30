import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { useWidth } from "./useWidth";

export interface Curve {
  pred: number[];
  obs: number[];
  ece: number;
}

/**
 * Ink only: red and blue mean falling and rising odds everywhere else on the
 * site, so model comparisons use weight and dash instead of hue. The first
 * curve is always Aftershock's own model.
 */
const STYLES = [
  { stroke: "var(--ink)", width: 2, dash: undefined },
  { stroke: "var(--ink-soft)", width: 1.5, dash: "5 4" },
  { stroke: "var(--ink-soft)", width: 1.5, dash: "1.5 3.5" },
] as const;

function Swatch({ i }: { i: number }) {
  const s = STYLES[i % STYLES.length]!;
  return (
    <svg width={22} height={8} aria-hidden className="shrink-0">
      <line
        x1={0}
        x2={22}
        y1={4}
        y2={4}
        stroke={s.stroke}
        strokeWidth={s.width}
        strokeDasharray={s.dash}
      />
    </svg>
  );
}

function Legend({ names, notes }: { names: string[]; notes?: string[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-soft">
      {names.map((n, i) => (
        <li key={n} className="flex items-center gap-2">
          <Swatch i={i} />
          <span>
            <span className={i === 0 ? "font-semibold text-ink" : ""}>{n}</span>
            {notes?.[i] && <span className="tabular-nums"> {notes[i]}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Predicted against observed frequency; the diagonal is perfect calibration. */
export function CalibrationChart({
  title,
  curves,
  max,
}: {
  title: string;
  curves: Record<string, Curve>;
  max?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(480);
  const names = Object.keys(curves);
  if (!names.length) return null;
  const all = names.flatMap((n) => [...curves[n]!.pred, ...curves[n]!.obs]);
  const top = max ?? Math.min(1, Math.ceil(Math.max(...all) * 1.08 * 20) / 20);
  const size = Math.min(width, 480);
  const pad = { l: 40, r: 10, t: 8, b: 34 };
  const x = scaleLinear()
    .domain([0, top])
    .range([pad.l, size - pad.r]);
  const y = scaleLinear()
    .domain([0, top])
    .range([size - pad.b, pad.t]);
  const ticks = x.ticks(5);
  const pctTick = (v: number) => `${Math.round(v * 100)}%`;
  const path = line<[number, number]>()
    .x((d) => x(d[0]))
    .y((d) => y(d[1]));
  return (
    <figure ref={ref} className="my-6 w-full max-w-[480px]">
      <figcaption className="text-[15px] font-semibold">{title}</figcaption>
      <svg
        width={size}
        height={size}
        className="mt-2 block"
        role="img"
        aria-label={`${title}. ${names
          .map((n) => `${n}: calibration error ${curves[n]!.ece.toFixed(4)}`)
          .join(". ")}.`}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={size - pad.r} y1={y(v)} y2={y(v)} stroke="var(--ice-scratch)" />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--ink-soft)">
              {pctTick(v)}
            </text>
            <text
              x={x(v)}
              y={size - pad.b + 16}
              textAnchor="middle"
              fontSize={11}
              fill="var(--ink-soft)"
            >
              {pctTick(v)}
            </text>
          </g>
        ))}
        <line
          x1={x(0)}
          y1={y(0)}
          x2={x(top)}
          y2={y(top)}
          stroke="var(--ice-scratch)"
          strokeWidth={1.5}
        />
        <text
          x={x(top) - 4}
          y={y(top) + 14}
          textAnchor="end"
          fontSize={11}
          fill="var(--ink-soft)"
          transform={`rotate(-45 ${x(top) - 4} ${y(top) + 14})`}
        >
          perfect
        </text>
        {names
          .map((n, i) => ({ n, i }))
          .reverse()
          .map(({ n, i }) => {
            const c = curves[n]!;
            const s = STYLES[i % STYLES.length]!;
            const pts = c.pred.map((p, k) => [p, c.obs[k]!] as [number, number]);
            return (
              <g key={n}>
                <path
                  d={path(pts) ?? ""}
                  fill="none"
                  stroke={s.stroke}
                  strokeWidth={s.width}
                  strokeDasharray={s.dash}
                  strokeLinejoin="round"
                />
                {i === 0 &&
                  pts.map(([px, py], k) => (
                    <circle key={k} cx={x(px)} cy={y(py)} r={2.5} fill="var(--ink)" />
                  ))}
              </g>
            );
          })}
        <text x={pad.l} y={size - 2} fontSize={11} fill="var(--ink-soft)">
          Predicted
        </text>
        <text x={pad.l + 4} y={pad.t + 12} fontSize={11} fill="var(--ink-soft)">
          Observed
        </text>
      </svg>
      <Legend
        names={names}
        notes={names.map((n) => `(calibration error ${curves[n]!.ece.toFixed(4)})`)}
      />
    </figure>
  );
}

/** Grouped bars, one group per label, one bar per model. Lower is better. */
export function GroupedBars({
  title,
  labels,
  series,
  unit,
}: {
  title: string;
  labels: string[];
  series: Record<string, number[]>;
  unit: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(560);
  const names = Object.keys(series);
  if (!names.length || !labels.length) return null;
  const w = Math.min(width, 640);
  const h = 230;
  const pad = { l: 40, r: 4, t: 8, b: 40 };
  const maxV = Math.max(...names.flatMap((n) => series[n]!));
  const y = scaleLinear()
    .domain([0, maxV * 1.05])
    .range([h - pad.b, pad.t])
    .nice();
  const groupW = (w - pad.l - pad.r) / labels.length;
  const barW = Math.max(2, (groupW * 0.72) / names.length);
  const fills = ["var(--ink)", "var(--ink-soft)", "var(--ice-scratch)"];
  return (
    <figure ref={ref} className="my-6 w-full max-w-[640px]">
      <figcaption className="text-[15px] font-semibold">{title}</figcaption>
      <svg width={w} height={h} className="mt-2 block" role="img" aria-label={title}>
        {y.ticks(4).map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} stroke="var(--ice-scratch)" />
            <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--ink-soft)">
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        {labels.map((label, g) => {
          const gx = pad.l + g * groupW + (groupW - barW * names.length) / 2;
          return (
            <g key={label}>
              {names.map((n, i) => {
                const v = series[n]![g]!;
                return (
                  <rect
                    key={n}
                    x={gx + i * barW}
                    y={y(v)}
                    width={barW - 1}
                    height={y(0) - y(v)}
                    fill={fills[i % fills.length]}
                  >
                    <title>{`${n}, ${label}: ${v.toFixed(3)} ${unit}`}</title>
                  </rect>
                );
              })}
              <text
                x={pad.l + g * groupW + groupW / 2}
                y={h - pad.b + 15}
                textAnchor="middle"
                fontSize={11}
                fill="var(--ink-soft)"
              >
                {label.replace(" min", "")}
              </text>
            </g>
          );
        })}
        <text x={pad.l} y={h - 4} fontSize={11} fill="var(--ink-soft)">
          Minutes played
        </text>
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-ink-soft">
        {names.map((n, i) => (
          <li key={n} className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5"
              style={{ background: fills[i % fills.length] }}
            />
            <span className={i === 0 ? "font-semibold text-ink" : ""}>{n}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
