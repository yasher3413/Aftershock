import { useState } from "react";
import { MapView } from "../map/MapView";
import { Seismograph } from "../seismo/Seismograph";
import { TonightPanel } from "../panels/TonightPanel";
import { StandingsPanel } from "../panels/StandingsPanel";
import { TremorFeed } from "../panels/TremorFeed";
import { ReplayBanner } from "../panels/ReplayBanner";
import { FirstVisit } from "../panels/FirstVisit";
import { MyTeamPicker } from "../panels/MyTeamPicker";
import { ConnectionNote } from "../panels/ConnectionNote";
import { useLiveBootstrap } from "../live/bootstrap";
import { useLive } from "../live/store";
import { useMedia } from "../lib/useMedia";

const TABS = ["Tonight", "Standings", "Tremors"] as const;

export default function HomePage() {
  useLiveBootstrap();
  const loaded = useLive((s) => s.loaded);
  const wide = useMedia("(min-width: 1024px)");
  const [tab, setTab] = useState<(typeof TABS)[number]>("Tonight");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ReplayBanner />
      <ConnectionNote />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative h-[56vh] min-h-[320px] lg:h-auto lg:min-h-0 lg:flex-1">
          {loaded ? <MapView /> : <div className="p-6 text-ink-soft">Loading the league</div>}
          <div className="pointer-events-none absolute left-3 top-3 right-3 flex justify-start">
            <FirstVisit />
          </div>
        </div>
        {wide ? (
          <aside
            className="w-[380px] shrink-0 overflow-y-auto border-l border-ice-scratch"
            aria-label="Tonight, standings, and tremors"
          >
            <div className="border-b border-ice-scratch px-4 py-2">
              <MyTeamPicker />
            </div>
            <div className="divide-y divide-ice-scratch">
              <TonightPanel />
              <TremorFeed limit={6} />
              <StandingsPanel />
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
            {TABS.map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2.5 text-[14px] ${tab === t ? "border-b-2 border-ink font-semibold" : "text-ink-soft"}`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="px-0 pb-4">
            <div className="px-4 pt-3">
              <MyTeamPicker />
            </div>
            {tab === "Tonight" && <TonightPanel />}
            {tab === "Standings" && <StandingsPanel />}
            {tab === "Tremors" && <TremorFeed />}
          </div>
        </section>
      )}
    </div>
  );
}
