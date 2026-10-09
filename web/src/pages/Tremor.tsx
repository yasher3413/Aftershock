import { useState } from "react";
import { Link, useParams } from "react-router";
import { useStateQuery, useTremor } from "../api/client";
import { useWidth } from "../charts/useWidth";
import { clock, periodLabel, pp, pct } from "../lib/format";
import { useDocumentMeta } from "../lib/meta";
import { MiniMap } from "../map/MiniMap";
import { Headshot } from "../components/Headshot";
import { TeamLogo } from "../components/TeamLogo";

export default function TremorPage() {
  const id = useParams().id ?? "";
  const { data: t, isLoading, isError } = useTremor(id);
  const state = useStateQuery();
  const [ref, width] = useWidth<HTMLDivElement>(640);
  const [copied, setCopied] = useState(false);
  const title = t ? `${t.scorer?.name ?? t.team}: magnitude ${t.magnitude.toFixed(1)}` : "Tremor";
  useDocumentMeta(
    title,
    t
      ? `${t.team} goal against ${t.opponent}. ${t.team} playoff odds ${pp(t.ppa, 1, " percentage points")}.`
      : undefined,
    `/api/og/tremor/${id}.png`,
  );
  if (isLoading) return <div className="p-6 text-ink-soft">Loading the tremor</div>;
  if (isError || !t) return <div className="p-6">No tremor with that id.</div>;
  const max = Math.max(...t.deltas.map((d) => Math.abs(d.d_playoffs)), 1e-6);
  // Teams the goal barely touched collapse into one line.
  const moved = t.deltas.filter((d) => Math.abs(d.d_playoffs) >= 0.0005);
  const still = t.deltas.filter((d) => Math.abs(d.d_playoffs) < 0.0005);
  const own = t.deltas.find((d) => d.team === t.team);
  const settled =
    own && (own.p_playoffs_after >= 0.995 || own.p_playoffs_after <= 0.005)
      ? own.p_playoffs_after
      : null;
  const date = new Date(`${t.night_date}T12:00:00Z`).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const wpBefore = t.wp_before.home_reg + t.wp_before.home_ot + t.wp_before.home_so;
  const wpAfter = t.wp_after.home_reg + t.wp_after.home_ot + t.wp_after.home_so;
  const scoringHome = t.team === t.home;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6">
      <div className="grid gap-8 md:grid-cols-[1fr_1.1fr]">
        <div>
          <p className="text-[13px] text-ink-soft">
            {date},{" "}
            <Link to={`/game/${t.game_id}`} className="underline underline-offset-2">
              {t.away} at {t.home}
            </Link>
          </p>
          <div className="mt-3 flex items-end gap-4">
            <div className="display text-[120px] font-extrabold leading-[0.8] text-goal">
              {t.magnitude.toFixed(1)}
            </div>
            <div className="pb-2 text-[13px] text-ink-soft">
              Magnitude
              {t.overturned && <div className="font-semibold text-ink">Overturned. No goal.</div>}
            </div>
          </div>
          <h1 className="mt-4 flex items-center gap-3 text-[28px] font-semibold leading-tight">
            {t.scorer && (
              <Headshot
                playerId={t.scorer.id}
                name={t.scorer.name}
                team={t.team}
                season={t.season}
                size={56}
              />
            )}
            <span>
              {t.scorer ? (
                <Link
                  to={`/player/${t.scorer.id}?season=${t.season}`}
                  className="underline-offset-4 hover:underline"
                >
                  {t.scorer.name}
                </Link>
              ) : (
                "Goal"
              )}{" "}
              <span className="inline-flex items-center gap-1 align-middle text-ink-soft">
                <TeamLogo team={t.team} size={26} />({t.team})
              </span>
            </span>
          </h1>
          <p className="mt-1 text-[15px]">
            {t.shootout
              ? "Shootout winner"
              : `${periodLabel(t.period, t.period_type)} period, ${clock(t.t_period_s)}`}
            . {t.away} {t.score_before.away}-{t.score_before.home} {t.home} became {t.away}{" "}
            {t.score_after.away}-{t.score_after.home} {t.home}.
          </p>
          {t.assists.length > 0 && (
            <p className="text-[14px] text-ink-soft">
              Assists:{" "}
              {t.assists.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && ", "}
                  <Link
                    to={`/player/${a.id}?season=${t.season}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {a.name}
                  </Link>
                </span>
              ))}
            </p>
          )}
          <dl className="mt-5 grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-[14px]">
            <dt className="text-ink-soft">{t.team} win probability</dt>
            <dd className="text-right tabular-nums">
              {pct(scoringHome ? wpBefore : 1 - wpBefore)} to{" "}
              {pct(scoringHome ? wpAfter : 1 - wpAfter)}
            </dd>
            <dt className="text-ink-soft">Playoff Probability Added</dt>
            <dd className="text-right tabular-nums">
              {pp(t.ppa)}
              {Math.abs(t.ppa) < 0.0005 && settled != null && (
                <span className="block text-[12px] text-ink-soft">
                  {t.team} {settled >= 0.995 ? "was already in" : "was already out"}
                </span>
              )}
            </dd>
            <dt className="text-ink-soft">Cup Probability Added</dt>
            <dd className="text-right tabular-nums">{pp(t.cpa, 2)}</dd>
            <dt className="text-ink-soft">Total shift across the league</dt>
            <dd className="text-right tabular-nums">{pp(t.total_shift, 1).replace("+", "")}</dd>
          </dl>
          <div className="mt-5 flex gap-3">
            <button
              type="button"
              className="rounded-[var(--radius)] bg-ink px-3 py-2 text-[14px] font-semibold text-ice"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(window.location.href);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? "Link copied" : "Copy link"}
            </button>
            <a
              href={`/api/og/tremor/${t.id}.png?size=card`}
              download={`aftershock-tremor-${t.id}.png`}
              className="rounded-[var(--radius)] border border-ice-scratch px-3 py-2 text-[14px] font-semibold"
            >
              Download card
            </a>
          </div>
        </div>
        <div ref={ref} className="min-w-0">
          {state.data && <MiniMap tremor={t} teams={state.data.teams} width={width} />}
        </div>
      </div>
      <section className="mt-8 border-t border-ice-scratch pt-4" aria-labelledby="deltas-h">
        <h2 id="deltas-h" className="display text-[30px] font-bold">
          Who it moved
        </h2>
        <p className="text-[13px] text-ink-soft">
          Change in playoff odds, in percentage points, and the odds right after.
        </p>
        <ul className="mt-3 grid gap-y-1 text-[13px] md:grid-cols-2 md:gap-x-10">
          {moved.map((d) => (
            <li
              key={d.team}
              className="grid grid-cols-[2.8rem_1fr_4.2rem_3.6rem] items-center gap-2"
            >
              <Link to={`/team/${d.team}`} className="display text-[15px] font-bold">
                {d.team}
              </Link>
              <div className="relative h-2">
                <div className="absolute left-1/2 top-0 h-full w-px bg-ice-scratch" />
                <div
                  className={`absolute top-0 h-full ${d.d_playoffs > 0 ? "left-1/2 bg-blue-line" : "right-1/2 bg-goal"}`}
                  style={{ width: `${(Math.abs(d.d_playoffs) / max) * 50}%` }}
                />
              </div>
              <span
                className={`text-right tabular-nums ${d.d_playoffs > 0 ? "up" : d.d_playoffs < 0 ? "down" : ""}`}
              >
                {pp(d.d_playoffs)}
              </span>
              <span className="text-right tabular-nums text-ink-soft">
                {pct(d.p_playoffs_after, 0)}
              </span>
            </li>
          ))}
        </ul>
        {still.length > 0 && (
          <p className="mt-3 max-w-[56ch] text-[13px] text-ink-soft">
            {still.length} other teams moved by less than 0.05 percentage points:{" "}
            {still.map((d) => d.team).join(", ")}.
          </p>
        )}
      </section>
    </div>
  );
}
