import { useEffect, useState } from "react";
import { Link } from "react-router";
import { duration, longDate } from "../lib/format";
import { useLive } from "../live/store";

/** Persistent notice that the map is a replay, never live. */
export function ReplayBanner() {
  const mode = useLive((s) => s.mode);
  const replay = useLive((s) => s.replay);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (mode !== "demo" || !replay) return null;
  const next = replay.next_live_utc ? Date.parse(replay.next_live_utc) - now : null;
  return (
    <div
      role="note"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ice-scratch bg-ink px-4 py-2 text-[13px] text-ice md:px-6"
    >
      <span className="font-semibold">Replaying {longDate(replay.night_date)}.</span>
      {next != null && next > 0 && <span>Next live game in {duration(next)}.</span>}
      <Link to="/night/today" className="underline underline-offset-2">
        Tonight's schedule
      </Link>
    </div>
  );
}
