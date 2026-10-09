interface Props {
  data: { label: string; value: number; highlight?: boolean }[];
  width: number;
  height?: number;
  ariaLabel: string;
  formatValue?: (v: number) => string;
  showEvery?: number;
}

/** Vertical bars for a distribution (points histogram, seed slots). */
export function Bars({ data, width, height = 140, ariaLabel, formatValue, showEvery = 1 }: Props) {
  if (!data.length) return <p className="text-[13px] text-ink-soft">No distribution yet.</p>;
  const max = Math.max(...data.map((d) => d.value), 1e-9);
  const pad = { b: 18, t: 16 };
  const bw = width / data.length;
  return (
    <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block">
      {data.map((d, i) => {
        const h = ((height - pad.b - pad.t) * d.value) / max;
        return (
          <g key={d.label}>
            <rect
              x={i * bw + 1}
              y={height - pad.b - h}
              width={Math.max(1, bw - 2)}
              height={h}
              fill={d.highlight ? "var(--blue-line)" : "var(--ink)"}
              opacity={d.highlight ? 1 : 0.85}
            >
              <title>{`${d.label}: ${formatValue ? formatValue(d.value) : d.value}`}</title>
            </rect>
            {i % showEvery === 0 && (
              <text
                x={i * bw + bw / 2}
                y={height - 5}
                textAnchor="middle"
                fontSize={12}
                fill="var(--ink-soft)"
              >
                {d.label}
              </text>
            )}
            {formatValue && data.length <= 8 && (
              <text
                x={i * bw + bw / 2}
                y={height - pad.b - h - 4}
                textAnchor="middle"
                fontSize={12}
                fill="var(--ink)"
              >
                {formatValue(d.value)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
