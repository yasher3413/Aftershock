/** The map's key: what a node's ring and tick mean, and how goals are measured. */
export function MapKey() {
  return (
    <figure
      aria-label="Map key"
      className="pointer-events-none absolute bottom-3 left-3 hidden max-w-[17rem] rounded-[var(--radius)] border border-ice-scratch bg-surface/90 px-3 py-2 text-[12px] leading-snug text-ink-soft sm:block"
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
        <span className="down">red</span> falls.
      </p>
    </figure>
  );
}
