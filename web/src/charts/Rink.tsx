import type { ShotOut } from "../api/types.gen";

/**
 * A 200 by 85 ft rink in feet, centered at (0, 0), with the standard
 * markings. Home shots are drawn attacking the right net and away shots the
 * left. Dot area follows xG; goals are filled.
 */
export function Rink({ shots, home, width }: { shots: ShotOut[]; home: string; width: number }) {
  const W = 200;
  const H = 85;
  const pad = 2;
  const scale = width / (W + 2 * pad);
  const tx = (x: number) => (x + W / 2 + pad) * scale;
  const ty = (y: number) => (H / 2 - y + pad) * scale;
  const s = (ft: number) => ft * scale;
  const circle = (cx: number, cy: number, r: number, props: React.SVGProps<SVGCircleElement>) => (
    <circle cx={tx(cx)} cy={ty(cy)} r={s(r)} {...props} />
  );
  const line = (x: number, color: string, w: number) => (
    <line x1={tx(x)} x2={tx(x)} y1={ty(H / 2)} y2={ty(-H / 2)} stroke={color} strokeWidth={s(w)} />
  );
  const crease = (side: 1 | -1) => {
    const gx = side * 89;
    const d = `M ${tx(gx)} ${ty(4)} L ${tx(gx - side * 4.5)} ${ty(4)} A ${s(6)} ${s(6)} 0 0 ${side > 0 ? 0 : 1} ${tx(gx - side * 4.5)} ${ty(-4)} L ${tx(gx)} ${ty(-4)} Z`;
    return (
      <path
        d={d}
        fill="var(--blue-line)"
        opacity={0.18}
        stroke="var(--goal)"
        strokeWidth={s(0.3)}
      />
    );
  };
  const net = (side: 1 | -1) => (
    <rect
      x={side > 0 ? tx(89) : tx(-89 - 3.3)}
      y={ty(3)}
      width={s(3.3)}
      height={s(6)}
      fill="none"
      stroke="var(--goal)"
      strokeWidth={s(0.4)}
    />
  );
  return (
    <svg
      width={width}
      height={(H + 2 * pad) * scale}
      role="img"
      aria-label={`Shot map. ${home} shoots right. Larger dots are more dangerous shots; filled dots are goals.`}
    >
      <rect
        x={tx(-W / 2)}
        y={ty(H / 2)}
        width={s(W)}
        height={s(H)}
        rx={s(28)}
        fill="var(--surface)"
        stroke="var(--ink-soft)"
        strokeWidth={s(0.6)}
      />
      {line(0, "var(--goal)", 1)}
      {line(25, "var(--blue-line)", 1)}
      {line(-25, "var(--blue-line)", 1)}
      {line(89, "var(--goal)", 0.3)}
      {line(-89, "var(--goal)", 0.3)}
      {circle(0, 0, 15, { fill: "none", stroke: "var(--blue-line)", strokeWidth: s(0.3) })}
      {[-69, 69].flatMap((x) =>
        [-22, 22].map((y) => (
          <g key={`${x}${y}`}>
            {circle(x, y, 15, { fill: "none", stroke: "var(--goal)", strokeWidth: s(0.3) })}
            {circle(x, y, 1, { fill: "var(--goal)" })}
          </g>
        )),
      )}
      {[-20, 20].flatMap((x) =>
        [-22, 22].map((y) => <g key={`n${x}${y}`}>{circle(x, y, 1, { fill: "var(--goal)" })}</g>),
      )}
      {crease(1)}
      {crease(-1)}
      {net(1)}
      {net(-1)}
      {shots.map((sh) => {
        const isHome = sh.team === home;
        const x = isHome ? sh.x : -sh.x;
        const y = isHome ? sh.y : -sh.y;
        const r = 0.9 + Math.sqrt(sh.xg) * 5.5;
        // Teams differ by tone, not paint: blue and red mean odds on this site.
        const color = isHome ? "var(--ink)" : "var(--ink-soft)";
        return (
          <circle
            key={sh.event_id}
            cx={tx(x)}
            cy={ty(y)}
            r={s(r)}
            fill={sh.goal ? color : "none"}
            stroke={color}
            strokeWidth={s(0.45)}
            opacity={sh.goal ? 1 : 0.7}
          >
            <title>{`${sh.shooter?.name ?? sh.team}, ${sh.shot_type ?? "shot"}, xG ${sh.xg.toFixed(2)}${sh.goal ? ", goal" : ""}`}</title>
          </circle>
        );
      })}
    </svg>
  );
}
