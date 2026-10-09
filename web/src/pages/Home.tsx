import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { MapView } from "../map/MapView";
import { Seismograph } from "../seismo/Seismograph";
import { TonightPanel } from "../panels/TonightPanel";
import { StandingsPanel } from "../panels/StandingsPanel";
import { TremorFeed } from "../panels/TremorFeed";
import { MyTeamPicker } from "../panels/MyTeamPicker";
import { ConnectionNote } from "../panels/ConnectionNote";
import { RecapCard } from "../panels/RecapCard";
import { useLiveBootstrap } from "../live/bootstrap";
import { Tour } from "../tour/Tour";
import { tourSeen, useTour } from "../tour/store";
import { useLive } from "../live/store";
import { useMedia } from "../lib/useMedia";
import { useMyTeam } from "../lib/myTeam";
import { duration, monthDay, pct, pp } from "../lib/format";

const TABS = ["Tonight", "Standings", "Tremors"] as const;

/** Re-renders every 30 s so a countdown stays current. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** The page's title block. Between nights it says plainly that the map is a
 * recorded night and when the next live game starts; it keeps one height
 * from first paint so nothing below it moves when the data arrives. */
function TonightContext() {
  const games = useLive((s) => s.games);
  const tonight = useLive((s) => s.tonight);
  const mode = useLive((s) => s.mode);
  const replay = useLive((s) => s.replay);
  const loaded = useLive((s) => s.loaded);
  const myTeam = useMyTeam((s) => s.team);
  const odds = useLive((s) => (myTeam ? s.odds[myTeam] : undefined));
  const initial = useLive((s) => (myTeam ? s.oddsDayStart[myTeam] : undefined));
  const now = useNow();
  const live = tonight.filter((id) => ["LIVE", "CRIT"].includes(games[id]?.state ?? "")).length;
  const replaying = mode === "demo" && replay;
  const next = replay?.next_live_utc ? Date.parse(replay.next_live_utc) - now : null;
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-ice-scratch px-4 py-3 transition-colors md:px-6 ${replaying ? "bg-ice-land" : ""}`}
      data-tour="status"
    >
      <div className="min-w-0">
        <h1 className="display flex flex-wrap items-baseline gap-x-3 text-[30px] font-bold">
          {replaying ? `${monthDay(replay.night_date)}, replayed` : "Tonight's playoff race"}
          {replaying && (
            <span className="rounded-[var(--radius)] border border-ink/60 px-1.5 py-0.5 font-[family-name:var(--font-text)] text-[12px] font-semibold leading-none tracking-normal text-ink/80">
              Replay
            </span>
          )}
        </h1>
        <p className="mt-1.5 min-h-[18px] text-[13px] text-ink/80">
          {!loaded ? null : replaying ? (
            <>
              No games are on, so the map is replaying that night's goals.
              {next != null && next > 0 && <> Next live game in {duration(next)}.</>}{" "}
              <Link
                to="/night/today"
                className="font-semibold text-blue-line underline-offset-2 hover:underline"
              >
                Tonight's schedule
              </Link>
            </>
          ) : (
            `${tonight.length} ${tonight.length === 1 ? "game" : "games"} tonight${live ? `, ${live} live` : ""}`
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={() => useTour.getState().start()}
          className="min-h-[44px] text-[13px] font-semibold text-blue-line underline-offset-4 hover:underline"
        >
          How to read this
        </button>
        <MyTeamPicker />
        {myTeam && odds && (
          <Link to={`/team/${myTeam}`} className="text-[13px] font-semibold hover:underline">
            {myTeam} {pct(odds.p_playoffs)} playoffs
            {initial && (
              <span className={`ml-2 ${odds.p_playoffs >= initial.p_playoffs ? "up" : "down"}`}>
                {pp(odds.p_playoffs - initial.p_playoffs)} this night
              </span>
            )}
          </Link>
        )}
      </div>
    </div>
  );
}

export default function HomePage() {
  const failed = useLiveBootstrap();
  const loaded = useLive((s) => s.loaded);
  const wide = useMedia("(min-width: 1024px)");
  const [tab, setTab] = useState<(typeof TABS)[number]>("Tonight");
  const [params, setParams] = useSearchParams();
  const asked = params.get("tour") === "1";

  // First visit: open the walkthrough once the map has something to show.
  // `?tour=1` (the footer link) opens it on request.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!loaded || autoStarted.current || (!asked && tourSeen())) return;
    const id = setTimeout(() => {
      autoStarted.current = true;
      useTour.getState().start();
      if (asked) setParams((p) => (p.delete("tour"), p), { replace: true });
    }, 700);
    return () => clearTimeout(id);
  }, [loaded, asked, setParams]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Tour />
      <ConnectionNote />
      <TonightContext />
      {failed && loaded && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 border-b border-ice-scratch bg-surface px-4 py-3 text-[13px] md:px-6"
        >
          <p>The league snapshot could not refresh. You can still use the map.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-[44px] font-semibold text-blue-line underline"
          >
            Retry refresh
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative h-[38vh] min-h-[260px] lg:h-auto lg:min-h-0 lg:flex-1">
          {failed && !loaded ? (
            <div role="alert" className="mx-auto max-w-md p-6">
              <h2 className="display text-[30px] font-bold">The league could not load</h2>
              <p className="mt-3 text-[14px] text-ink-soft">
                Try reconnecting to get the map and current game updates.
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-4 min-h-[44px] rounded-[var(--radius)] bg-ink px-4 font-semibold text-ice"
              >
                Retry connection
              </button>
            </div>
          ) : loaded ? (
            <MapView />
          ) : (
            <div role="status" className="p-6 text-ink-soft">
              Loading the league
            </div>
          )}
        </div>
        {wide ? (
          <aside
            className="w-[440px] shrink-0 overflow-y-auto border-l border-ice-scratch"
            aria-label="Tonight, standings, and tremors"
          >
            <div className="divide-y divide-ice-scratch">
              <TonightPanel />
              <TremorFeed limit={6} />
              <StandingsPanel />
              <RecapCard />
            </div>
          </aside>
        ) : (
          <Seismograph />
        )}
      </div>
      {wide && <Seismograph />}
      {!wide && (
        <section className="border-t border-ice-scratch">
          <div
            role="tablist"
            aria-label="Panels"
            className="sticky top-0 z-10 flex border-b border-ice-scratch bg-ice"
          >
            {TABS.map((t, i) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`home-tab-${t}`}
                aria-controls="home-panel"
                aria-selected={tab === t}
                tabIndex={tab === t ? 0 : -1}
                onClick={() => setTab(t)}
                onKeyDown={(e) => {
                  const next =
                    e.key === "ArrowRight"
                      ? (i + 1) % TABS.length
                      : e.key === "ArrowLeft"
                        ? (i + TABS.length - 1) % TABS.length
                        : e.key === "Home"
                          ? 0
                          : e.key === "End"
                            ? TABS.length - 1
                            : null;
                  if (next === null) return;
                  e.preventDefault();
                  setTab(TABS[next]!);
                  document.getElementById(`home-tab-${TABS[next]}`)?.focus();
                }}
                className={`min-h-[44px] flex-1 py-2.5 text-[14px] ${tab === t ? "border-b-2 border-ink font-semibold" : "text-ink-soft"}`}
              >
                {t}
              </button>
            ))}
          </div>
          <div id="home-panel" role="tabpanel" aria-labelledby={`home-tab-${tab}`} className="pb-4">
            {tab === "Tonight" && (
              <>
                <TonightPanel />
                <RecapCard />
              </>
            )}
            {tab === "Standings" && <StandingsPanel />}
            {tab === "Tremors" && <TremorFeed />}
          </div>
        </section>
      )}
    </div>
  );
}
