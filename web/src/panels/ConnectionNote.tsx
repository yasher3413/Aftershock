import { useEffect, useState } from "react";
import { useLive } from "../live/store";
import { useClock } from "../live/clock";

/** Tells the viewer when live updates have stalled, and that it is retrying. */
export function ConnectionNote() {
  const connection = useLive((s) => s.connection);
  const last = useLive((s) => s.lastMessageAt);
  const mode = useClock((s) => s.mode);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);
  if (mode !== "live" || connection === "open" || connection === "idle") return null;
  const mins = last ? Math.max(1, Math.round((now - last) / 60000)) : null;
  return (
    <div
      role="status"
      className="border-b border-ice-scratch bg-ice-land px-4 py-1.5 text-[13px] md:px-6"
    >
      Live feed paused.
      {mins ? ` Last update ${mins} ${mins === 1 ? "minute" : "minutes"} ago.` : ""} Retrying.
    </div>
  );
}
