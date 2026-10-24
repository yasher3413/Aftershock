import { useState } from "react";
import { Link } from "react-router";
import type { ShotOut, Tremor } from "../api/types.gen";
import { Headshot } from "../components/Headshot";
import { TeamLogo } from "../components/TeamLogo";
import { clock, pct, periodLabel, pp } from "../lib/format";
import { useDarkScheme } from "../lib/useMedia";

const SHOT_TYPES: Record<string, string> = {
  wrist: "Wrist shot",
  snap: "Snap shot",
  slap: "Slap shot",
  backhand: "Backhand",
  "tip-in": "Tip-in",
  deflected: "Deflection",
  "wrap-around": "Wraparound",
  poke: "Poke",
  bat: "Batted",
  "between-legs": "Between the legs",
  cradle: "Cradle",
};

/** The card for a shot under the pointer, or pinned by a tap. */
function ShotCard({ shot, tremor, season }: { shot: ShotOut; tremor?: Tremor; season: number }) {
  const own = tremor?.deltas.find((d) => d.team === shot.team);
  return (
    <div className="w-60 rounded-[var(--radius)] border border-ice-scratch bg-surface p-3 text-[13px] shadow-[0_6px_24px_rgba(10,20,30,0.16)]">
      <div className="flex items-center gap-2.5">
        {shot.shooter ? (
          <Headshot
            playerId={shot.shooter.id}
            name={shot.shooter.name}
            team={shot.team}
            season={season}
            size={40}
          />
        ) : (
          <TeamLogo team={shot.team} size={32} />
        )}
        <div className="min-w-0">
          <div className="truncate font-semibold">{shot.shooter?.name ?? shot.team}</div>
          <div className="flex items-center gap-1 text-ink-soft">
            <TeamLogo team={shot.team} size={14} />
            <span>
              {shot.team} · {periodLabel(shot.period)} {clock(shot.t_period_s)}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-2.5 border-t border-ice-scratch pt-2">
        <div className={shot.goal ? "font-semibold text-goal" : "font-semibold"}>
          {shot.goal ? "Goal" : "Shot"}
          {shot.shot_type
            ? `, ${(SHOT_TYPES[shot.shot_type] ?? shot.shot_type).toLowerCase()}`
            : ""}
        </div>
        <div className="mt-0.5 text-ink-soft tabular-nums">
          Chance it scored: <span className="font-semibold text-ink">{pct(shot.xg, 0)}</span>
        </div>
      </div>
      {tremor && (
        <div className="mt-2 flex items-baseline justify-between">
          <span>
            <span className="display text-[20px] font-bold">{tremor.magnitude.toFixed(1)}</span>{" "}
            <span className="text-ink-soft">magnitude</span>
          </span>
          {own && (
            <span className={`tabular-nums ${own.d_playoffs >= 0 ? "up" : "down"}`}>
              {shot.team} {pp(own.d_playoffs)}
            </span>
          )}
        </div>
      )}
      {tremor && (
        <Link
          to={`/tremor/${tremor.id}`}
          className="mt-2 inline-block font-semibold text-blue-line underline-offset-4 hover:underline"
        >
          Everyone this goal moved
        </Link>
      )}
    </div>
  );
}

/**
 * A 200 by 85 ft rink in feet, centered at (0, 0), with the standard
 * markings. Home shots are drawn attacking the right net and away shots the
 * left. Dot area follows xG; goals are filled. Hovering a dot (or tapping
 * it) shows its card; the home team's logo sits faded at center ice.
 */
export function Rink({
  shots,
  home,
  width,
  tremors = [],
  season,
}: {
  shots: ShotOut[];
  home: string;
  width: number;
  tremors?: Tremor[];
  season: number;
}) {
  const [active, setActive] = useState<{ id: number; pinned: boolean } | null>(null);
  const dark = useDarkScheme();
  const tremorByEvent = new Map(tremors.map((t) => [t.event_id, t]));
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
  const height = (H + 2 * pad) * scale;
  const shown = active ? shots.find((sh) => sh.event_id === active.id) : undefined;
  const place = (sh: ShotOut) => {
    const isHome = sh.team === home;
    return { x: tx(isHome ? sh.x : -sh.x), y: ty(isHome ? sh.y : -sh.y) };
  };
  const logo = s(22);
  return (
    <div className="relative" onMouseLeave={() => setActive((a) => (a?.pinned ? a : null))}>
      <svg
        width={width}
        height={height}
        role="group"
        aria-label={`Shot map. ${home} shoots right. Larger dots are more dangerous shots; filled dots are goals.`}
        onClick={(e) => {
          if (e.target === e.currentTarget) setActive(null);
        }}
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
        <image
          href={`https://assets.nhle.com/logos/nhl/svg/${home}_${dark ? "dark" : "light"}.svg`}
          x={tx(0) - logo / 2}
          y={ty(0) - logo / 2}
          width={logo}
          height={logo}
          opacity={0.14}
          aria-hidden
          pointerEvents="none"
        />
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
          const { x, y } = place(sh);
          const r = 0.9 + Math.sqrt(sh.xg) * 5.5;
          // Teams differ by tone, not paint: blue and red mean odds on this site.
          const color = isHome ? "var(--ink)" : "var(--ink-soft)";
          const on = active?.id === sh.event_id;
          const label = `${sh.goal ? "Goal" : "Shot"} by ${sh.shooter?.name ?? sh.team}, ${periodLabel(sh.period)} ${clock(sh.t_period_s)}, ${pct(sh.xg, 0)} chance to score`;
          return (
            <g key={sh.event_id}>
              <circle
                cx={x}
                cy={y}
                r={s(r)}
                fill={sh.goal ? color : "none"}
                stroke={on ? "var(--blue-line)" : color}
                strokeWidth={s(on ? 0.9 : 0.45)}
                opacity={sh.goal || on ? 1 : 0.7}
              />
              {/* A larger invisible target, so small dots are easy to hover and tap. */}
              <circle
                cx={x}
                cy={y}
                r={Math.max(s(r), 8)}
                fill="transparent"
                className="cursor-pointer"
                role="button"
                tabIndex={sh.goal ? 0 : -1}
                aria-label={label}
                onMouseEnter={() =>
                  setActive((a) => (a?.pinned ? a : { id: sh.event_id, pinned: false }))
                }
                onFocus={() => setActive({ id: sh.event_id, pinned: false })}
                onBlur={() => setActive((a) => (a?.pinned ? a : null))}
                onClick={() =>
                  setActive((a) =>
                    a?.id === sh.event_id && a.pinned ? null : { id: sh.event_id, pinned: true },
                  )
                }
              />
            </g>
          );
        })}
      </svg>
      {shown &&
        (() => {
          const { x, y } = place(shown);
          // Beside the dot, flipped to stay inside the rink.
          const left = x + 250 > width ? Math.max(0, x - 252) : x + 12;
          const top = Math.min(Math.max(0, y - 40), Math.max(0, height - 150));
          return (
            <div className="absolute z-10" style={{ left, top }} role="tooltip">
              <ShotCard shot={shown} tremor={tremorByEvent.get(shown.event_id)} season={season} />
            </div>
          );
        })()}
    </div>
  );
}
