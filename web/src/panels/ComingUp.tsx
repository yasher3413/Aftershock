import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { GameSummary } from "../api/types.gen";
import { localTime, pct } from "../lib/format";
import { todayEastern } from "../lib/season";
import { useLive } from "../live/store";
import { TeamLogo } from "../components/TeamLogo";

/**
 * Between nights the home page replays the last one; this lists tonight's
 * games so a daytime visitor can see what is coming without leaving.
 */
export function ComingUpTonight() {
  const replaying = useLive((s) => s.mode === "demo");
  const date = todayEastern();
  const { data } = useQuery({
    queryKey: ["games", date],
    queryFn: () => api<GameSummary[]>(`/games?date=${date}`),
    enabled: replaying,
    staleTime: 300_000,
  });
  const games = (data ?? [])
    .filter((g) => g.state === "FUT" || g.state === "PRE")
    .sort((a, b) => Date.parse(a.start_utc) - Date.parse(b.start_utc));
  if (!replaying || games.length === 0) return null;
  return (
    <section aria-labelledby="coming-h" className="px-4 py-3">
      <div className="flex items-baseline justify-between">
        <h2 id="coming-h" className="display text-[24px] font-bold">
          Coming up tonight
        </h2>
        <Link
          to="/night/today"
          className="text-[13px] font-semibold text-blue-line hover:underline"
        >
          Full schedule
        </Link>
      </div>
      <ul className="mt-1 divide-y divide-ice-scratch">
        {games.map((g) => {
          const p = g.pregame ? g.pregame.home_reg + g.pregame.home_ot + g.pregame.home_so : null;
          return (
            <li key={g.id}>
              <Link
                to={`/game/${g.id}`}
                className="grid min-h-[44px] grid-cols-[1fr_auto] items-center gap-x-3 py-1.5 hover:bg-ice-land"
              >
                <span className="display flex items-center gap-1.5 text-[18px] font-bold">
                  <TeamLogo team={g.away} size={18} />
                  {g.away}
                  <span className="font-[family-name:var(--font-text)] text-[12px] font-normal text-ink-soft">
                    at
                  </span>
                  <TeamLogo team={g.home} size={18} />
                  {g.home}
                </span>
                <span className="text-right text-[13px] tabular-nums">
                  {localTime(g.start_utc)}
                  {p != null && (
                    <span className="block text-[12px] text-ink-soft">
                      {p >= 0.5 ? g.home : g.away} {pct(Math.max(p, 1 - p), 0)} to win
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
