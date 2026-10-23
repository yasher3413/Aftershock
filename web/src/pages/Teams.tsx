import { Link } from "react-router";
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
// Secondary columns appear as the screen widens; the phone keeps team, points and odds.
const COL = "hidden w-11 py-2 font-normal";
const CELL = "hidden py-2.5 text-ink-soft";
const NAMES: Record<string, string> = Object.fromEntries(TEAMS.map((t) => [t.abbrev, t.name]));

function Division({
  name,
  rows,
  odds,
}: {
  name: string;
  rows: StandingsRow[];
  odds: Record<string, TeamOdds>;
}) {
  const myTeam = useMyTeam((s) => s.team);
  return (
    <section aria-labelledby={`div-${name}`}>
      <h3 id={`div-${name}`} className="display text-[24px] font-bold">
        {name}
      </h3>
      <table className="mt-2 w-full text-[14px]">
        <thead>
          <tr className="border-b border-ice-scratch text-right text-[12px] text-ink-soft">
            <th className="w-7 py-2 text-left font-normal">
              <span className="sr-only">Division rank</span>
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
          {rows.map((r) => {
            const o = odds[r.team];
            const wildcard =
              r.wildcard_rank != null && r.wildcard_rank >= 1 && r.wildcard_rank <= 2;
            const diff = r.gf - r.ga;
            return (
              <tr
                key={r.team}
                className={`border-b ${r.division_rank === 3 ? "border-ink/50" : "border-ice-scratch"} ${r.team === myTeam ? "bg-surface font-semibold" : ""}`}
              >
                <td className="py-2.5 text-left text-ink-soft">{r.division_rank}</td>
                <td className="py-1 text-left">
                  <Link
                    to={`/team/${r.team}`}
                    className="flex min-h-[40px] items-center gap-2 hover:underline"
                  >
                    <TeamLogo team={r.team} size={24} />
                    <span className="display text-[17px] font-bold sm:hidden">{r.team}</span>
                    <span className="hidden whitespace-nowrap sm:inline">
                      {NAMES[r.team] ?? r.team}
                    </span>
                    {wildcard && (
                      <span className="text-[11px] font-semibold text-ink-soft" title="Wild card">
                        WC{r.wildcard_rank}
                      </span>
                    )}
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

export default function TeamsPage() {
  const { data, isPending, isError, refetch } = useStateQuery();
  useDocumentMeta("Teams", "Every NHL team's playoff and Stanley Cup odds, by division.");
  if (isPending) return <PageLoading label="Loading the teams" />;
  if (isError || !data) return <Unreachable onRetry={() => void refetch()} />;
  const odds = Object.fromEntries(data.odds.map((o) => [o.team, o]));
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-12">
      <h1 className="display text-[38px] font-extrabold leading-none sm:text-[60px]">Teams</h1>
      <p className="mt-3 max-w-[60ch] text-[15px] text-ink-soft">
        Every club's chance of making the playoffs and winning the Cup, from the latest run of the
        season simulation. The top three in each division make it, plus two wild cards per
        conference (WC1 and WC2).
      </p>
      {CONFERENCES.map((conf) => (
        <section key={conf} aria-labelledby={`conf-${conf}`} className="mt-10">
          <h2
            id={`conf-${conf}`}
            className="display border-b border-ink pb-2 text-[30px] font-bold"
          >
            {conf} Conference
          </h2>
          <div className="mt-5 space-y-8">
            {DIVISIONS.filter((d) => d.conference === conf).map((d) => (
              <Division
                key={d.name}
                name={d.name}
                odds={odds}
                rows={data.standings
                  .filter((r) => r.division === d.name)
                  .sort((a, b) => a.division_rank - b.division_rank)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
