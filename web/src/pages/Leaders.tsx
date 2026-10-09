import { useState } from "react";
import { Link, useSearchParams } from "react-router";
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
      "Playoff Probability Added: the playoff-odds impact of a player's goals, added across the situations in which they happened.",
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

function LoadError({ name, retry }: { name: string; retry: () => void }) {
  return (
    <div role="alert" className="py-8">
      <p className="font-semibold">Could not load {name}.</p>
      <p className="mt-1 text-[14px] text-ink-soft">
        The data request failed. Try again to refresh this view.
      </p>
      <button
        type="button"
        onClick={retry}
        className="mt-3 min-h-[44px] rounded-[var(--radius)] border border-ink px-4 font-semibold"
      >
        Retry {name}
      </button>
    </div>
  );
}

function LeaderBoard({
  season,
  kind,
  search,
}: {
  season: number;
  kind: LeadersResponse["kind"];
  search: string;
}) {
  const { data, isLoading, isError, refetch } = useLeaders(season, kind);
  const [visible, setVisible] = useState(20);
  const name = TABS.find((t) => t.id === kind)!.label;
  if (isLoading)
    return (
      <p role="status" className="py-8 text-ink-soft">
        Loading {name.toLowerCase()} for this season…
      </p>
    );
  if (isError)
    return (
      <LoadError
        name={name}
        retry={() => {
          void refetch();
        }}
      />
    );
  if (!data || data.rows.length === 0)
    return (
      <p className="py-8 text-ink-soft">
        No {name.toLowerCase()} entries recorded for this season yet.
      </p>
    );
  const matching = data.rows.filter((r) =>
    `${r.player?.name ?? ""} ${r.team}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const max = Math.max(...data.rows.map((r) => Math.abs(r.value)), 1e-9);
  const [one, many] =
    kind === "goalie"
      ? ["goal allowed", "goals allowed"]
      : kind === "assist"
        ? ["assist", "assists"]
        : kind === "penalty_cost"
          ? ["penalty", "penalties"]
          : kind === "drawn"
            ? ["drawn", "drawn"]
            : kind === "giveaway_cost"
              ? ["costly giveaway", "costly giveaways"]
              : kind === "plus_minus" || kind === "on_ice"
                ? ["goal on ice", "goals on ice"]
                : ["goal", "goals"];
  const countLabel = (n: number) => (n === 1 ? one : many);
  const partial = data.onice_coverage != null && data.onice_coverage < 0.99;
  return (
    <>
      {partial && (
        <p className="mb-2 text-[12px] text-ink-soft">
          The NHL has no shift data for {Math.round((1 - data.onice_coverage!) * 100)}% of this
          season's goals; this board leaves them out.
        </p>
      )}
      <p role="status" className="mb-3 text-[12px] text-ink-soft">
        {matching.length
          ? search.trim()
            ? `${matching.length} ${matching.length === 1 ? "match" : "matches"}, shown at their place on the full board.`
            : visible < matching.length
              ? `Top ${visible} of ${matching.length}.`
              : `All ${matching.length}.`
          : "No player or team matches your search in this board."}
      </p>
      <ol aria-label={`${name} rankings`} className="divide-y divide-ice-scratch">
        {matching.slice(0, visible).map((r) => {
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
              className="grid grid-cols-[1.75rem_minmax(0,1fr)_4.75rem] items-center gap-x-2 py-3 sm:grid-cols-[2.5rem_minmax(0,19rem)_1fr_5.5rem]"
            >
              <span className="display text-right text-[24px] font-bold leading-none text-ink-soft tabular-nums">
                {r.rank}
              </span>
              <span className="flex min-w-0 items-center gap-2 sm:gap-3">
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
                        className="inline-flex min-h-[44px] items-center underline-offset-4 hover:underline sm:min-h-[24px]"
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
                        className="display inline-flex min-h-[44px] items-center gap-1 text-[14px] font-bold text-ink sm:min-h-[24px]"
                      >
                        <TeamLogo team={r.team} size={16} />
                        {r.team}
                      </Link>
                    )}
                    {r.player ? ", " : ""}
                    {r.count} {countLabel(r.count)}
                  </span>
                </span>
              </span>
              <span aria-hidden className="hidden h-3 sm:block">
                <span
                  className="block h-full"
                  style={{
                    width: `${w}%`,
                    // Only the leader's bar is full ink; the rest stay quiet
                    // so twenty bars do not outweigh the names.
                    background:
                      r.value < 0
                        ? "color-mix(in srgb, var(--goal) 55%, transparent)"
                        : r.rank === 1
                          ? "var(--ink)"
                          : "color-mix(in srgb, var(--ink) 32%, transparent)",
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
      {matching.length > visible && (
        <button
          type="button"
          onClick={() => setVisible((v) => v + 20)}
          className="mt-4 min-h-[44px] rounded-[var(--radius)] border border-ink px-5 text-[14px] font-semibold"
        >
          Show more ({matching.length - visible} remaining)
        </button>
      )}
    </>
  );
}

const SEASON_COLORS = ["var(--ink-soft)", "var(--blue-line)", "var(--goal)"];

function Energy() {
  const { data, isLoading, isError, refetch } = useEnergy();
  const [ref, width] = useWidth<HTMLDivElement>(700);
  if (isLoading)
    return (
      <p role="status" className="py-8 text-ink-soft">
        Loading season energy…
      </p>
    );
  if (isError)
    return (
      <LoadError
        name="Season energy"
        retry={() => {
          void refetch();
        }}
      />
    );
  if (!data?.some((s) => s.points.length))
    return <p className="py-8 text-ink-soft">No season energy data is available yet.</p>;
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
  const { data, isLoading, isError, refetch } = useStateQuery();
  const rows = [...(data?.odds ?? [])]
    .sort((a, b) => (b.p_bottom3 ?? 0) - (a.p_bottom3 ?? 0))
    .slice(0, 12);
  if (isLoading)
    return (
      <p role="status" className="py-8 text-ink-soft">
        Loading current-season lottery watch…
      </p>
    );
  if (isError)
    return (
      <LoadError
        name="Lottery watch"
        retry={() => {
          void refetch();
        }}
      />
    );
  if (!rows.length)
    return (
      <p className="py-8 text-ink-soft">No current-season lottery projections are available yet.</p>
    );
  return (
    <table className="w-full text-[12px] sm:text-[14px]">
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
  const { data, isLoading, isError, refetch } = useTremors(season, "magnitude", 100);
  const [visible, setVisible] = useState(20);
  const myTeam = useMyTeam((s) => s.team);
  if (isLoading)
    return (
      <p role="status" className="py-8 text-ink-soft">
        Loading top tremors for this season…
      </p>
    );
  if (isError)
    return (
      <LoadError
        name="Top tremors"
        retry={() => {
          void refetch();
        }}
      />
    );
  if (!data || data.items.length === 0)
    return <p className="text-ink-soft">No tremors recorded for this season yet.</p>;
  return (
    <>
      <ol aria-label="Top tremor rankings" className="divide-y divide-ice-scratch">
        {data.items.slice(0, visible).map((t, i) => (
          <li key={t.id} className="grid grid-cols-[2rem_1fr] items-center">
            <span className="tabular-nums text-[13px] text-ink-soft">{i + 1}</span>
            <TremorLine t={t} myTeam={myTeam} />
          </li>
        ))}
      </ol>
      {data.items.length > visible && (
        <button
          type="button"
          onClick={() => setVisible((v) => v + 20)}
          className="mt-4 min-h-[44px] rounded-[var(--radius)] border border-ink px-5 text-[14px] font-semibold"
        >
          Show more ({data.items.length - visible} remaining)
        </button>
      )}
    </>
  );
}

export default function LeadersPage() {
  const [params, setParams] = useSearchParams();
  const requestedSeason = Number(params.get("season"));
  const season = SEASONS.some((s) => s.id === requestedSeason) ? requestedSeason : SEASONS[0]!.id;
  const requestedView = params.get("view");
  const tab: Tab = TABS.some((t) => t.id === requestedView) ? (requestedView as Tab) : "skater";
  const [search, setSearch] = useState("");
  const selectView = (view: Tab, selectedSeason = season) => {
    const next = new URLSearchParams(params);
    next.set("season", String(selectedSeason));
    next.set("view", view);
    setParams(next);
    setSearch("");
  };
  const seasonLabel = SEASONS.find((s) => s.id === season)!.label;
  const searchable = tab !== "tremors" && tab !== "energy" && tab !== "lottery";
  const active = TABS.find((t) => t.id === tab)!;
  const group = GROUPS.find((g) => g.tabs.includes(tab))!;
  useDocumentMeta(
    "Leaders",
    "Playoff Probability Added leaders and the biggest goals of the season.",
  );
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[38px] font-extrabold leading-none sm:text-[60px]">
            Leaders
          </h1>
          <p className="mt-3 max-w-[50ch] text-[15px] text-ink-soft">
            The goals, players and teams that moved the playoff race.
          </p>
        </div>
        <label className="text-[13px] text-ink-soft">
          Season{" "}
          <select
            aria-label="Season"
            value={season}
            disabled={tab === "lottery" || tab === "energy"}
            onChange={(e) => selectView(tab, Number(e.target.value))}
            className="ml-1 rounded-[var(--radius)] border border-ice-scratch bg-surface min-h-[44px] px-3 text-ink"
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
        role="group"
        aria-label="Leaderboards"
        className="mt-8 grid grid-cols-2 gap-x-4 border-b-2 border-ink sm:flex sm:gap-8"
      >
        {GROUPS.map((g) => (
          <button
            key={g.label}
            type="button"
            aria-pressed={group === g}
            onClick={() => selectView(g.tabs[0]!)}
            className={`display -mb-[2px] min-h-[44px] border-b-4 py-2 text-left text-[24px] font-bold ${group === g ? "border-ink text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
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
                onClick={() => selectView(id)}
                className={`rounded-[var(--radius)] min-h-[44px] px-3 py-2 text-[14px] ${tab === id ? "bg-ink font-semibold text-ice" : "text-ink-soft hover:bg-ice-land hover:text-ink"}`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}
      <section aria-labelledby="leader-view-title" className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-ice-scratch pb-3">
          <h2 id="leader-view-title" className="display text-[38px] font-bold leading-none">
            {active.label}
          </h2>
          <p className="text-[13px] font-semibold">
            {tab === "lottery"
              ? `${SEASONS[0]!.label} current season only`
              : tab === "energy"
                ? "Three-season comparison"
                : `${seasonLabel}${season === SEASONS[0]!.id ? " current season" : " selected season"}`}
          </p>
        </div>
        <p className="mt-3 max-w-[70ch] text-[14px] text-ink-soft">{active.blurb}</p>
        {tab === "lottery" && season !== SEASONS[0]!.id && (
          <p className="mt-2 text-[13px] font-semibold">
            Lottery watch uses current-season projections, regardless of the selected {seasonLabel}{" "}
            season.
          </p>
        )}
        {searchable && (
          <label className="mt-5 block max-w-md text-[13px] font-semibold">
            Find a player or team
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Player name or team code"
              aria-describedby="leaders-search-scope"
              className="mt-2 block min-h-[44px] w-full rounded-[var(--radius)] border border-ice-scratch bg-surface px-3 text-[15px] text-ink"
            />
            <span
              id="leaders-search-scope"
              className="mt-2 block text-[12px] font-normal text-ink-soft"
            >
              Find a player or team in this {seasonLabel} board.
            </span>
          </label>
        )}
        <div className="mt-5">
          {tab === "tremors" ? (
            <TopTremors key={season} season={season} />
          ) : tab === "lottery" ? (
            <Lottery />
          ) : tab === "energy" ? (
            <Energy />
          ) : (
            <LeaderBoard
              key={`${season}-${tab}-${search}`}
              season={season}
              kind={tab}
              search={search}
            />
          )}
        </div>
      </section>
      <details className="mt-8 border-t border-ice-scratch pt-4 text-[14px]">
        <summary className="min-h-[44px] cursor-pointer font-semibold">
          How to read playoff probability added
        </summary>
        <p className="mt-2 max-w-[70ch] text-ink-soft">
          PPA sums individual goal impacts across their game and standings contexts. It is not the
          team's net change over a season or a rating of player skill. Assists and on-ice credit can
          share the same goal's impact, so these boards should not be added together.
        </p>
        <p className="mt-3 max-w-[70ch] text-ink-soft">
          Hypothetical example: a goal moves playoff odds from 40% to 43%. That adds 3 percentage
          points (pp), not 3 percent. Another goal adding 2 pp brings the summed impact to 5 pp,
          even if other results later lower the team's odds.
        </p>
        <Link
          to="/method"
          className="mt-3 inline-flex min-h-[44px] items-center font-semibold text-blue-line underline underline-offset-4"
        >
          Read the method
        </Link>
      </details>
    </div>
  );
}
