import { useState } from "react";

/** The map's key: what a node's ring and tick mean, and how goals are
 * measured. Always shown from tablet width; on phones, behind a button so
 * it does not cover the small map. */
export function MapKey() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="map-key"
        onClick={() => setOpen((o) => !o)}
        className="absolute bottom-2 left-2 z-10 min-h-[44px] rounded-[var(--radius)] border border-ice-scratch bg-surface/95 px-3 text-[13px] font-semibold text-ink sm:hidden"
      >
        {open ? "Hide key" : "Map key"}
      </button>
      <Key open={open} />
    </>
  );
}

function Key({ open }: { open: boolean }) {
  return (
    <figure
      id="map-key"
      aria-label="Map key"
      className={`pointer-events-none absolute left-2 max-w-[17rem] rounded-[var(--radius)] border border-ice-scratch bg-surface/95 px-3 py-2 text-[12px] leading-snug text-ink-soft sm:bottom-3 sm:left-3 sm:block ${open ? "bottom-14 block" : "hidden"}`}
    >
      <div className="flex items-center gap-2.5">
        <svg width="30" height="34" viewBox="0 0 30 34" aria-hidden className="shrink-0">
          <circle
            cx="15"
            cy="15"
            r="12"
            fill="var(--surface)"
            stroke="var(--ice-scratch)"
            strokeWidth="3"
          />
          <circle
            cx="15"
            cy="15"
            r="12"
            fill="none"
            stroke="var(--ink)"
            strokeWidth="3"
            strokeDasharray={`${2 * Math.PI * 12 * 0.62} 100`}
            transform="rotate(-90 15 15)"
          />
          <rect x="10" y="30" width="10" height="3" fill="var(--goal)" />
        </svg>
        <span>
          The ring fills with a team's playoff odds. The tick under it is the team's color.
        </span>
      </div>
      <p className="mt-1.5">
        A goal sends a ring out from its arena. M is its magnitude, how far it moved everyone's
        odds; pp means percentage points. <span className="up">Blue</span> rises,{" "}
        <span className="down">red</span> falls. A small number beside a team is its score in a game
        on now.
      </p>
    </figure>
  );
}
