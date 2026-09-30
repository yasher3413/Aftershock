import { useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { StateResponse } from "../api/types.gen";
import { arrow, pct, pp } from "../lib/format";

/** A small live odds gauge for other sites to embed in an iframe. */
export default function EmbedPage() {
  const abbrev = (useParams().abbrev ?? "").toUpperCase();
  const { data } = useQuery({
    queryKey: ["state-embed"],
    queryFn: () => api<StateResponse>("/state"),
    refetchInterval: 60_000,
  });
  const team = data?.teams.find((t) => t.abbrev === abbrev);
  const odds = data?.odds.find((o) => o.team === abbrev);
  const start = data?.odds_day_start.find((o) => o.team === abbrev);
  const change = odds && start ? odds.p_playoffs - start.p_playoffs : 0;
  const p = odds?.p_playoffs ?? 0;
  const r = 44;
  const c = 2 * Math.PI * r;
  return (
    <a
      href={`/team/${abbrev}`}
      target="_top"
      className="flex h-dvh items-center gap-4 bg-ice p-3 text-ink no-underline"
      aria-label={team ? `${team.name} playoff odds ${pct(p)}` : "Playoff odds"}
    >
      <svg width={108} height={108} viewBox="0 0 108 108" aria-hidden className="shrink-0">
        <circle cx={54} cy={54} r={r} fill="none" stroke="var(--ice-scratch)" strokeWidth={8} />
        <circle
          cx={54}
          cy={54}
          r={r}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={8}
          strokeDasharray={`${p * c} ${c}`}
          transform="rotate(-90 54 54)"
        />
        <text
          x={54}
          y={62}
          textAnchor="middle"
          fontSize={24}
          fontWeight={800}
          fontFamily="var(--font-display)"
          fill="var(--ink)"
        >
          {abbrev}
        </text>
      </svg>
      <div className="min-w-0">
        <div className="text-[12px] text-ink-soft">{team?.name ?? abbrev} playoff odds</div>
        <div className="display text-[40px] font-extrabold leading-none tabular-nums">
          {odds ? pct(p) : ""}
        </div>
        {change !== 0 && (
          <div className={`text-[12px] ${change > 0 ? "up" : "down"}`}>
            {arrow(change)} {pp(change)} today
          </div>
        )}
        <div className="mt-1 text-[11px] text-ink-soft">Aftershock. Data from NHL.com.</div>
      </div>
    </a>
  );
}
