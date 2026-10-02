import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, useNights, useRecap } from "../api/client";
import { TeamLogo } from "../components/TeamLogo";
import type { GameSummary, NightInfo } from "../api/types.gen";
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
      <h2 className="display border-b-2 border-ink pb-1 text-[30px] font-bold">{name}</h2>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((d, i) => (
          <div key={i} aria-hidden className="text-[12px] text-ink-soft">
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
              <div
                key={date}
                className="flex h-10 items-center justify-center text-[13px] text-ink-soft tabular-nums"
              >
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
              className="flex h-10 items-center justify-center rounded-[3px] text-[14px] font-semibold tabular-nums outline-offset-1 hover:ring-2 hover:ring-blue-line"
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

function LatestNight({ night }: { night: NightInfo }) {
  const recap = useRecap(night.night_date);
  const { data: games = [] } = useQuery({
    queryKey: ["games", night.night_date],
    queryFn: () => api<GameSummary[]>(`/games?date=${night.night_date}`),
  });
  return (
    <section aria-label="Latest replay" className="min-w-0 bg-surface p-5 md:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="display text-[38px] font-bold">{longDate(night.night_date)}</h2>
        <span className="rounded-[3px] bg-ice-land px-2.5 py-1 text-[12px] font-semibold">
          Latest replay
        </span>
      </div>
      <p className="mt-3 text-[14px] text-ink-soft">
        {night.n_games} {night.n_games === 1 ? "game" : "games"} / {night.n_tremors}{" "}
        {night.n_tremors === 1 ? "goal" : "goals"}
      </p>
      <h3 className="display mt-5 max-w-[30ch] text-[30px] font-bold leading-[1.1] md:text-[38px]">
        {recap.data?.headline ?? "Every goal. Every shift in the playoff race."}
      </h3>
      {games.length > 0 && (
        <ul className="mt-6 flex gap-5 overflow-x-auto border-y border-ice-scratch py-4">
          {games.map((g) => (
            <li key={g.id} className="shrink-0">
              <Link to={`/game/${g.id}`} className="block hover:text-blue-line">
                <div className="display flex items-center gap-2 text-[24px] font-bold">
                  <TeamLogo team={g.away} size={28} />
                  {g.away}
                  <span className="ml-auto pl-2">{g.away_score ?? ""}</span>
                </div>
                <div className="display mt-2 flex items-center gap-2 text-[24px] font-bold">
                  <TeamLogo team={g.home} size={28} />
                  {g.home}
                  <span className="ml-auto pl-2">{g.home_score ?? ""}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link
        to={`/night/${night.night_date}`}
        className="mt-6 inline-flex min-h-11 items-center gap-3 rounded-[var(--radius)] bg-ink px-5 py-2.5 text-[14px] font-semibold text-ice hover:bg-blue-line hover:text-surface"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <path d="M4 2l10 6-10 6z" />
        </svg>
        Replay this night
      </Link>
    </section>
  );
}

export default function NightsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const season = Number(params.get("season")) || SEASONS[0]!;
  const { data: nights = [], isLoading, isError, refetch } = useNights(season);
  const [jump, setJump] = useState("");
  useDocumentMeta("Every night", "Replay any night of the last three seasons, goal by goal.");

  const byDate = useMemo(() => new Map(nights.map((n) => [n.night_date, n])), [nights]);
  const max = Math.max(1, ...nights.map((n) => n.total_energy));
  const months = seasonMonths(nights);
  const latest = [...nights].sort((a, b) => b.night_date.localeCompare(a.night_date))[0];
  const top = [...nights].sort((a, b) => b.total_energy - a.total_energy).slice(0, 5);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[60px] font-extrabold leading-none">Every night</h1>
          <p className="mt-2 max-w-[52ch] text-[14px] text-ink-soft">
            The nights that moved the playoff race. Rewind the goals and watch the shockwaves
            unfold.
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

      {latest && (
        <div className="mt-8 grid border-y-2 border-ink lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <LatestNight key={latest.night_date} night={latest} />
          <section
            aria-labelledby="top-h"
            className="border-t border-ice-scratch p-5 md:p-7 lg:border-t-0 lg:border-l"
          >
            <h2 id="top-h" className="display text-[30px] font-bold">
              The season's biggest nights
            </h2>
            <p className="mt-2 text-[13px] text-ink-soft">
              Ranked by the goals' total seismic energy.
            </p>
            <ol className="mt-5 divide-y divide-ice-scratch">
              {top.map((n, i) => (
                <li key={n.night_date}>
                  <Link
                    to={`/night/${n.night_date}`}
                    className="group flex items-center gap-4 py-4"
                  >
                    <span className="display w-5 text-[30px] font-bold text-ink-soft" aria-hidden>
                      {i + 1}
                    </span>
                    <div>
                      <span className="display text-[24px] font-bold group-hover:text-blue-line">
                        {longDate(n.night_date)}
                      </span>
                      <span className="mt-1 block text-[13px] text-ink-soft">
                        {n.n_games} {n.n_games === 1 ? "game" : "games"} / {n.n_tremors}{" "}
                        {n.n_tremors === 1 ? "goal" : "goals"}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}

      {isLoading ? (
        <p className="mt-8 text-ink-soft">Loading the season</p>
      ) : isError ? (
        <div className="mt-8">
          <p className="text-ink-soft">The night archive could not load.</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-2 font-semibold text-blue-line underline"
          >
            Try again
          </button>
        </div>
      ) : months.length === 0 ? (
        <p className="mt-8 text-ink-soft">
          No replays for {seasonLabel(season)} yet. Each night is added once its games are final.
        </p>
      ) : (
        <section aria-labelledby="browse-h" className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="browse-h" className="display text-[38px] font-bold">
                Browse the season
              </h2>
              <p className="mt-2 text-[14px] text-ink-soft">
                Choose a shaded date to open its replay.
              </p>
            </div>
            <div
              className="flex items-center gap-2 text-[12px] text-ink-soft"
              aria-label="Shading shows seismic energy from quieter to stronger"
            >
              <span>Quieter</span>
              {LEVELS.map((lv) => (
                <span
                  key={lv.fill}
                  className="h-4 w-4 rounded-[2px]"
                  aria-hidden
                  style={{ background: `color-mix(in srgb, var(--ink) ${lv.fill}%, var(--ice))` }}
                />
              ))}
              <span>Stronger</span>
            </div>
          </div>
          <div className="mt-6 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {months.map(({ y, m }) => (
              <Month key={`${y}-${m}`} y={y} m={m} byDate={byDate} max={max} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
