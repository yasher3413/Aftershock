import { useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from "react";
import { freeSpot, type KeyNode } from "./keySpot";

const NARROW = "17rem";
const WIDE = "32rem";

/** The map's key: what a node's ring and tick mean, and how goals are
 * measured. From tablet width it sits wherever along the bottom or top edge
 * it covers no team. On phones, or when every spot would cover a team, it
 * waits behind a button. */
export function MapKey({
  nodes,
  width,
  height,
}: {
  nodes: KeyNode[];
  width: number;
  height: number;
}) {
  const [open, setOpen] = useState(false);
  // The key's shape: tall and narrow first, then wide and short when the
  // map's free strip is too low for the tall one.
  const [place, setPlace] = useState<{ left: number; top: number; wide: boolean } | null>(null);
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !nodes.length || !width || !height) return;
    // Measure each shape at full size, even while the key is folded away.
    const prev = el.style.cssText;
    let found: { left: number; top: number; wide: boolean } | null = null;
    for (const wide of [false, true]) {
      el.style.cssText = `display:block;visibility:hidden;max-width:${wide ? WIDE : NARROW}`;
      const spot = freeSpot(el.offsetWidth, el.offsetHeight, width, height, nodes);
      if (spot) {
        found = { ...spot, wide };
        break;
      }
    }
    el.style.cssText = prev;
    setPlace(found);
  }, [nodes, width, height]);

  const spot = place;
  const fits = spot !== null;
  return (
    <>
      <button
        type="button"
        aria-expanded={open || fits}
        aria-controls="map-key"
        onClick={() => setOpen((o) => !o)}
        className={`absolute bottom-2 left-2 z-10 min-h-[44px] rounded-[var(--radius)] border border-ice-scratch bg-surface/95 px-3 text-[13px] font-semibold text-ink ${fits ? "sm:hidden" : ""}`}
      >
        {open ? "Hide key" : "Map key"}
      </button>
      <Key
        ref={ref}
        // Opened from the button it sits above it; otherwise in its free spot.
        style={
          !open && spot
            ? { left: spot.left, top: spot.top, maxWidth: spot.wide ? WIDE : NARROW }
            : undefined
        }
        className={open ? "bottom-14 left-2 block" : fits ? "hidden sm:block" : "hidden"}
      />
    </>
  );
}

function Key({
  ref,
  className,
  style,
}: {
  ref: Ref<HTMLElement>;
  className: string;
  style?: CSSProperties;
}) {
  return (
    <figure
      ref={ref}
      id="map-key"
      style={style}
      aria-label="Map key"
      className={`pointer-events-none absolute z-10 max-w-[17rem] rounded-[var(--radius)] border border-ice-scratch bg-surface/95 px-3 py-2 text-[12px] leading-snug text-ink-soft ${className}`}
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
        <span className="down">red</span> falls. A pulsing arena has a game on now; scores are in
        tonight&apos;s list.
      </p>
    </figure>
  );
}
