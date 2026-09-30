import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { api, useRecap } from "../api/client";
import type { GameSummary, ReplayBundleOut, StateResponse } from "../api/types.gen";
import { startReplay } from "../live/bootstrap";
import { useClock } from "../live/clock";
import { useLive } from "../live/store";
import { MapView } from "../map/MapView";
import { Seismograph } from "../seismo/Seismograph";
import { TonightPanel } from "../panels/TonightPanel";
import { TremorFeed } from "../panels/TremorFeed";
import { StandingsPanel } from "../panels/StandingsPanel";
import { localTime, longDate, pct } from "../lib/format";
import { useDocumentMeta } from "../lib/meta";

function todayEastern(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() - 6 * 3600_000));
  return parts;
}

type Status = "loading" | "ready" | "missing";

const FINISHED = new Set(["FINAL", "OFF"]);

function homeWin(g: GameSummary): number | null {
  const p = g.pregame;
  return p ? p.home_reg + p.home_ot + p.home_so : null;
}

/** The night's games before its replay exists: times, odds, and scores so far. */
function NightSchedule({ date }: { date: string }) {
  const games = useQuery({
    queryKey: ["games", date],
    queryFn: () => api<GameSummary[]>(`/games?date=${date}`),
    refetchInterval: 60_000,
  });
  const list = [...(games.data ?? [])].sort(
    (a, b) => Date.parse(a.start_utc) - Date.parse(b.start_utc),
  );
  const started = list.some((g) => g.state !== "FUT" && g.state !== "PRE");
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-12">
      <h1 className="display text-[38px] font-bold">{longDate(date)}</h1>
      {games.isLoading ? (
        <p className="mt-3 text-ink-soft">Loading the schedule</p>
      ) : list.length === 0 ? (
        <p className="mt-3 text-ink-soft">
          No games this night. Replays exist for every night of the 2024-25 and 2025-26 seasons.
        </p>
      ) : (
        <>
          <p className="mt-3 text-ink-soft">
            {started
              ? "Games are under way. Follow them on the live map; the full replay appears here once every game is final."
              : "The replay appears here once every game is final. Until then, the live map shows each goal as it happens."}
          </p>
          <ul className="mt-6 divide-y divide-ice-scratch border-y border-ice-scratch">
            {list.map((g) => {
              const p = homeWin(g);
              const live = !FINISHED.has(g.state) && g.state !== "FUT" && g.state !== "PRE";
              return (
                <li key={g.id}>
                  <Link
                    to={`/game/${g.id}`}
                    className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 py-3"
                  >
                    <span className="display text-[20px] font-bold">
                      {g.away} <span className="text-[14px] font-normal text-ink-soft">at</span>{" "}
                      {g.home}
                    </span>
                    <span className="text-right tabular-nums">
                      {g.home_score != null && g.away_score != null
                        ? `${g.away_score}-${g.home_score}${FINISHED.has(g.state) ? " final" : ""}`
                        : localTime(g.start_utc)}
                    </span>
                    <span className="text-[13px] text-ink-soft">{g.venue}</span>
                    <span className="text-right text-[13px] text-ink-soft tabular-nums">
                      {live
                        ? "Live"
                        : p != null && !FINISHED.has(g.state)
                          ? `${g.home} ${pct(p, 0)} to win`
                          : ""}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <Link
        to="/"
        className="mt-6 inline-block font-semibold text-blue-line underline underline-offset-4"
      >
        Go to the live map
      </Link>
    </div>
  );
}

export default function NightPage() {
  const params = useParams();
  const date = params.date === "today" || !params.date ? todayEastern() : params.date;
  const [status, setStatus] = useState<Status>("loading");
  const loaded = useLive((s) => s.loaded);
  const recap = useRecap(date);
  useDocumentMeta(
    `${longDate(date)} replay`,
    `Every goal of ${longDate(date)} and how far it moved the playoff race.`,
  );

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;
    (async () => {
      try {
        const [state, bundle] = await Promise.all([
          api<StateResponse>("/state"),
          api<ReplayBundleOut>(`/replay/${date}`),
        ]);
        if (cancelled) return;
        useLive.getState().bootstrap(state);
        const player = startReplay(state, bundle, { speed: 20, loop: false, autoplay: true });
        useLive.setState({ mode: "demo", replay: null });
        stop = () => player.pause();
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("missing");
      }
    })();
    return () => {
      cancelled = true;
      stop?.();
      useClock.getState().setLive();
    };
  }, [date]);

  if (status === "missing") return <NightSchedule date={date} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-baseline gap-x-4 border-b border-ice-scratch px-4 py-2 md:px-6">
        <h1 className="display text-[26px] font-bold">{longDate(date)}</h1>
        <span className="text-[13px] text-ink-soft">
          Replay. Drag the seismograph to move through the night.
        </span>
      </div>
      {recap.data && (
        <article className="border-b border-ice-scratch bg-surface px-4 py-3 md:px-6">
          <h2 className="text-[17px] font-semibold">{recap.data.headline}</h2>
          <p className="mt-1 max-w-[75ch] text-[14px] leading-relaxed text-ink-soft">
            {recap.data.body}
          </p>
        </article>
      )}
      <div className="flex min-h-[70vh] flex-1 flex-col lg:min-h-0 lg:flex-row">
        <div className="relative h-[56vh] min-h-[320px] lg:h-auto lg:flex-1">
          {loaded && status === "ready" ? (
            <MapView />
          ) : (
            <div className="p-6 text-ink-soft">Loading the night</div>
          )}
        </div>
        <aside className="shrink-0 border-ice-scratch lg:w-[380px] lg:overflow-y-auto lg:border-l">
          <div className="divide-y divide-ice-scratch">
            <TonightPanel />
            <TremorFeed />
            <StandingsPanel />
          </div>
        </aside>
      </div>
      <Seismograph />
    </div>
  );
}
