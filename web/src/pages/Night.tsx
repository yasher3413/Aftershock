import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { api, useNights, useRecap } from "../api/client";
import type { GameSummary, ReplayBundleOut, StateResponse } from "../api/types.gen";
import { startReplay } from "../live/bootstrap";
import { useClock } from "../live/clock";
import { useLive } from "../live/store";
import { MapView } from "../map/MapView";
import { Seismograph } from "../seismo/Seismograph";
import { TonightPanel } from "../panels/TonightPanel";
import { TremorFeed } from "../panels/TremorFeed";
import { TeamLogo } from "../components/TeamLogo";
import { StandingsPanel } from "../panels/StandingsPanel";
import { localTime, longDate, pct } from "../lib/format";
import { useDocumentMeta } from "../lib/meta";
import { seasonOf } from "../lib/season";

function todayEastern(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() - 6 * 3600_000));
  return parts;
}

/** Previous and next nights with a replay, and the season calendar. */
function NightNav({ date }: { date: string }) {
  const season = seasonOf(date);
  const { data: nights = [] } = useNights(season);
  const dates = nights.map((n) => n.night_date).sort();
  const prev = [...dates].reverse().find((d) => d < date);
  const next = dates.find((d) => d > date);
  const link = "font-semibold text-blue-line underline-offset-4 hover:underline";
  return (
    <nav aria-label="Other nights" className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
      {prev && (
        <Link to={`/night/${prev}`} className={link}>
          Previous night
        </Link>
      )}
      <Link to={`/nights?season=${season}`} className={link}>
        All nights
      </Link>
      {next && (
        <Link to={`/night/${next}`} className={link}>
          Next night
        </Link>
      )}
    </nav>
  );
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
    <div className="mx-auto w-full max-w-3xl px-4 py-10 md:px-6">
      <h1 className="display text-[48px] font-bold">{longDate(date)}</h1>
      <div className="mt-2">
        <NightNav date={date} />
      </div>
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
                    className="grid grid-cols-[1fr_auto] items-center gap-x-4 py-5 hover:text-blue-line"
                  >
                    <span className="display flex items-center gap-2 text-[26px] font-bold">
                      <TeamLogo team={g.away} size={32} />
                      {g.away} <span className="text-[14px] font-normal text-ink-soft">at</span>{" "}
                      <TeamLogo team={g.home} size={32} />
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
  return <NightReplay key={date} date={date} />;
}

function ReplayActions({ bundle }: { bundle: ReplayBundleOut }) {
  const player = useClock((s) => s.player);
  const t = useClock((s) => s.replayT);
  const next = bundle.frames.find((f) => f.t > t && f.message.type === "tremor");
  const seek = (position: number) => {
    player?.pause();
    player?.seek(position);
    useClock.getState().setPlaying(false);
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ice-scratch bg-surface px-4 py-3 md:px-6">
      <p className="text-[13px] text-ink-soft">Drag the seismograph to move through the night.</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => seek(0)}
          className="min-h-10 rounded-[var(--radius)] border border-ice-scratch px-4 text-[13px] font-semibold hover:bg-ice-land"
        >
          Restart
        </button>
        <button
          type="button"
          disabled={!next}
          onClick={() => next && seek(next.t)}
          className="min-h-10 rounded-[var(--radius)] bg-ink px-4 text-[13px] font-semibold text-ice hover:bg-blue-line hover:text-surface disabled:cursor-default disabled:opacity-50"
        >
          Next goal
        </button>
      </div>
    </div>
  );
}

function NightReplay({ date }: { date: string }) {
  const [status, setStatus] = useState<Status>("loading");
  const loaded = useLive((s) => s.loaded);
  const [bundle, setBundle] = useState<ReplayBundleOut | null>(null);
  const [panel, setPanel] = useState("Games");
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
        setBundle(bundle);
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
    <div className="night-page flex flex-1 flex-col">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-ice-scratch px-4 py-5 md:px-6">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="display text-[38px] font-bold md:text-[48px]">{longDate(date)}</h1>
            <span
              role="note"
              className="rounded-[var(--radius)] bg-ice-land px-2.5 py-1 text-[12px] font-semibold"
            >
              Replay
            </span>
          </div>
          <p className="mt-2 text-[14px] text-ink-soft">
            Every goal, and the playoff odds it moved.
          </p>
        </div>
        <NightNav date={date} />
      </header>
      <section
        aria-label="Night replay"
        className="night-stage grid lg:grid-cols-[minmax(0,1fr)_360px]"
      >
        <div className="night-map relative min-w-0 flex-1">
          {loaded && status === "ready" ? (
            <MapView />
          ) : (
            <div role="status" className="p-6 text-ink-soft">
              Loading the night
            </div>
          )}
        </div>
        <div className="night-transport order-1 min-w-0 lg:order-2 lg:col-span-2">
          {bundle && <ReplayActions bundle={bundle} />}
          <Seismograph />
        </div>
        <aside className="night-rail order-2 min-w-0 lg:order-1 border-t border-ice-scratch lg:w-[360px] lg:border-t-0 lg:border-l">
          <div
            role="group"
            aria-label="Replay panels"
            className="sticky top-0 z-10 flex border-b border-ice-scratch bg-surface p-2"
          >
            {["Games", "Tremors", "Standings"].map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={panel === name}
                onClick={() => setPanel(name)}
                className={`min-h-10 flex-1 rounded-[var(--radius)] px-3 text-[13px] ${panel === name ? "bg-ice-land font-semibold text-ink" : "text-ink-soft hover:text-ink"}`}
              >
                {name}
              </button>
            ))}
          </div>
          {panel === "Games" && <TonightPanel />}
          {panel === "Tremors" && <TremorFeed />}
          {panel === "Standings" && <StandingsPanel />}
        </aside>
      </section>
      {recap.data && (
        <article
          aria-labelledby="night-recap-h"
          className="order-2 border-t border-ice-scratch bg-surface px-4 py-8 md:px-6 md:py-12"
        >
          <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.65fr)] lg:gap-12">
            <div>
              <h2
                id="night-recap-h"
                className="display max-w-[24ch] text-[38px] font-bold leading-[1.08] md:text-[48px]"
              >
                {recap.data.headline}
              </h2>
              <p className="mt-4 text-[13px] text-ink-soft">
                The night in review / {longDate(date)}
              </p>
            </div>
            <div className="max-w-[70ch] space-y-4 text-[15px] leading-relaxed">
              {recap.data.body.split(/\n\s*\n/).map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          </div>
        </article>
      )}
    </div>
  );
}
