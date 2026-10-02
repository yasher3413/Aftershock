import { useEffect, useState } from "react";
import { useMyTeam } from "../lib/myTeam";
import { TeamLogo } from "../components/TeamLogo";
import { Link } from "react-router";
import type { GameSummary } from "../api/types.gen";
import { clock, duration, localTime, pct, periodLabel } from "../lib/format";
import { useClock, nowMs } from "../live/clock";
import { useLive } from "../live/store";

const LIVE = new Set(["LIVE", "CRIT"]);
const DONE = new Set(["FINAL", "OFF"]);

function homeWin(g: GameSummary): number | null {
  const p = g.wp ?? g.pregame;
  if (!p) return null;
  return p.home_reg + p.home_ot + p.home_so;
}

function status(g: GameSummary): string {
  if (LIVE.has(g.state)) {
    if (g.in_intermission) return `End ${periodLabel(g.period, g.period_type)}`;
    return `${periodLabel(g.period, g.period_type)} ${clock(g.clock_seconds)}`;
  }
  if (DONE.has(g.state))
    return g.last_period_type && g.last_period_type !== "REG"
      ? `Final/${g.last_period_type}`
      : "Final";
  if (g.state === "PPD") return "Postponed";
  return localTime(g.start_utc);
}

function StakesMeter({ value, max }: { value: number | null | undefined; max: number }) {
  const level = value == null || max <= 0 ? 0 : Math.max(1, Math.round((value / max) * 5));
  return (
    <span
      className="inline-flex items-end gap-[2px]"
      aria-label={`Stakes ${level} of 5`}
      role="img"
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={i <= level ? "bg-ink" : "bg-ice-scratch"}
          style={{ width: 3, height: 4 + i * 2 }}
        />
      ))}
    </span>
  );
}

export function TonightPanel() {
  const games = useLive((s) => s.games);
  const myTeam = useMyTeam((s) => s.team);
  const tonight = useLive((s) => s.tonight);
  const got = useLive((s) => s.gameOfTheNight);
  const scenarios = useLive((s) => s.clinchScenarios);
  const mode = useClock((s) => s.mode);
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const list = tonight.map((id) => games[id]).filter((g): g is GameSummary => !!g);
  const now = nowMs();
  const started = list.some((g) => !["FUT", "PRE"].includes(g.state));
  const firstStart = Math.min(...list.map((g) => Date.parse(g.start_utc)));
  const sorted = started
    ? [...list].sort((a, b) => Date.parse(a.start_utc) - Date.parse(b.start_utc))
    : [...list].sort((a, b) => (b.stakes ?? 0) - (a.stakes ?? 0));
  const maxStakes = Math.max(0, ...list.map((g) => g.stakes ?? 0));

  return (
    <section aria-labelledby="tonight-h" className="px-4 py-3">
      <div className="flex items-baseline justify-between">
        <h2 id="tonight-h" className="display text-[24px] font-bold">
          {mode === "replay" && list[0]
            ? new Date(`${list[0].night_date}T12:00:00Z`).toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
                timeZone: "UTC",
              })
            : "Tonight"}
        </h2>
        {!started && list.length > 0 && Number.isFinite(firstStart) && firstStart > now && (
          <span className="text-[13px] text-ink-soft">
            First puck drop in {duration(firstStart - now)}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[12px] text-ink-soft">
        <span>Game win chance</span>
        <details className="relative text-right">
          <summary className="min-h-8 cursor-pointer py-1">Playoff stakes</summary>
          <p className="absolute right-0 z-20 mt-1 w-60 rounded-[var(--radius)] border border-ice-scratch bg-surface p-3 text-left text-ink">
            Taller bars mean this game has more potential to change playoff odds, relative to
            tonight's other games.
          </p>
        </details>
      </div>
      {list.length === 0 && (
        <p className="mt-2 text-[13px] text-ink-soft">
          No games tonight.{" "}
          <Link to="/nights" className="font-semibold text-blue-line underline">
            Replay a past night
          </Link>
          .
        </p>
      )}
      {scenarios.length > 0 && (
        <ul className="mt-2 text-[13px]">
          {scenarios.map((s) => (
            <li key={s} className="font-semibold">
              {s}
            </li>
          ))}
        </ul>
      )}
      <ul className="mt-2 divide-y divide-ice-scratch">
        {sorted.map((g) => {
          const p = homeWin(g);
          const isGot = g.id === got;
          return (
            <li
              key={g.id}
              className={`py-3 ${isGot || g.home === myTeam || g.away === myTeam ? "-mx-4 bg-surface px-4" : ""}`}
            >
              <Link
                to={`/game/${g.id}`}
                className="block rounded-[var(--radius)] focus-visible:outline-offset-4"
              >
                {isGot && (
                  <div className="mb-0.5 text-[12px] font-semibold text-blue-line">
                    Game of the night
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div className="display flex w-[142px] items-center gap-1 text-[22px] font-bold leading-none">
                    <TeamLogo team={g.away} size={22} />
                    {g.away} <span className="text-[14px] font-semibold text-ink-soft">at</span>
                    <TeamLogo team={g.home} size={22} />
                    {g.home}
                  </div>
                  <div className="display w-10 text-center text-[20px] font-bold tabular-nums">
                    {g.home_score != null && g.state !== "FUT" && g.state !== "PRE"
                      ? `${g.away_score}-${g.home_score}`
                      : ""}
                  </div>
                  <div className="flex-1 text-right text-[12px] text-ink-soft">
                    {status(g)}
                    {LIVE.has(g.state) && (
                      <span
                        className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-goal align-middle"
                        aria-hidden
                      />
                    )}
                  </div>
                  <StakesMeter value={g.stakes} max={maxStakes} />
                </div>
                {p != null && (
                  <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-soft">
                    <span className="w-9 tabular-nums">{pct(1 - p, 0)}</span>
                    <div
                      className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-ice-scratch"
                      aria-label={`${g.home} win probability ${pct(p)}`}
                      role="img"
                    >
                      <div
                        className="h-full bg-ink-soft/40"
                        style={{ width: `${(1 - p) * 100}%` }}
                      />
                      <div className="h-full bg-ink" style={{ width: `${p * 100}%` }} />
                    </div>
                    <span className="w-9 text-right tabular-nums">{pct(p, 0)}</span>
                  </div>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
