import { Link } from "react-router";
import { useRecap } from "../api/client";
import { useLive } from "../live/store";
import { useClock } from "../live/clock";

function lastNight(): string {
  const d = new Date(Date.now() - 30 * 3600_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Last night's recap, shown the next day until tonight's games start. */
export function RecapCard() {
  const ready = useLive((s) => s.recapReady);
  const mode = useClock((s) => s.mode);
  const date = ready ?? lastNight();
  const { data } = useRecap(date);
  if (!data || mode === "replay") return null;
  return (
    <section aria-labelledby="recap-h" className="px-4 py-3">
      <h2 id="recap-h" className="text-[12px] font-semibold text-ink-soft">
        Last night
      </h2>
      <p className="mt-1 text-[15px] font-semibold leading-snug">{data.headline}</p>
      <p className="mt-1 line-clamp-4 text-[13px] text-ink-soft">{data.body}</p>
      <Link
        to={`/night/${data.night_date}`}
        className="mt-1 inline-block text-[13px] font-semibold text-blue-line"
      >
        Replay the night
      </Link>
    </section>
  );
}
