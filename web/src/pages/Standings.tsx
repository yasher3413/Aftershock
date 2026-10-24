import { Link, useSearchParams } from "react-router";
import { useStateQuery } from "../api/client";
import type { StandingsRow, TeamOdds } from "../api/types.gen";
import { TeamLogo } from "../components/TeamLogo";
import { PageLoading } from "../components/PageLoading";
import { Unreachable } from "../components/PageMessage";
import { pct } from "../lib/format";
import { useDocumentMeta } from "../lib/meta";
import { useMyTeam } from "../lib/myTeam";
import { DIVISIONS, TEAMS } from "../lib/teams";

const CONFERENCES = ["Eastern", "Western"] as const;
const VIEWS = [
  { id: "division", label: "Division" },
  { id: "wildcard", label: "Wild card" },
  { id: "conference", label: "Conference" },
  { id: "league", label: "League" },
] as const;
type View = (typeof VIEWS)[number]["id"];

// Secondary columns appear as the screen widens; the phone keeps team, points and odds.
const COL = "hidden w-11 py-2 font-normal";
const CELL = "hidden py-2.5 text-ink-soft";
const NAMES: Record<string, string> = Object.fromEntries(TEAMS.map((t) => [t.abbrev, t.name]));

/** In a playoff position today: top three in the division or a top-two wild card. */
const inPosition = (r: StandingsRow) =>
  r.division_rank <= 3 || (r.wildcard_rank != null && r.wildcard_rank >= 1 && r.wildcard_rank <= 2);

function Table({
  title,
  rows,
  odds,
  rank,
  cutAfter,
  markPosition = false,
}: {
  title: string;
  rows: StandingsRow[];
  odds: Record<string, TeamOdds>;
  rank: (r: StandingsRow) => number | string;
  /** Draw the playoff line under this many rows. */
  cutAfter?: number;
  /** Where the line cannot be drawn (conference, league), mark each team in a spot. */
  markPosition?: boolean;
}) {
  const myTeam = useMyTeam((s) => s.team);
  const id = `t-${title.replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id}>
      <h3 id={id} className="display text-[24px] font-bold">
        {title}
      </h3>
      <table className="mt-2 w-full text-[14px]">
        <thead>
          <tr className="border-b border-ice-scratch text-right text-[12px] text-ink-soft">
            <th className="w-8 py-2 text-left font-normal">
              <span className="sr-only">Rank</span>
            </th>
            <th className="py-2 text-left font-normal">Team</th>
            <th className={`${COL} sm:table-cell`}>GP</th>
            <th className={`${COL} sm:table-cell`}>W</th>
            <th className={`${COL} sm:table-cell`}>L</th>
            <th className={`${COL} sm:table-cell`}>OTL</th>
            <th className="w-12 py-2 font-normal">Pts</th>
            <th className={`${COL} lg:table-cell`}>Diff</th>
            <th className="w-20 py-2 font-normal md:w-44">Playoffs</th>
            <th className={`${COL} w-16 md:table-cell`}>Division</th>
            <th className={`${COL} w-16 md:table-cell`}>Cup</th>
          </tr>
        </thead>
        <tbody className="text-right tabular-nums">
          {rows.map((r, i) => {
            const o = odds[r.team];
            const diff = r.gf - r.ga;
            const line = cutAfter != null && i === cutAfter - 1;
            return (
              <tr
                key={r.team}
                className={`border-b ${line ? "border-ink/60" : "border-ice-scratch"} ${r.team === myTeam ? "bg-surface font-semibold" : ""}`}
              >
                <td className="py-2.5 text-left text-ink-soft">
                  {rank(r)}
                  {markPosition && inPosition(r) && (
                    <span className="sr-only">, in a playoff spot</span>
                  )}
                </td>
                <td className="py-1 text-left">
                  <Link
                    to={`/team/${r.team}`}
                    className="flex min-h-[40px] items-center gap-2 hover:underline"
                  >
                    {markPosition && (
                      <span
                        aria-hidden
                        className={`h-5 w-1 shrink-0 rounded-full ${inPosition(r) ? "bg-ink" : "bg-transparent"}`}
                      />
                    )}
                    <TeamLogo team={r.team} size={24} />
                    <span className="display text-[17px] font-bold sm:hidden">{r.team}</span>
                    <span className="hidden whitespace-nowrap sm:inline">
                      {NAMES[r.team] ?? r.team}
                    </span>
                  </Link>
                </td>
                <td className={`${CELL} sm:table-cell`}>{r.gp}</td>
                <td className={`${CELL} sm:table-cell`}>{r.w}</td>
                <td className={`${CELL} sm:table-cell`}>{r.l}</td>
                <td className={`${CELL} sm:table-cell`}>{r.otl}</td>
                <td className="py-2.5 font-semibold">{r.points}</td>
                <td className={`${CELL} lg:table-cell`}>{diff > 0 ? `+${diff}` : diff}</td>
                <td className="py-2.5">
                  <div className="flex items-center justify-end gap-3">
                    <div
                      className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-ice-scratch md:block"
                      aria-hidden
                    >
                      <div
                        className="h-full bg-ink"
                        style={{ width: `${(o?.p_playoffs ?? 0) * 100}%` }}
                      />
                    </div>
                    <span className="w-12">{pct(o?.p_playoffs)}</span>
                  </div>
                </td>
                <td className={`${CELL} md:table-cell`}>{pct(o?.p_division)}</td>
                <td className={`${CELL} md:table-cell`}>{pct(o?.p_cup)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

const NOTES: Record<View, string> = {
  division: "The top three in each division make the playoffs. The darker line marks third place.",
  wildcard:
    "How the NHL decides the field: the top three in each division, then two wild cards per conference. The darker line marks the last wild card.",
  conference:
    "Each conference by points. A dark bar marks a team in a playoff spot today, as a division top-three team or a wild card.",
  league:
    "All 32 teams by points. A dark bar marks a team in a playoff spot today, as a division top-three team or a wild card.",
};

export default function StandingsPage() {
  const { data, isPending, isError, refetch } = useStateQuery();
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.find((v) => v.id === params.get("view"))?.id ?? "division") as View;
  useDocumentMeta(
    "Standings",
    "NHL standings by division, wild card, conference, and league, with every team's playoff and Stanley Cup odds.",
  );
  if (isPending) return <PageLoading label="Loading the standings" />;
  if (isError || !data) return <Unreachable onRetry={() => void refetch()} />;
  const odds = Object.fromEntries(data.odds.map((o) => [o.team, o]));
  const st = data.standings;
  const byRank = (key: "conference_rank" | "league_rank") => (a: StandingsRow, b: StandingsRow) =>
    a[key] - b[key];
  const inDivision = (d: string) =>
    st.filter((r) => r.division === d).sort((a, b) => a.division_rank - b.division_rank);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-12">
      <h1 className="display text-[38px] font-extrabold leading-none sm:text-[60px]">Standings</h1>
      <p className="mt-3 max-w-[60ch] text-[15px] text-ink-soft">
        Points, records, and each club&apos;s chance of making the playoffs and winning the Cup,
        from the latest run of the season simulation.
      </p>
      <div role="tablist" aria-label="Standings view" className="mt-6 flex flex-wrap gap-1">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={view === v.id}
            onClick={() =>
              setParams(v.id === "division" ? {} : { view: v.id }, {
                replace: true,
                preventScrollReset: true,
              })
            }
            className={`min-h-[44px] rounded-[var(--radius)] px-3.5 text-[14px] ${view === v.id ? "bg-ink font-semibold text-ice" : "text-ink-soft hover:bg-ice-land hover:text-ink"}`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <p className="mt-3 max-w-[70ch] text-[13px] text-ink-soft">{NOTES[view]}</p>

      {view === "league" ? (
        <div className="mt-8">
          <Table
            title="League"
            rows={[...st].sort(byRank("league_rank"))}
            odds={odds}
            rank={(r) => r.league_rank}
            markPosition
          />
        </div>
      ) : (
        CONFERENCES.map((conf) => {
          const divisions = DIVISIONS.filter((d) => d.conference === conf);
          return (
            <section key={conf} aria-labelledby={`conf-${conf}`} className="mt-10">
              <h2
                id={`conf-${conf}`}
                className="display border-b border-ink pb-2 text-[30px] font-bold"
              >
                {conf} Conference
              </h2>
              <div className="mt-5 space-y-8">
                {view === "division" &&
                  divisions.map((d) => (
                    <Table
                      key={d.name}
                      title={d.name}
                      rows={inDivision(d.name)}
                      odds={odds}
                      rank={(r) => r.division_rank}
                      cutAfter={3}
                    />
                  ))}
                {view === "wildcard" && (
                  <>
                    {divisions.map((d) => (
                      <Table
                        key={d.name}
                        title={d.name}
                        rows={inDivision(d.name).slice(0, 3)}
                        odds={odds}
                        rank={(r) => r.division_rank}
                      />
                    ))}
                    <Table
                      title={`${conf} wild card`}
                      rows={st
                        .filter((r) => r.conference === conf && r.division_rank > 3)
                        .sort((a, b) => (a.wildcard_rank ?? 99) - (b.wildcard_rank ?? 99))}
                      odds={odds}
                      rank={(r) =>
                        r.wildcard_rank && r.wildcard_rank <= 2
                          ? `WC${r.wildcard_rank}`
                          : (r.wildcard_rank ?? "")
                      }
                      cutAfter={2}
                    />
                  </>
                )}
                {view === "conference" && (
                  <Table
                    title={`${conf} Conference`}
                    rows={st.filter((r) => r.conference === conf).sort(byRank("conference_rank"))}
                    odds={odds}
                    rank={(r) => r.conference_rank}
                    markPosition
                  />
                )}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
