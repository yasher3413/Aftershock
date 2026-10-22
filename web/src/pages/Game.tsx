import { Link, useParams } from "react-router";
import { useGame } from "../api/client";
import type { GamePreview, Tremor } from "../api/types.gen";
import { LineChart } from "../charts/LineChart";
import { Rink } from "../charts/Rink";
import { useWidth } from "../charts/useWidth";
import { clock, localTime, pct, periodLabel, pp } from "../lib/format";
import { TeamLogo } from "../components/TeamLogo";
import { useDocumentMeta } from "../lib/meta";

function Ripple({ t }: { t: Tremor }) {
  const max = Math.max(...t.deltas.map((d) => Math.abs(d.d_playoffs)), 1e-6);
  const moved = t.deltas.filter((d) => Math.abs(d.d_playoffs) >= 0.0005);
  // The four biggest movers; the tremor page has the rest.
  const shown = moved.slice(0, 4);
  return (
    <div className="py-3">
      <div className="flex items-baseline gap-3">
        <Link to={`/tremor/${t.id}`} className="display text-[28px] font-extrabold">
          {t.magnitude.toFixed(1)}
        </Link>
        <div className="text-[14px]">
          {t.scorer ? (
            <Link
              to={`/player/${t.scorer.id}?season=${t.season}`}
              className="font-semibold underline-offset-4 hover:underline"
            >
              {t.scorer.name}
            </Link>
          ) : (
            <span className="font-semibold">Goal</span>
          )}{" "}
          ({t.team}), {periodLabel(t.period, t.period_type)} {clock(t.t_period_s)}, {t.away}{" "}
          {t.score_after.away}-{t.score_after.home} {t.home}
          {t.overturned && <span className="ml-2 text-ink-soft">Overturned</span>}
        </div>
      </div>
      <ul className="mt-2 grid gap-y-0.5 text-[12px]">
        {shown.map((d) => (
          <li key={d.team} className="grid grid-cols-[2.6rem_1fr_4.2rem] items-center gap-2">
            <span className="display text-[14px] font-bold">{d.team}</span>
            <div className="relative h-2">
              <div className="absolute left-1/2 top-0 h-full w-px bg-ice-scratch" />
              <div
                className={`absolute top-0 h-full ${d.d_playoffs > 0 ? "left-1/2 bg-blue-line" : "right-1/2 bg-goal"}`}
                style={{ width: `${(Math.abs(d.d_playoffs) / max) * 50}%` }}
              />
            </div>
            <span className={`text-right tabular-nums ${d.d_playoffs > 0 ? "up" : "down"}`}>
              {pp(d.d_playoffs)}
            </span>
          </li>
        ))}
      </ul>
      {moved.length > shown.length && (
        <Link
          to={`/tremor/${t.id}`}
          className="mt-1 inline-flex min-h-[32px] items-center text-[12px] font-semibold text-blue-line hover:underline"
        >
          {moved.length - shown.length} more {moved.length - shown.length === 1 ? "team" : "teams"}{" "}
          moved
        </Link>
      )}
    </div>
  );
}

/** Before puck drop: what the game is worth to each team. */
function Stakes({ preview }: { preview: GamePreview }) {
  return (
    <section className="pt-10" aria-labelledby="stakes-h">
      <h2 id="stakes-h" className="display text-[30px] font-bold">
        What's at stake
      </h2>
      <p className="max-w-[60ch] text-[13px] text-ink-soft">
        Each team's playoff odds now, and how far apart they land after a win and after a loss, from
        the latest simulation of the season.
      </p>
      <ul className="mt-4 grid gap-x-10 border-t border-ice-scratch md:grid-cols-2">
        {preview.stakes.map((s) => (
          <li key={s.team} className="flex items-center gap-4 border-b border-ice-scratch py-4">
            <Link to={`/team/${s.team}`} className="flex items-center gap-2">
              <TeamLogo team={s.team} size={36} />
              <span className="display text-[30px] font-bold leading-none">{s.team}</span>
            </Link>
            <div className="ml-auto text-right">
              <div className="text-[12px] text-ink-soft">Playoff odds now</div>
              <div className="display text-[30px] font-bold leading-none tabular-nums">
                {s.p_playoffs != null ? pct(s.p_playoffs) : "-"}
              </div>
            </div>
            <div className="w-[9.5rem] text-right">
              <div className="text-[12px] text-ink-soft">A win over a loss</div>
              <div
                className={`display text-[30px] font-bold leading-none tabular-nums ${s.swing != null && s.swing > 0 ? "up" : ""}`}
              >
                {s.swing != null ? pp(s.swing) : "Too close to call"}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[13px] text-ink-soft">
        At puck drop this page follows the game: win probability, shots, and every goal's shockwave.{" "}
        <Link to="/" className="font-semibold text-blue-line hover:underline">
          Watch tonight's map
        </Link>
      </p>
    </section>
  );
}

export default function GamePage() {
  const id = useParams().id ?? "";
  const { data, isLoading, isError } = useGame(id);
  const [ref, width] = useWidth<HTMLDivElement>(800);
  const g = data?.game;
  useDocumentMeta(
    g ? `${g.away} at ${g.home}` : "Game",
    g
      ? g.state === "FUT" || g.state === "PRE"
        ? `${g.away} at ${g.home}: projected goals, win chances, and what the game means for the playoff race.`
        : `Win probability, shots, and every tremor from ${g.away} at ${g.home}.`
      : undefined,
  );
  if (isLoading) return <div className="p-6 text-ink-soft">Loading the game</div>;
  if (isError || !data || !g) return <div className="p-6">That game is not in the database.</div>;
  const wp = data.wp.map((p) => ({ t: p.t_game_s, v: p.p_home }));
  const markers = data.tremors
    .filter((t) => !t.overturned)
    .map((t) => {
      const p = t.wp_after;
      return {
        t: t.t_game_s,
        v: p.home_reg + p.home_ot + p.home_so,
        kind: t.team === g.home ? ("up" as const) : ("down" as const),
        label: `${t.scorer?.name ?? "Goal"} (${t.team})`,
      };
    });
  const final = g.state === "FINAL" || g.state === "OFF";
  const status = final
    ? `Final${g.last_period_type && g.last_period_type !== "REG" ? `/${g.last_period_type}` : ""}`
    : g.state === "FUT" || g.state === "PRE"
      ? localTime(g.start_utc)
      : `${periodLabel(g.period, g.period_type)} ${clock(g.clock_seconds)}`;
  const preview = data.preview;
  const upcoming = (g.state === "FUT" || g.state === "PRE") && !!preview;
  const pre = g.pregame;
  const homeWin = pre ? pre.home_reg + pre.home_ot + pre.home_so : null;
  const overtime = pre ? pre.home_ot + pre.home_so + pre.away_ot + pre.away_so : null;
  const biggest = [...data.tremors]
    .filter((t) => !t.overturned)
    .sort((a, b) => b.magnitude - a.magnitude)[0];
  const side = (team: string, score: number | null | undefined, home: boolean) => (
    <Link
      to={`/team/${team}`}
      className={`flex items-center gap-3 ${home ? "sm:flex-row-reverse sm:text-right" : ""}`}
    >
      <TeamLogo team={team} size={56} />
      <span className="display text-[34px] font-bold leading-none md:text-[44px]">{team}</span>
      {!upcoming && (
        <span className="display w-14 text-center text-[56px] font-extrabold leading-none tabular-nums md:text-[72px]">
          {score ?? "-"}
        </span>
      )}
    </Link>
  );
  return (
    <div className="w-full">
      <header className="border-b border-ice-scratch bg-ice-land">
        <div className="mx-auto max-w-6xl px-4 py-7 md:px-6">
          <p className="text-[13px] text-ink/80">
            {new Date(g.start_utc).toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
            {g.venue ? `, ${g.venue}` : ""}
          </p>
          <h1 className="sr-only">
            {g.away} {g.away_score ?? ""} at {g.home} {g.home_score ?? ""}, {status}
          </h1>
          <div className="mt-3 grid grid-cols-1 items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
            {side(g.away, g.away_score, false)}
            <div className="order-last text-[15px] font-semibold text-ink/80 sm:order-none sm:text-center">
              {status}
            </div>
            <div className="flex sm:justify-end">{side(g.home, g.home_score, true)}</div>
          </div>
          {upcoming && preview ? (
            <dl className="mt-6 grid grid-cols-2 divide-ice-scratch border-y border-ice-scratch sm:grid-cols-3 sm:divide-x">
              <div className="py-2 pr-3">
                <dt className="text-[12px] text-ink/80">Projected goals</dt>
                <dd className="display text-[28px] font-bold leading-none tabular-nums">
                  {preview.exp_away_goals.toFixed(1)} <span className="text-ink-soft">to</span>{" "}
                  {preview.exp_home_goals.toFixed(1)}
                </dd>
              </div>
              {homeWin != null && (
                <div className="order-first col-span-2 py-2 pr-3 sm:order-none sm:col-span-1 sm:px-3">
                  <dt className="text-[12px] text-ink/80">Win chance</dt>
                  <dd className="display text-[28px] font-bold leading-none tabular-nums">
                    {g.away} {pct(1 - homeWin, 0)} <span className="text-ink-soft">to</span>{" "}
                    {g.home} {pct(homeWin, 0)}
                  </dd>
                </div>
              )}
              {overtime != null && (
                <div className="py-2 sm:px-3">
                  <dt className="text-[12px] text-ink/80">Past regulation</dt>
                  <dd className="display text-[28px] font-bold leading-none tabular-nums">
                    {pct(overtime, 0)}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <dl className="mt-6 grid grid-cols-2 divide-ice-scratch border-y border-ice-scratch sm:grid-cols-3 sm:divide-x">
              <div className="py-2 pr-3 sm:first:pl-0">
                <dt className="text-[12px] text-ink/80">Expected goals</dt>
                <dd className="display text-[28px] font-bold leading-none tabular-nums">
                  {data.xg_away.toFixed(1)} <span className="text-ink-soft">to</span>{" "}
                  {data.xg_home.toFixed(1)}
                </dd>
              </div>
              <div className="py-2 pr-3 sm:px-3">
                <dt className="text-[12px] text-ink/80">Shots on goal</dt>
                <dd className="display text-[28px] font-bold leading-none tabular-nums">
                  {g.away_sog ?? "-"} <span className="text-ink-soft">to</span> {g.home_sog ?? "-"}
                </dd>
              </div>
              {biggest && (
                <div className="col-span-2 py-2 sm:col-span-1 sm:px-3">
                  <dt className="text-[12px] text-ink/80">Biggest tremor</dt>
                  <dd>
                    <Link
                      to={`/tremor/${biggest.id}`}
                      className="display text-[28px] font-bold leading-none underline-offset-4 hover:underline"
                    >
                      M{biggest.magnitude.toFixed(1)}{" "}
                      <span className="font-[family-name:var(--font-text)] text-[15px] font-semibold tracking-normal">
                        {biggest.scorer?.name ?? biggest.team},{" "}
                        {periodLabel(biggest.period, biggest.period_type)}{" "}
                        {clock(biggest.t_period_s)}
                      </span>
                    </Link>
                  </dd>
                </div>
              )}
            </dl>
          )}
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 pb-12 md:px-6">
        <div ref={ref}>
          {upcoming && preview && <Stakes preview={preview} />}
          {!upcoming && (
            <>
              <section className="pt-10" aria-labelledby="wp-h">
                <h2 id="wp-h" className="display mb-4 text-[30px] font-bold">
                  {g.home} win probability
                </h2>
                <LineChart
                  width={width}
                  height={200}
                  ariaLabel={`${g.home} win probability through the game`}
                  series={[{ name: `${g.home} wins`, color: "var(--ink)", points: wp }]}
                  markers={markers}
                  formatX={(t) => (t >= 3600 ? "OT" : t === 0 ? "Start" : `End of P${t / 1200}`)}
                  xTicks={[0, 1200, 2400, 3600, ...(wp.some((p) => p.t > 3600) ? [3900] : [])]}
                />
              </section>

              <section className="pt-10" aria-labelledby="shots-h">
                <h2 id="shots-h" className="display mb-2 text-[30px] font-bold">
                  Shots
                </h2>
                <p className="mb-3 max-w-[56ch] text-[13px] text-ink-soft">
                  <span className="font-semibold text-ink">{g.home}</span> shoots right,{" "}
                  <span className="font-semibold text-ink-soft">{g.away}</span> shoots left
                  (lighter). Bigger dots were likelier to score; filled dots scored.
                </p>
                <Rink shots={data.shots} home={g.home} width={width} />
              </section>

              <section className="pt-10" aria-labelledby="ripples-h">
                <h2 id="ripples-h" className="display text-[30px] font-bold">
                  Every goal's ripple
                </h2>
                {data.tremors.length > 0 && (
                  <p className="text-[13px] text-ink-soft">
                    Change in each team's playoff odds, in percentage points.
                  </p>
                )}
                {data.tremors.length === 0 && (
                  <p className="mt-2 text-[14px] text-ink-soft">No goals yet.</p>
                )}
                <div className="divide-y divide-ice-scratch">
                  {data.tremors.map((t) => (
                    <Ripple key={t.id} t={t} />
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
