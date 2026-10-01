import { Link, useParams } from "react-router";
import { useTeam } from "../api/client";
import type { RootingLine } from "../api/types.gen";
import { Bars } from "../charts/Bars";
import { SeasonSeismogram, TeamRing, type Spike } from "../charts/TeamBoard";
import { useWidth } from "../charts/useWidth";
import { localTime, pct, pp } from "../lib/format";
import { useDocumentMeta } from "../lib/meta";
import { useMyTeam } from "../lib/myTeam";
import { TremorLine } from "../panels/TremorFeed";
import { Alerts } from "../panels/Alerts";
import { Headshot } from "../components/Headshot";
import { seasonOf } from "../lib/season";

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
    <section aria-labelledby={id} className="pt-10 pb-2">
      <h2 id={id} className="display mb-4 text-[30px] font-bold">
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
  const spikes: Spike[] = [...data.tremors_for, ...data.tremors_against].flatMap((tr) => {
    const d = tr.deltas.find((x) => x.team === abbrev);
    // A goal that did not move this team's odds (under 0.05 pp) is not part
    // of its season story.
    if (!d || Math.abs(d.d_playoffs) < 0.0005) return [];
    return [
      {
        id: tr.id,
        t: Date.parse(tr.created_at),
        v: d.p_playoffs_after,
        magnitude: tr.magnitude,
        up: d.d_playoffs > 0,
        label: `Magnitude ${tr.magnitude.toFixed(1)}: ${tr.scorer?.name ?? "Goal"} (${tr.team}), ${pp(d.d_playoffs)} for ${abbrev}`,
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

  const status =
    data.clinch?.status === "clinched"
      ? "Clinched a playoff spot"
      : data.clinch?.status === "eliminated"
        ? "Eliminated from the playoffs"
        : data.clinch?.magic_number != null
          ? `Magic number ${data.clinch.magic_number}`
          : null;

  return (
    <div className="w-full">
      <header
        className="border-b border-ice-scratch bg-ice-land"
        style={{ borderTop: `6px solid ${t.color_primary}` }}
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:flex-row sm:items-center md:px-6">
          <TeamRing code={abbrev} odds={o?.p_playoffs ?? null} color={t.color_primary} />
          <div className="min-w-0 flex-1">
            <h1 className="display text-[48px] font-extrabold leading-[0.9] md:text-[76px]">
              {t.name}
            </h1>
            <p className="mt-2 text-[15px] text-ink/80">
              {t.division} Division, {t.conference} Conference. Home ice: {t.arena}.
            </p>
            {o && (
              <dl className="mt-5 grid max-w-xl grid-cols-3 divide-x divide-ice-scratch border-y border-ice-scratch">
                {[
                  ["Division title", pct(o.p_division)],
                  ["Stanley Cup", pct(o.p_cup)],
                  ["Projected points", String(Math.round(o.exp_points))],
                ].map(([k, v]) => (
                  <div key={k} className="px-3 py-2 first:pl-0">
                    <dt className="text-[12px] text-ink/80">{k}</dt>
                    <dd className="display text-[30px] font-bold leading-none tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
              {status && <span className="font-semibold">{status}</span>}
              <button
                type="button"
                onClick={() => setTeam(myTeam === abbrev ? null : abbrev)}
                className="font-semibold text-blue-line"
              >
                {myTeam === abbrev ? "This is my team" : "Make this my team"}
              </button>
              <Alerts team={abbrev} />
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl px-4 pb-12 md:px-6">
        <div ref={ref} className="mt-6">
          <Section title="Odds over the season" id="hist-h">
            <SeasonSeismogram
              width={width}
              points={toSeries("p_playoffs")}
              spikes={spikes}
              label={`${t.name} playoff odds over the season, with the biggest goals for and against`}
            />
            {toSeries("p_playoffs").length > 0 && (
              <p className="mt-2 max-w-[56ch] text-[13px] text-ink-soft">
                The trace is {t.name} playoff odds. Spikes are the season's biggest goals: up and
                blue for them, down and red against them, longer for higher magnitude. Select one to
                see everyone it moved.
              </p>
            )}
          </Section>

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
                    <h3 className="mb-1 text-[13px] font-semibold text-ink-soft">
                      Their own games
                    </h3>
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
                      <td className="py-1.5">
                        <Link
                          to={`/player/${p.player.id}`}
                          className="inline-flex items-center gap-2 underline-offset-4 hover:underline"
                        >
                          <Headshot
                            playerId={p.player.id}
                            name={p.player.name}
                            team={abbrev}
                            season={seasonOf(new Date().toISOString().slice(0, 10))}
                            size={28}
                          />
                          {p.player.name}
                        </Link>
                      </td>
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
          <details className="group pt-10">
            <summary className="display cursor-pointer text-[22px] font-bold text-ink-soft">
              Embed these odds on your site
            </summary>
            <p className="mt-3 text-[14px] text-ink-soft">
              A live gauge for your site or blog. It refreshes every minute.
            </p>
            <pre
              tabIndex={0}
              className="mt-2 overflow-x-auto rounded-[var(--radius)] bg-ice-land p-3 text-[12px]"
            >
              {`<iframe src="${typeof window !== "undefined" ? window.location.origin : ""}/embed/${abbrev}" width="320" height="130" style="border:0" title="${t.name} playoff odds"></iframe>`}
            </pre>
          </details>
        </div>
      </div>
    </div>
  );
}
