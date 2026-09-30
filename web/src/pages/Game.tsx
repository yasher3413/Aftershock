import { Link, useParams } from "react-router";
import { useGame } from "../api/client";
import type { Tremor } from "../api/types.gen";
import { LineChart } from "../charts/LineChart";
import { Rink } from "../charts/Rink";
import { useWidth } from "../charts/useWidth";
import { clock, periodLabel, pp } from "../lib/format";
import { useDocumentMeta } from "../lib/meta";

function Ripple({ t }: { t: Tremor }) {
  const max = Math.max(...t.deltas.map((d) => Math.abs(d.d_playoffs)), 1e-6);
  const shown = t.deltas.filter((d) => Math.abs(d.d_playoffs) >= 0.0005);
  return (
    <div className="py-3">
      <div className="flex items-baseline gap-3">
        <Link to={`/tremor/${t.id}`} className="display text-[28px] font-extrabold text-goal">
          {t.magnitude.toFixed(1)}
        </Link>
        <div className="text-[14px]">
          <span className="font-semibold">{t.scorer?.name ?? "Goal"}</span> ({t.team}),{" "}
          {periodLabel(t.period, t.period_type)} {clock(t.t_period_s)}, {t.away}{" "}
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
    </div>
  );
}

export default function GamePage() {
  const id = useParams().id ?? "";
  const { data, isLoading, isError } = useGame(id);
  const [ref, width] = useWidth<HTMLDivElement>(800);
  const g = data?.game;
  useDocumentMeta(
    g ? `${g.away} at ${g.home}` : "Game",
    g ? `Win probability, shots, and every tremor from ${g.away} at ${g.home}.` : undefined,
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
  return (
    <div ref={ref} className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[13px] text-ink-soft">
            {new Date(g.start_utc).toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
            {g.venue ? `, ${g.venue}` : ""}
          </p>
          <h1 className="display mt-1 text-[48px] font-extrabold leading-none">
            <Link to={`/team/${g.away}`}>{g.away}</Link> {g.away_score ?? ""}
            <span className="mx-3 text-ink-soft">at</span>
            <Link to={`/team/${g.home}`}>{g.home}</Link> {g.home_score ?? ""}
          </h1>
          <p className="mt-1 text-[14px] text-ink-soft">
            {final
              ? `Final${g.last_period_type && g.last_period_type !== "REG" ? `/${g.last_period_type}` : ""}`
              : g.state === "FUT"
                ? "Not started"
                : `${periodLabel(g.period, g.period_type)} ${clock(g.clock_seconds)}`}
          </p>
        </div>
        <div className="text-right">
          <div className="text-[13px] text-ink-soft">Expected goals</div>
          <div className="display text-[36px] font-bold tabular-nums">
            {g.away} {data.xg_away.toFixed(1)} <span className="text-ink-soft">-</span>{" "}
            {data.xg_home.toFixed(1)} {g.home}
          </div>
        </div>
      </header>

      <section className="mt-6 border-t border-ice-scratch pt-4" aria-labelledby="wp-h">
        <h2 id="wp-h" className="mb-2 text-[17px] font-semibold">
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

      <section className="mt-6 border-t border-ice-scratch pt-4" aria-labelledby="shots-h">
        <h2 id="shots-h" className="mb-2 text-[17px] font-semibold">
          Shots
        </h2>
        <p className="mb-2 text-[13px] text-ink-soft">
          <span className="font-semibold text-ink">{g.home}</span> shoots right,{" "}
          <span className="font-semibold text-blue-line">{g.away}</span> shoots left. Bigger dots
          were likelier to score; filled dots scored.
        </p>
        <Rink shots={data.shots} home={g.home} width={width} />
      </section>

      <section className="mt-6 border-t border-ice-scratch pt-4" aria-labelledby="ripples-h">
        <h2 id="ripples-h" className="text-[17px] font-semibold">
          Every goal's ripple
        </h2>
        <p className="text-[13px] text-ink-soft">
          Change in each team's playoff odds, in percentage points.
        </p>
        {data.tremors.length === 0 && (
          <p className="mt-2 text-[14px] text-ink-soft">No goals yet.</p>
        )}
        <div className="divide-y divide-ice-scratch">
          {data.tremors.map((t) => (
            <Ripple key={t.id} t={t} />
          ))}
        </div>
      </section>
    </div>
  );
}
