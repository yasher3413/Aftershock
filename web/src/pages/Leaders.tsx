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
import { Headshot } from "../components/Headshot";
import { TeamLogo } from "../components/TeamLogo";

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
    id: "on_ice",
    label: "PPA plus/minus",
    blurb:
      "Plus/minus in playoff odds: what goals for added and goals against cost the player's team while he was on the ice. Shared with linemates. Measured stability: a player's two half-seasons correlate at 0.59.",
  },
  {
    id: "plus_minus",
    label: "Plus/minus",
    blurb:
      "Traditional plus/minus by the NHL's rules, from shift charts. Matches the NHL's official figure exactly for 94 percent of 2025-26 players and within one for 99 percent.",
  },
  {
    id: "penalty_cost",
    label: "Penalty cost",
    blurb:
      "Playoff odds lost to power-play goals scored during a player's own penalties. Mostly luck from one half-season to the next (correlation 0.24): read it as what happened, not a skill.",
  },
  {
    id: "drawn",
    label: "Penalties drawn",
    blurb: "Playoff odds gained from power-play goals scored on penalties a player drew.",
  },
  {
    id: "giveaway_cost",
    label: "Costly giveaways",
    blurb:
      "Giveaways the other team turned into a goal within 10 seconds, and the playoff odds that goal cost. Arenas record giveaways unevenly, and the cost is mostly luck (correlation 0.20).",
  },
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

const GROUPS: { label: string; tabs: Tab[] }[] = [
  { label: "Players", tabs: ["skater", "assist", "goalie"] },
  { label: "Biggest goals", tabs: ["tremors"] },
  { label: "Defense", tabs: ["on_ice", "plus_minus", "penalty_cost", "drawn", "giveaway_cost"] },
  { label: "Teams", tabs: ["team_chaos", "energy", "lottery"] },
];

function LeaderBoard({ season, kind }: { season: number; kind: LeadersResponse["kind"] }) {
  const { data, isLoading } = useLeaders(season, kind);
  if (isLoading) return <p className="text-ink-soft">Loading</p>;
  if (!data || data.rows.length === 0)
    return <p className="text-ink-soft">No goals recorded for this season yet.</p>;
  const max = Math.max(...data.rows.map((r) => Math.abs(r.value)), 1e-9);
  const countLabel =
    kind === "goalie"
      ? "goals allowed"
      : kind === "assist"
        ? "assists"
        : kind === "penalty_cost"
          ? "penalties"
          : kind === "drawn"
            ? "drawn"
            : kind === "giveaway_cost"
              ? "costly giveaways"
              : kind === "plus_minus" || kind === "on_ice"
                ? "goals on ice"
                : "goals";
  const partial = data.onice_coverage != null && data.onice_coverage < 0.99;
  return (
    <>
      {partial && (
        <p className="mb-2 text-[12px] text-ink-soft">
          The NHL has no shift data for {Math.round((1 - data.onice_coverage!) * 100)}% of this
          season's goals; this board leaves them out.
        </p>
      )}
      <ol className="divide-y divide-ice-scratch">
        {data.rows.map((r) => {
          const value =
            kind === "team_chaos"
              ? pp(r.value).replace("+", "")
              : kind === "plus_minus"
                ? r.value > 0
                  ? `+${r.value}`
                  : String(r.value)
                : pp(r.value);
          const w = (Math.abs(r.value) / max) * 100;
          return (
            <li
              key={`${r.rank}-${r.player?.id ?? r.team}`}
              className="grid grid-cols-[2.5rem_minmax(0,1fr)_5.5rem] items-center gap-x-3 py-2 sm:grid-cols-[2.5rem_minmax(0,19rem)_1fr_5.5rem]"
            >
              <span className="display text-right text-[24px] font-bold leading-none text-ink-soft tabular-nums">
                {r.rank}
              </span>
              <span className="flex min-w-0 items-center gap-3">
                {r.player ? (
                  <Headshot
                    playerId={r.player.id}
                    name={r.player.name}
                    team={r.team}
                    season={season}
                    size={40}
                  />
                ) : (
                  <TeamLogo team={r.team} size={36} />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-semibold">
                    {r.player ? (
                      <Link
                        to={`/player/${r.player.id}?season=${season}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {r.player.name}
                      </Link>
                    ) : (
                      <Link to={`/team/${r.team}`} className="display text-[20px] font-bold">
                        {r.team}
                      </Link>
                    )}
                  </span>
                  <span className="inline-flex items-center text-[12px] text-ink-soft">
                    {r.player && (
                      <Link
                        to={`/team/${r.team}`}
                        className="display inline-flex items-center gap-1 text-[14px] font-bold text-ink"
                      >
                        <TeamLogo team={r.team} size={16} />
                        {r.team}
                      </Link>
                    )}
                    {r.player ? ", " : ""}
                    {r.count} {countLabel}
                  </span>
                </span>
              </span>
              <span aria-hidden className="hidden h-3 sm:block">
                <span
                  className="block h-full"
                  style={{
                    width: `${w}%`,
                    background: r.value < 0 ? "var(--goal)" : "var(--ink)",
                  }}
                />
              </span>
              <span
                className={`text-right text-[15px] font-semibold tabular-nums ${r.value < 0 ? "down" : ""}`}
              >
                {value}
              </span>
            </li>
          );
        })}
      </ol>
    </>
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
  const group = GROUPS.find((g) => g.tabs.includes(tab))!;
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
        className="mt-6 flex gap-6 border-b-2 border-ink"
      >
        {GROUPS.map((g) => (
          <button
            key={g.label}
            role="tab"
            aria-selected={group === g}
            onClick={() => setTab(g.tabs[0]!)}
            className={`display -mb-[2px] border-b-4 pb-1 text-[22px] font-bold ${group === g ? "border-ink text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
          >
            {g.label}
          </button>
        ))}
      </div>
      {group.tabs.length > 1 && (
        <div role="group" aria-label={`${group.label} views`} className="mt-3 flex flex-wrap gap-1">
          {group.tabs.map((id) => {
            const t = TABS.find((x) => x.id === id)!;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
                className={`rounded-[var(--radius)] px-3 py-1 text-[14px] ${tab === id ? "bg-ink font-semibold text-ice" : "text-ink-soft hover:bg-ice-land hover:text-ink"}`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}
      <p className="mt-3 max-w-[70ch] text-[14px] text-ink-soft">{active.blurb}</p>
      <div className="mt-4" role="tabpanel">
        {tab === "tremors" ? (
          <TopTremors season={season} />
        ) : tab === "lottery" ? (
          <Lottery />
        ) : tab === "energy" ? (
          <Energy />
        ) : (
          <LeaderBoard season={season} kind={tab} />
        )}
      </div>
    </div>
  );
}
