import { useState } from "react";
import { Link } from "react-router";
import { MapView } from "../map/MapView";
import { Seismograph } from "../seismo/Seismograph";
import { TonightPanel } from "../panels/TonightPanel";
import { StandingsPanel } from "../panels/StandingsPanel";
import { TremorFeed } from "../panels/TremorFeed";
import { ReplayBanner } from "../panels/ReplayBanner";
import { MyTeamPicker } from "../panels/MyTeamPicker";
import { ConnectionNote } from "../panels/ConnectionNote";
import { RecapCard } from "../panels/RecapCard";
import { useLiveBootstrap } from "../live/bootstrap";
import { useLive } from "../live/store";
import { useMedia } from "../lib/useMedia";
import { useMyTeam } from "../lib/myTeam";
import { pct, pp } from "../lib/format";

const TABS = ["Tonight", "Standings", "Tremors"] as const;

function TonightContext() {
  const games = useLive((s) => s.games);
  const tonight = useLive((s) => s.tonight);
  const mode = useLive((s) => s.mode);
  const myTeam = useMyTeam((s) => s.team);
  const odds = useLive((s) => (myTeam ? s.odds[myTeam] : undefined));
  const initial = useLive((s) => (myTeam ? s.oddsDayStart[myTeam] : undefined));
  const live = tonight.filter((id) => ["LIVE", "CRIT"].includes(games[id]?.state ?? "")).length;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-ice-scratch px-4 py-3 md:px-6">
      <div>
        <h1 className="display text-[30px] font-bold">Tonight's playoff race</h1>
        <p className="mt-1 text-[12px] text-ink-soft">
          {mode === "demo"
            ? "Recorded goals and their shockwaves"
            : `${tonight.length} ${tonight.length === 1 ? "game" : "games"} tonight${live ? ` / ${live} live` : ""}`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ReplayBanner />
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
      <details className="border-b border-ice-scratch bg-surface px-4 text-[13px] sm:hidden">
        <summary className="flex min-h-[44px] cursor-pointer items-center font-semibold">
          Reading the map
        </summary>
        <p className="max-w-[65ch] pb-3 text-ink-soft">
          Tap a team for its outlook. Each ring shows playoff odds. Goals send out shockwaves: blue
          means odds rose, red means they fell. Changes use percentage points (pp); 40% to 42% is +2
          pp. Game-row percentages show the chance to win that game.
        </p>
      </details>
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
