import { Link, useParams } from "react-router";
import { useTeam } from "../api/client";
import type { RootingLine } from "../api/types.gen";
import { Bars } from "../charts/Bars";
import { LineChart } from "../charts/LineChart";
import { useWidth } from "../charts/useWidth";
import { localTime, pct, pp } from "../lib/format";
import { useDocumentMeta } from "../lib/meta";
import { useMyTeam } from "../lib/myTeam";
import { TremorLine } from "../panels/TremorFeed";
import { Alerts } from "../panels/Alerts";

const SEED_LABELS: Record<string, string> = {
  div1: "1st in division",
  div2: "2nd",
  div3: "3rd",
  wc1: "Wild card 1",
  wc2: "Wild card 2",
  out: "Out",
};

const OUTCOME_WORDS: Record<string, string> = {
  home_reg: "in regulation",
  home_ot: "in overtime",
  home_so: "in a shootout",
  away_reg: "in regulation",
  away_ot: "in overtime",
  away_so: "in a shootout",
};

function outcomeText(line: RootingLine, key: string): string {
  const winner = key.startsWith("home") ? line.home : line.away;
  return `${winner} ${OUTCOME_WORDS[key] ?? ""}`;
}

function Section({
  title,
  children,
  id,
}: {
  title: string;
  children: React.ReactNode;
  id: string;
}) {
  return (
    <section aria-labelledby={id} className="border-t border-ice-scratch py-5">
      <h2 id={id} className="mb-3 text-[17px] font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function TeamPage() {
  const abbrev = (useParams().abbrev ?? "").toUpperCase();
  const { data, isLoading, isError } = useTeam(abbrev);
  const [ref, width] = useWidth<HTMLDivElement>(720);
  const { team: myTeam, setTeam } = useMyTeam();
  useDocumentMeta(
    data ? `${data.team.name} playoff odds` : abbrev,
    data?.odds
      ? `${data.team.name}: ${pct(data.odds.p_playoffs)} to make the playoffs.`
      : undefined,
    `/api/og/team/${abbrev}.png`,
  );

  if (isLoading) return <div className="p-6 text-ink-soft">Loading {abbrev}</div>;
  if (isError || !data)
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <h1 className="display text-[38px] font-bold">No team called {abbrev}</h1>
        <Link to="/" className="mt-4 inline-block text-blue-line underline underline-offset-4">
          Back to tonight
        </Link>
      </div>
    );

  const t = data.team;
  const o = data.odds;
  const history = data.history;
  const toSeries = (k: string) =>
    (history[k] ?? []).map((p) => ({ t: Date.parse(p.t), v: p.value }));
  const markers = [...data.tremors_for, ...data.tremors_against].flatMap((tr) => {
    const d = tr.deltas.find((x) => x.team === abbrev);
    if (!d) return [];
    return [
      {
        t: Date.parse(tr.created_at),
        v: d.p_playoffs_after,
        kind: d.d_playoffs > 0 ? ("up" as const) : ("down" as const),
        label: `${tr.scorer?.name ?? "Goal"} (${tr.team}), ${pp(d.d_playoffs)}`,
      },
    ];
  });
  const hist = data.points_hist.map((b) => ({ label: String(b.x), value: b.p }));
  const seeds = Object.entries(SEED_LABELS).map(([k, label]) => ({
    label: label.replace("Wild card ", "WC").replace(" in division", "").replace("Out", "Out"),
    value: data.seed_dist[k] ?? 0,
    highlight: k === "out" ? false : undefined,
  }));
  const others = data.rooting.filter((r) => !r.involves_team);
  const own = data.rooting.filter((r) => r.involves_team);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 h-1 w-10" style={{ background: t.color_primary }} aria-hidden />
          <h1 className="display text-[44px] font-extrabold leading-none md:text-[60px]">
            {t.name}
          </h1>
          <p className="mt-2 text-[14px] text-ink-soft">
            {t.division} Division, {t.conference} Conference. Home: {t.arena}.
          </p>
        </div>
        <div className="text-right">
          <div className="text-[13px] text-ink-soft">Playoff odds</div>
          <div className="display text-[60px] font-extrabold leading-none tabular-nums">
            {o ? pct(o.p_playoffs) : "-"}
          </div>
          {o && (
            <div className="text-[13px] text-ink-soft">
              Cup {pct(o.p_cup)}, division {pct(o.p_division)}, projected {Math.round(o.exp_points)}{" "}
              points
            </div>
          )}
          {data.clinch && (
            <div className="mt-1 text-[13px] font-semibold">
              {data.clinch.status === "clinched"
                ? "Clinched a playoff spot"
                : data.clinch.status === "eliminated"
                  ? "Eliminated from the playoffs"
                  : data.clinch.magic_number != null && (
                      <span title="Points this team earns plus points its fifth-closest rival fails to earn, needed to guarantee a spot">
                        Magic number {data.clinch.magic_number}
                      </span>
                    )}
            </div>
          )}
          <button
            type="button"
            onClick={() => setTeam(myTeam === abbrev ? null : abbrev)}
            className="mt-2 text-[13px] font-semibold text-blue-line"
          >
            {myTeam === abbrev ? "This is my team" : "Make this my team"}
          </button>
          <Alerts team={abbrev} />
        </div>
      </header>

      <div ref={ref} className="mt-6">
        <Section title="Odds over the season" id="hist-h">
          <LineChart
            width={width}
            ariaLabel={`${t.name} playoff, division, and Cup odds over the season`}
            series={[
              { name: "Playoffs", color: "var(--ink)", points: toSeries("p_playoffs") },
              { name: "Division", color: "var(--blue-line)", points: toSeries("p_division") },
              { name: "Cup", color: "var(--goal)", points: toSeries("p_cup"), dashed: true },
            ]}
            markers={markers}
          />
          <p className="mt-2 text-[12px] text-ink-soft">
            Dots mark the season's biggest tremors for (blue) and against (red) this team.
          </p>
        </Section>

        <div className="grid gap-x-10 md:grid-cols-2">
          <Section title="Final points, simulated" id="pts-h">
            <Bars
              data={hist}
              width={Math.min(width, 460)}
              ariaLabel="Distribution of final points"
              showEvery={5}
              formatValue={(v) => pct(v)}
            />
          </Section>
          <Section title="Where they finish" id="seed-h">
            <Bars
              data={seeds}
              width={Math.min(width, 460)}
              ariaLabel="Distribution of playoff seed"
              formatValue={(v) => pct(v, 0)}
            />
          </Section>
        </div>

        <Section title="Who to root for this week" id="root-h">
          {data.rooting.length === 0 ? (
            <p className="text-[14px] text-ink-soft">
              No game in the next seven days moves these odds by more than the simulation can
              resolve.
            </p>
          ) : (
            <div className="grid gap-x-10 md:grid-cols-2">
              <ul className="divide-y divide-ice-scratch">
                {others.slice(0, 10).map((r) => (
                  <li key={r.game_id} className="py-2 text-[14px]">
                    <div className="flex items-baseline justify-between gap-2">
                      <span>
                        Root for <strong>{r.root_for}</strong>{" "}
                        <span className="text-ink-soft">
                          ({r.away} at {r.home}, {localTime(r.start_utc, { weekday: "short" })})
                        </span>
                      </span>
                      <span className="tabular-nums">{pp(Math.abs(r.impact))}</span>
                    </div>
                    <div className="text-[12px] text-ink-soft">
                      Best: {outcomeText(r, r.best_outcome)}. Worst:{" "}
                      {outcomeText(r, r.worst_outcome)}.
                    </div>
                  </li>
                ))}
              </ul>
              {own.length > 0 && (
                <div>
                  <h3 className="mb-1 text-[13px] font-semibold text-ink-soft">Their own games</h3>
                  <ul className="divide-y divide-ice-scratch">
                    {own.map((r) => (
                      <li key={r.game_id} className="flex justify-between py-2 text-[14px]">
                        <span>
                          {r.away} at {r.home}, {localTime(r.start_utc, { weekday: "short" })}
                        </span>
                        <span className="tabular-nums">{pp(Math.abs(r.impact))} swing</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Section>

        <div className="grid gap-x-10 md:grid-cols-2">
          <Section title="Biggest tremors for" id="for-h">
            <ul className="divide-y divide-ice-scratch">
              {data.tremors_for.map((tr) => (
                <li key={tr.id}>
                  <TremorLine t={tr} myTeam={abbrev} />
                </li>
              ))}
              {data.tremors_for.length === 0 && (
                <li className="text-[14px] text-ink-soft">None yet this season.</li>
              )}
            </ul>
          </Section>
          <Section title="Biggest tremors against" id="against-h">
            <ul className="divide-y divide-ice-scratch">
              {data.tremors_against.map((tr) => (
                <li key={tr.id}>
                  <TremorLine t={tr} myTeam={abbrev} />
                </li>
              ))}
              {data.tremors_against.length === 0 && (
                <li className="text-[14px] text-ink-soft">None yet this season.</li>
              )}
            </ul>
          </Section>
        </div>

        <Section title="Embed these odds" id="embed-h">
          <p className="text-[14px] text-ink-soft">
            A live gauge for your site or blog. It refreshes every minute.
          </p>
          <pre className="mt-2 overflow-x-auto rounded-[var(--radius)] bg-ice-land p-3 text-[12px]">
            {`<iframe src="${typeof window !== "undefined" ? window.location.origin : ""}/embed/${abbrev}" width="320" height="130" style="border:0" title="${t.name} playoff odds"></iframe>`}
          </pre>
        </Section>

        <div className="grid gap-x-10 md:grid-cols-2">
          <Section title="Coming up" id="sched-h">
            <table className="w-full text-[14px]">
              <thead className="text-left text-[12px] text-ink-soft">
                <tr>
                  <th className="font-normal">Game</th>
                  <th className="text-right font-normal">Win</th>
                  <th className="w-24 font-normal">
                    <span className="sr-only">Difficulty</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.remaining.slice(0, 12).map((g) => (
                  <tr key={g.game_id} className="border-t border-ice-scratch">
                    <td className="py-1.5">
                      <Link to={`/game/${g.game_id}`} className="hover:underline">
                        {g.home ? "vs" : "at"} {g.opponent}
                      </Link>{" "}
                      <span className="text-ink-soft">
                        {new Date(g.start_utc).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </td>
                    <td className="text-right tabular-nums">{pct(g.p_win, 0)}</td>
                    <td className="pl-3">
                      <div
                        className="h-1.5 rounded-full bg-ice-scratch"
                        role="img"
                        aria-label={`Win probability ${pct(g.p_win)}`}
                      >
                        <div
                          className="h-full rounded-full bg-ink"
                          style={{ width: `${g.p_win * 100}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <Section title="Playoff Probability Added" id="ppa-h">
            <table className="w-full text-[14px]">
              <thead className="text-left text-[12px] text-ink-soft">
                <tr>
                  <th className="font-normal">Player</th>
                  <th className="text-right font-normal">Goals</th>
                  <th className="text-right font-normal">PPA</th>
                  <th className="text-right font-normal">Assist PPA</th>
                </tr>
              </thead>
              <tbody>
                {data.players.map((p) => (
                  <tr key={p.player.id} className="border-t border-ice-scratch">
                    <td className="py-1.5">{p.player.name}</td>
                    <td className="text-right tabular-nums">{p.goals}</td>
                    <td className="text-right tabular-nums">{pp(p.ppa)}</td>
                    <td className="text-right tabular-nums text-ink-soft">{pp(p.assist_ppa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.players.length === 0 && (
              <p className="text-[14px] text-ink-soft">No goals yet this season.</p>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
