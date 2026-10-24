import { useId, useState, type ReactNode } from "react";
import { StandingsPanel } from "./StandingsPanel";

/**
 * The night's panel beside the map: the games and their goals on one tab,
 * the standings on the other. Shared by Tonight and every replayed night so
 * both read the same way.
 */
export function SidePanels({
  label,
  children,
  sticky = false,
}: {
  /** Name of the games tab: "Tonight", or "Games" for a past night. */
  label: string;
  children: ReactNode;
  /** Keep the tabs in view while the panel scrolls with the page (phones). */
  sticky?: boolean;
}) {
  const tabs = [label, "Standings"];
  const [tab, setTab] = useState(0);
  const id = useId();
  return (
    <div>
      <div
        role="tablist"
        aria-label="Panels"
        className={`flex gap-1 border-b border-ice-scratch bg-ice p-1.5 ${sticky ? "sticky top-0 z-10" : ""}`}
      >
        {tabs.map((t, i) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`${id}-tab-${i}`}
            aria-controls={`${id}-panel`}
            aria-selected={tab === i}
            tabIndex={tab === i ? 0 : -1}
            onClick={() => setTab(i)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const next = (i + 1) % tabs.length;
              setTab(next);
              document.getElementById(`${id}-tab-${next}`)?.focus();
            }}
            className={`min-h-10 flex-1 rounded-[var(--radius)] px-3 text-[14px] ${tab === i ? "bg-ice-land font-semibold text-ink" : "text-ink-soft hover:text-ink"}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`}>
        {tab === 0 ? (
          <div className="divide-y divide-ice-scratch">{children}</div>
        ) : (
          <StandingsPanel />
        )}
      </div>
    </div>
  );
}
