import { useState } from "react";
import { Link } from "react-router";
import { useEnergy, useLeaders, useStateQuery, useTremors } from "../api/client";
import { LineChart } from "../charts/LineChart";
import { useWidth } from "../charts/useWidth";
import type { LeadersResponse } from "../api/types.gen";
import { pct, pp } from "../lib/format";
import { useDocumentMeta } from "../lib/meta";
import { useMyTeam } from "../lib/myTeam";
import { TremorLine } from "../panels/TremorFeed";

const SEASONS = [
  { id: 20262027, label: "2026-27" },
  { id: 20252026, label: "2025-26" },
  { id: 20242025, label: "2024-25" },
];

type Tab = LeadersResponse["kind"] | "tremors" | "lottery" | "energy";
const TABS: { id: Tab; label: string; blurb: string }[] = [
  {
    id: "skater",
    label: "Goals",
    blurb:
      "Playoff Probability Added: the total change in their team's playoff odds from a player's goals.",
  },
  {
    id: "assist",
    label: "Assists",
    blurb: "Each assist gets the goal's full PPA, like points in the box score.",
  },
  {
    id: "goalie",
    label: "Goalies",
    blurb:
      "PPA allowed: how much the goals scored on a goalie cost his team. Closer to zero is better.",
  },
  {
    id: "team_chaos",
    label: "Team chaos",
    blurb: "How much a team's goals moved everyone else's playoff odds.",
  },
  { id: "tremors", label: "Top 100 tremors", blurb: "The season's biggest goals by magnitude." },
  {
    id: "energy",
    label: "Season energy",
    blurb:
      "How much every goal has shaken the standings, added up night by night, this season against the last two. Steeper means more violent.",
  },
  {
    id: "lottery",
    label: "Lottery watch",
    blurb:
      "Chances of finishing in the league's bottom three this season, the best draft lottery odds. Current season only.",
  },
];

function LeaderTable({ season, kind }: { season: number; kind: LeadersResponse["kind"] }) {
  const { data, isLoading } = useLeaders(season, kind);
  if (isLoading) return <p className="text-ink-soft">Loading</p>;
  if (!data || data.rows.length === 0)
    return <p className="text-ink-soft">No goals recorded for this season yet.</p>;
  return (
    <table className="w-full text-[14px]">
      <thead className="text-left text-[12px] text-ink-soft">
        <tr>
          <th className="w-10 font-normal">#</th>
          <th className="font-normal">{kind === "team_chaos" ? "Team" : "Player"}</th>
          {kind !== "team_chaos" && <th className="font-normal">Team</th>}
          <th className="text-right font-normal">
            {kind === "goalie"
              ? "Goals allowed"
              : kind === "assist"
                ? "Assists"
                : kind === "team_chaos"
                  ? "Goals"
                  : "Goals"}
          </th>
          <th className="text-right font-normal">
            {kind === "team_chaos" ? "Shift to others" : "PPA"}
          </th>
        </tr>
      </thead>
      <tbody>
        {data.rows.map((r) => (
          <tr key={`${r.rank}-${r.player?.id ?? r.team}`} className="border-t border-ice-scratch">
            <td className="py-1.5 tabular-nums text-ink-soft">{r.rank}</td>
            <td>
              {r.player ? (
                r.player.name
              ) : (
                <Link to={`/team/${r.team}`} className="display text-[16px] font-bold">
                  {r.team}
                </Link>
              )}
            </td>
            {kind !== "team_chaos" && (
              <td>
                <Link to={`/team/${r.team}`} className="display text-[15px] font-bold">
                  {r.team}
                </Link>
              </td>
            )}
            <td className="text-right tabular-nums">{r.count}</td>
            <td className={`text-right tabular-nums ${r.value < 0 ? "down" : ""}`}>
              {kind === "team_chaos" ? pp(r.value).replace("+", "") : pp(r.value)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const SEASON_COLORS = ["var(--ink-soft)", "var(--blue-line)", "var(--goal)"];

function Energy() {
  const { data } = useEnergy();
  const [ref, width] = useWidth<HTMLDivElement>(700);
  if (!data) return <p className="text-ink-soft">Loading</p>;
  const series = data.map((s, i) => ({
    name: `${Math.floor(s.season / 10000)}-${String((s.season % 10000) % 100).padStart(2, "0")}`,
    color: SEASON_COLORS[i] ?? "var(--ink)",
    points: s.points.map((p) => ({ t: p.day, v: p.cumulative * 100 })),
  }));
  const yMax = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.v)));
  return (
    <div ref={ref}>
      <LineChart
        width={width}
        height={260}
        yMax={yMax}
        series={series}
        formatX={(t) => `Day ${Math.round(t)}`}
        formatY={(v) => v.toFixed(0)}
        ariaLabel="Cumulative league energy by day of season, in percentage points of playoff odds moved"
      />
      <p className="mt-2 text-[12px] text-ink-soft">
        Percentage points of playoff odds moved by all goals, cumulative.
      </p>
    </div>
  );
}

function Lottery() {
  const { data } = useStateQuery();
  const rows = [...(data?.odds ?? [])]
    .sort((a, b) => (b.p_bottom3 ?? 0) - (a.p_bottom3 ?? 0))
    .slice(0, 12);
  if (!rows.length) return <p className="text-ink-soft">Loading</p>;
  return (
    <table className="w-full text-[14px]">
      <thead className="text-left text-[12px] text-ink-soft">
        <tr>
          <th className="font-normal">Team</th>
          <th className="text-right font-normal">Bottom three</th>
          <th className="text-right font-normal">Last overall</th>
          <th className="text-right font-normal">Projected points</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((o) => (
          <tr key={o.team} className="border-t border-ice-scratch">
            <td className="py-1.5">
              <Link to={`/team/${o.team}`} className="display text-[16px] font-bold">
                {o.team}
              </Link>
            </td>
            <td className="text-right tabular-nums">{pct(o.p_bottom3 ?? 0)}</td>
            <td className="text-right tabular-nums">{pct(o.p_last)}</td>
            <td className="text-right tabular-nums">{Math.round(o.exp_points)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TopTremors({ season }: { season: number }) {
  const { data, isLoading } = useTremors(season, "magnitude", 100);
  const myTeam = useMyTeam((s) => s.team);
  if (isLoading) return <p className="text-ink-soft">Loading</p>;
  if (!data || data.items.length === 0)
    return <p className="text-ink-soft">No tremors recorded for this season yet.</p>;
  return (
    <ol className="divide-y divide-ice-scratch">
      {data.items.map((t, i) => (
        <li key={t.id} className="grid grid-cols-[2rem_1fr] items-center">
          <span className="tabular-nums text-[13px] text-ink-soft">{i + 1}</span>
          <TremorLine t={t} myTeam={myTeam} />
        </li>
      ))}
    </ol>
  );
}

export default function LeadersPage() {
  const [season, setSeason] = useState(20252026);
  const [tab, setTab] = useState<Tab>("skater");
  const active = TABS.find((t) => t.id === tab)!;
  useDocumentMeta(
    "Leaders",
    "Playoff Probability Added leaders and the biggest goals of the season.",
  );
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="display text-[48px] font-extrabold leading-none">Leaders</h1>
        <label className="text-[13px] text-ink-soft">
          Season{" "}
          <select
            value={season}
            onChange={(e) => setSeason(Number(e.target.value))}
            className="ml-1 rounded-[var(--radius)] border border-ice-scratch bg-surface px-2 py-1 text-ink"
          >
            {SEASONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        role="tablist"
        aria-label="Leaderboards"
        className="mt-5 flex flex-wrap gap-1 border-b border-ice-scratch"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-[14px] ${tab === t.id ? "border-b-2 border-ink font-semibold" : "text-ink-soft hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mt-3 max-w-[70ch] text-[14px] text-ink-soft">{active.blurb}</p>
      <div className="mt-4" role="tabpanel">
        {tab === "tremors" ? (
          <TopTremors season={season} />
        ) : tab === "lottery" ? (
          <Lottery />
        ) : tab === "energy" ? (
          <Energy />
        ) : (
          <LeaderTable season={season} kind={tab} />
        )}
      </div>
    </div>
  );
}
