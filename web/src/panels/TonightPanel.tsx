import { useEffect, useState } from "react";
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
  const tonight = useLive((s) => s.tonight);
  const got = useLive((s) => s.gameOfTheNight);
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
        <h2 id="tonight-h" className="text-[15px] font-semibold">
          {mode === "replay" ? "That night" : "Tonight"}
        </h2>
        {!started && list.length > 0 && Number.isFinite(firstStart) && firstStart > now && (
          <span className="text-[13px] text-ink-soft">
            First puck drop in {duration(firstStart - now)}
          </span>
        )}
      </div>
      {list.length === 0 && <p className="mt-2 text-[13px] text-ink-soft">No games tonight.</p>}
      <ul className="mt-2 divide-y divide-ice-scratch">
        {sorted.map((g) => {
          const p = homeWin(g);
          const isGot = g.id === got;
          return (
            <li
              key={g.id}
              className={`py-2 ${isGot ? "-mx-4 border-l-2 border-blue-line bg-ice-land/50 px-[14px]" : ""}`}
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
                  <div className="display w-[88px] text-[20px] font-bold leading-none">
                    {g.away} <span className="text-[14px] font-semibold text-ink-soft">at</span>{" "}
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
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-ink-soft">
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
