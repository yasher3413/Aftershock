import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useNights } from "../api/client";
import type { NightInfo } from "../api/types.gen";
import { longDate } from "../lib/format";
import { useDocumentMeta } from "../lib/meta";
import { SEASONS, seasonLabel, seasonOf } from "../lib/season";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Months of a season that hold at least one night, in order. */
function seasonMonths(nights: NightInfo[]): { y: number; m: number }[] {
  const seen = new Map<string, { y: number; m: number }>();
  for (const n of nights) {
    const [y, m] = n.night_date.split("-").map(Number) as [number, number];
    seen.set(`${y}-${m}`, { y, m: m - 1 });
  }
  return [...seen.values()].sort((a, b) => a.y - b.y || a.m - b.m);
}

/**
 * Five intensity classes on a log scale of the night's seismic energy, like a
 * seismic intensity scale. The fills skip the mid-greys where neither dark
 * nor light numerals stay readable.
 */
const LEVELS = [
  { fill: 6, text: "var(--ink)" },
  { fill: 15, text: "var(--ink)" },
  { fill: 27, text: "var(--ink)" },
  { fill: 78, text: "var(--ice)" },
  { fill: 100, text: "var(--ice)" },
];

function level(energy: number, max: number): (typeof LEVELS)[number] {
  const f = energy <= 0 || max <= 1 ? 0 : Math.log10(1 + energy) / Math.log10(1 + max);
  return LEVELS[Math.min(LEVELS.length - 1, Math.floor(f * LEVELS.length))]!;
}

function Month({
  y,
  m,
  byDate,
  max,
}: {
  y: number;
  m: number;
  byDate: Map<string, NightInfo>;
  max: number;
}) {
  const first = new Date(Date.UTC(y, m, 1));
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const lead = first.getUTCDay();
  const name = first.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <section aria-label={name} className="min-w-0">
      <h2 className="display border-b-2 border-ink pb-1 text-[20px] font-bold">{name}</h2>
      <div className="mt-2 grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((d, i) => (
          <div key={i} aria-hidden className="text-[11px] text-ink-soft">
            {d}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`lead-${i}`} aria-hidden />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const date = iso(new Date(Date.UTC(y, m, i + 1)));
          const n = byDate.get(date);
          if (!n)
            return (
              <div key={date} className="py-1.5 text-[13px] text-ink-soft tabular-nums">
                {i + 1}
              </div>
            );
          const lv = level(n.total_energy, max);
          return (
            <Link
              key={date}
              to={`/night/${date}`}
              aria-label={`${longDate(date)}: ${n.n_games} games, ${n.n_tremors} goals`}
              title={`${n.n_games} games, ${n.n_tremors} goals`}
              className="rounded-[3px] py-1.5 text-[13px] font-semibold tabular-nums outline-offset-1 hover:ring-2 hover:ring-blue-line"
              style={{
                background: `color-mix(in srgb, var(--ink) ${lv.fill}%, var(--ice))`,
                color: lv.text,
              }}
            >
              {i + 1}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export default function NightsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const season = Number(params.get("season")) || SEASONS[0]!;
  const { data: nights = [], isLoading } = useNights(season);
  const [jump, setJump] = useState("");
  useDocumentMeta("Every night", "Replay any night of the last three seasons, goal by goal.");

  const byDate = useMemo(() => new Map(nights.map((n) => [n.night_date, n])), [nights]);
  const max = Math.max(1, ...nights.map((n) => n.total_energy));
  const months = seasonMonths(nights);
  const top = [...nights].sort((a, b) => b.total_energy - a.total_energy).slice(0, 5);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[48px] font-extrabold leading-none">Every night</h1>
          <p className="mt-2 max-w-[62ch] text-[14px] text-ink-soft">
            Pick a night to replay it goal by goal. The stronger the shading, the harder that night
            shook the playoff race.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <select
            value={season}
            onChange={(e) => setParams({ season: e.target.value })}
            aria-label="Season"
            className="rounded-[var(--radius)] border border-ice-scratch bg-surface px-2 py-1"
          >
            {SEASONS.map((s) => (
              <option key={s} value={s}>
                {seasonLabel(s)}
              </option>
            ))}
          </select>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!jump) return;
              const s = seasonOf(jump);
              if (s !== season) setParams({ season: String(s) });
              navigate(`/night/${jump}`);
            }}
          >
            <label htmlFor="jump" className="text-ink-soft">
              Go to a date
            </label>
            <input
              id="jump"
              type="date"
              value={jump}
              onChange={(e) => setJump(e.target.value)}
              className="rounded-[var(--radius)] border border-ice-scratch bg-surface px-2 py-1 text-ink"
            />
            <button
              type="submit"
              className="rounded-[var(--radius)] bg-ink px-3 py-1 font-semibold text-ice"
            >
              Open
            </button>
          </form>
        </div>
      </div>

      {top.length > 0 && (
        <section aria-labelledby="top-h" className="mt-6">
          <h2 id="top-h" className="text-[13px] text-ink-soft">
            The season's biggest nights
          </h2>
          <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
            {top.map((n) => (
              <li key={n.night_date}>
                <Link
                  to={`/night/${n.night_date}`}
                  className="display text-[19px] font-bold underline-offset-4 hover:underline"
                >
                  {longDate(n.night_date)}
                </Link>{" "}
                <span className="text-[13px] text-ink-soft">{n.n_games} games</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isLoading ? (
        <p className="mt-8 text-ink-soft">Loading the season</p>
      ) : months.length === 0 ? (
        <p className="mt-8 text-ink-soft">
          No replays for {seasonLabel(season)} yet. Each night is added once its games are final.
        </p>
      ) : (
        <div className="mt-8 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {months.map(({ y, m }) => (
            <Month key={`${y}-${m}`} y={y} m={m} byDate={byDate} max={max} />
          ))}
        </div>
      )}
    </div>
  );
}
