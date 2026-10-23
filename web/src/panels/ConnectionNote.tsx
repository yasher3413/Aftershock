import { useEffect, useState } from "react";
import { useLive } from "../live/store";
import { useClock } from "../live/clock";

/** How long the feed must stay down before the viewer hears about it. A
 * normal connect, or a reconnect after a blip, finishes well inside this. */
export const GRACE_MS = 5000;

/**
 * Tells the viewer when live updates have stalled, and that it is retrying.
 * It floats over the top of the map, so arriving or leaving never moves the
 * page.
 */
export function ConnectionNote() {
  const downSince = useLive((s) => s.downSince);
  const last = useLive((s) => s.lastMessageAt);
  const mode = useClock((s) => s.mode);
  const down = mode === "live" && downSince != null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!down) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [down]);

  if (!down || now - downSince < GRACE_MS) return null;
  const mins = last ? Math.max(1, Math.round((now - last) / 60000)) : null;
  return (
    <div
      role="status"
      className="pointer-events-none absolute left-1/2 top-3 z-20 max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-[var(--radius)] border border-ice-scratch bg-surface/95 px-3 py-1.5 text-center text-[13px] text-ink shadow-[0_2px_10px_rgba(10,20,30,0.12)]"
    >
      Live updates paused.
      {mins ? ` Last update ${mins} ${mins === 1 ? "minute" : "minutes"} ago.` : ""} Reconnecting.
    </div>
  );
}
