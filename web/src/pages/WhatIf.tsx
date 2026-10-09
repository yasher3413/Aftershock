import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { motion, useReducedMotion } from "motion/react";
import { useQuery } from "@tanstack/react-query";
import { api, useStateQuery } from "../api/client";
import { pct, pp } from "../lib/format";
import { useDocumentMeta } from "../lib/meta";
import {
  applyScenario,
  chaos,
  pickTeam,
  decode,
  encode,
  type Bootstrap,
  type Outcome,
  type Scenario,
  toSimInput,
} from "../whatif/scenario";
import { useSimulator, type SimOutput } from "../whatif/useSimulator";
import { TeamLogo } from "../components/TeamLogo";

const N_SIMS = 10_000;
const DEBOUNCE_MS = 150;
const RANGES = [
  { id: "7", label: "Next 7 days", days: 7 },
  { id: "30", label: "Next 30 days", days: 30 },
  { id: "all", label: "Rest of season", days: 400 },
];

const HOW: Record<string, string> = {
  reg: "in regulation",
  ot: "in overtime",
  so: "in a shootout",
};

/** A team code on the pick sheet; a pick is a pen ring around the winner. */
function PickCode({ code, ringed }: { code: string; ringed: boolean }) {
  return (
    <span className="relative inline-flex h-10 w-[6.5rem] items-center justify-center">
      {ringed && (
        <svg
          aria-hidden
          viewBox="0 0 104 40"
          className="absolute inset-0 h-full w-full overflow-visible"
          preserveAspectRatio="none"
        >
          <path
            d="M8 22 C 6 8, 56 2, 88 8 C 104 12, 102 32, 70 36 C 38 40, 4 34, 9 18"
            fill="none"
            stroke="var(--blue-line)"
            strokeWidth={2.2}
            strokeLinecap="round"
          />
        </svg>
      )}
      <span className="display relative inline-flex items-center gap-1.5 text-[26px] font-bold leading-none">
        <TeamLogo team={code} size={22} />
        {code}
      </span>
    </span>
  );
}

function outcomeLabel(o: Outcome, home: string, away: string): string {
  const winner = o.startsWith("home") ? home : away;
  const how = o.endsWith("reg")
    ? "in regulation"
    : o.endsWith("ot")
      ? "in overtime"
      : "in a shootout";
  return `${winner} wins ${how}`;
}

export default function WhatIfPage() {
  useDocumentMeta(
    "What-If Lab",
    "Pick results for upcoming games and rerun the season in your browser.",
  );
  const boot = useQuery({
    queryKey: ["whatif"],
    queryFn: () => api<Bootstrap>("/whatif/bootstrap"),
    staleTime: 300_000,
  });
  const state = useStateQuery();
  const [params, setParams] = useSearchParams();
  const scenarioKey = params.get("s");
  const scenario = useMemo(() => decode(scenarioKey), [scenarioKey]);
  const [undo, setUndo] = useState<Scenario | null>(null);
  const setScenario = (update: Scenario | ((current: Scenario) => Scenario)) => {
    setUndo(null);
    setParams(
      (current) => {
        const next = typeof update === "function" ? update(decode(current.get("s"))) : update;
        const encoded = encode(next);
        const result = new URLSearchParams(current);
        if (encoded) result.set("s", encoded);
        else result.delete("s");
        return result;
      },
      { replace: true },
    );
  };
  const [team, setTeam] = useState("");
  const [range, setRange] = useState("7");
  const [highStakes, setHighStakes] = useState(false);
  const [base, setBase] = useState<SimOutput | null>(null);
  const [out, setOut] = useState<SimOutput | null>(null);
  const [resultKey, setResultKey] = useState<string | null>(null);
  const [sort, setSort] = useState("odds");
  const [ms, setMs] = useState<number | null>(null);
  const sim = useSimulator();
  const reduce = useReducedMotion();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reality once, then the scenario on every change (debounced, same seed so changes are clean).
  useEffect(() => {
    if (!boot.data) return;
    sim.run(toSimInput(boot.data), N_SIMS).then((r) => r && setBase(r.result));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot.data]);

  useEffect(() => {
    if (!boot.data) return;
    const encoded = encode(scenario);
    let cancelled = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const id = sim.latestId() + 1;
      const r = await sim.run(toSimInput(applyScenario(boot.data!, scenario)), N_SIMS);
      if (!cancelled && r && sim.isLatest(id)) {
        setOut(r.result);
        setMs(r.ms);
        setResultKey(encoded);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, boot.data]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);
  const games = useMemo(() => {
    if (!boot.data) return [];
    const days = RANGES.find((r) => r.id === range)!.days;
    const until = now + days * 86_400_000;
    const stakesCut = (() => {
      const vals = boot.data.games
        .map((g) => g.stakes ?? 0)
        .filter((v) => v > 0)
        .sort((a, b) => b - a);
      return vals[Math.floor(vals.length * 0.25)] ?? 0;
    })();
    return boot.data.games.filter(
      (g) =>
        g.status === "future" &&
        Date.parse(g.start_utc) <= until &&
        (!team || g.home === team || g.away === team) &&
        (!highStakes || (g.stakes ?? 0) >= stakesCut),
    );
  }, [boot.data, range, team, highStakes, now]);

  const teamsInfo = Object.fromEntries((state.data?.teams ?? []).map((t) => [t.abbrev, t]));
  const baseBy = Object.fromEntries((base?.teams ?? []).map((t) => [t.team, t]));
  const changes = [...(out?.teams ?? [])].map((t) => ({
    ...t,
    change: baseBy[t.team] ? t.p_playoffs - baseBy[t.team]!.p_playoffs : 0,
  }));
  const rows = changes.sort((a, b) =>
    sort === "change" ? Math.abs(b.change) - Math.abs(a.change) : b.p_playoffs - a.p_playoffs,
  );
  const movers = [...changes].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 3);
  const pickCount =
    boot.data?.games.filter((g) => g.status === "future" && scenario[g.game_id]).length ?? 0;
  const updating = !out || sim.busy || resultKey !== encode(scenario);
  const focus = team ? changes.find((t) => t.team === team) : undefined;
  const clearFilters = () => {
    setTeam("");
    setRange("7");
    setHighStakes(false);
  };
  const byDay = games.reduce<Record<string, typeof games>>((acc, g) => {
    const d = new Date(g.start_utc).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    (acc[d] ??= []).push(g);
    return acc;
  }, {});

  if (boot.isError)
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <h1 className="display text-[44px] font-extrabold">What-If Lab</h1>
        <p className="mt-3 text-ink-soft">
          The game forecast could not load. Try again to get the current schedule and odds.
        </p>
        <button
          type="button"
          onClick={() => void boot.refetch()}
          className="mt-4 min-h-[44px] rounded-[var(--radius)] bg-ink px-4 font-semibold text-ice"
        >
          Retry forecast
        </button>
      </div>
    );

  const bracket = (conf: string) => {
    if (!out) return [];
    const inConf = out.teams.filter((t) => teamsInfo[t.team]?.conference === conf);
    const divisions = [...new Set(inConf.map((t) => teamsInfo[t.team]!.division))].sort();
    const pick = (cands: typeof inConf, slot: string, used: Set<string>) => {
      const best = cands
        .filter((t) => !used.has(t.team))
        .sort((a, b) => (b.seed_dist[slot] ?? 0) - (a.seed_dist[slot] ?? 0))[0];
      if (best) used.add(best.team);
      return best;
    };
    const used = new Set<string>();
    const d = divisions.map((dv) => {
      const c = inConf.filter((t) => teamsInfo[t.team]!.division === dv);
      return { dv, s: ["div1", "div2", "div3"].map((slot) => pick(c, slot, used)) };
    });
    const wc1 = pick(inConf, "wc1", used);
    const wc2 = pick(inConf, "wc2", used);
    return [
      [d[0]?.s[0], wc2],
      [d[0]?.s[1], d[0]?.s[2]],
      [d[1]?.s[0], wc1],
      [d[1]?.s[1], d[1]?.s[2]],
    ];
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[38px] font-extrabold leading-none sm:text-[60px]">
            What-If Lab
          </h1>
          <p className="mt-2 max-w-[58ch] text-[14px] text-ink-soft">
            Pick winners. See what changes for your team. Each pick reruns the season with the same
            random numbers, so you can compare the effect of your choices.
          </p>
        </div>
        <div className="text-right text-[13px] text-ink-soft" aria-live="polite">
          {updating
            ? "Updating your forecast"
            : ms != null
              ? `${N_SIMS.toLocaleString()} seasons in ${Math.round(ms)} ms`
              : ""}
          {sim.error && (
            <div role="alert" className="mt-2 text-ink">
              The simulation could not finish.{" "}
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="font-semibold text-blue-line underline"
              >
                Reload the lab
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-[13px]">
        <select
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          className="min-h-[44px] rounded-[var(--radius)] border border-ice-scratch bg-surface px-3 py-2"
          aria-label="Filter by team"
        >
          <option value="">All teams</option>
          {(boot.data?.teams ?? []).map((t) => (
            <option key={t} value={t}>
              {teamsInfo[t]?.name ?? t}
            </option>
          ))}
        </select>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          className="min-h-[44px] rounded-[var(--radius)] border border-ice-scratch bg-surface px-3 py-2"
          aria-label="Date range"
        >
          {RANGES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <label className="inline-flex min-h-[44px] items-center gap-2">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={highStakes}
            onChange={(e) => setHighStakes(e.target.checked)}
          />{" "}
          High stakes only
        </label>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className="min-h-[44px] rounded-[var(--radius)] border border-ice-scratch px-3 py-2 font-semibold disabled:opacity-50"
            disabled={pickCount === 0}
            onClick={() => {
              setScenario({});
              setUndo(scenario);
            }}
          >
            Reset picks
          </button>
          <button
            type="button"
            className="min-h-[44px] rounded-[var(--radius)] border border-ice-scratch px-3 py-2 font-semibold disabled:opacity-50"
            disabled={!games.some((g) => !scenario[g.game_id] && Date.parse(g.start_utc) >= now)}
            onClick={() => {
              if (!boot.data) return;
              setScenario(
                chaos(
                  { ...boot.data, games },
                  scenario,
                  Date.now(),
                  RANGES.find((r) => r.id === range)!.days,
                ),
              );
              setUndo(scenario);
            }}
          >
            Randomize picks
          </button>
        </div>
      </div>

      <p className="mt-2 max-w-[62ch] text-[12px] text-ink-soft">
        Randomize fills undecided upcoming games shown by your filters. Reset clears picks, not
        filters.
        {undo && (
          <button
            type="button"
            onClick={() => setScenario(undo)}
            className="ml-2 min-h-8 font-semibold text-blue-line underline"
          >
            Undo last action
          </button>
        )}
      </p>
      <div className="sticky top-0 z-20 mt-5 flex flex-wrap items-center justify-between gap-3 border-y-2 border-ink bg-surface px-4 py-3">
        <div className="min-w-0" aria-live="polite">
          <p className="text-[14px] font-semibold">
            {pickCount
              ? `${pickCount} ${pickCount === 1 ? "pick" : "picks"} in your scenario`
              : "No picks yet: current forecast"}
          </p>
          <p className="mt-1 text-[13px] text-ink-soft">
            {updating
              ? "Recalculating odds"
              : focus
                ? `${focus.team}: ${pct(focus.p_playoffs)} playoffs (${pp(focus.change)} from your picks)`
                : pickCount && movers[0]
                  ? `Largest change: ${movers[0].team} ${pp(movers[0].change)}`
                  : "Choose a team below to start."}
          </p>
        </div>
        <a
          href="#scenario-results"
          className="inline-flex min-h-[44px] items-center rounded-[var(--radius)] bg-ink px-4 text-[13px] font-semibold text-ice"
        >
          View results
        </a>
      </div>

      <div className="mt-6 grid items-start gap-8 lg:grid-cols-[1fr_1.1fr]">
        <section aria-label="Games" className="lg:max-h-[75vh] lg:overflow-y-auto lg:pr-2">
          {/* Same header frame as the forecast's, so the two columns align. */}
          <div className="flex min-h-[56px] flex-wrap items-end border-b-2 border-ink pb-3">
            <h2 className="display text-[30px] font-bold">Pick the results</h2>
          </div>
          <p className="mt-3 mb-5 text-[13px] text-ink-soft">
            Choose a winner, then use the win-type menu. Clicking a chosen team cycles regulation,
            overtime, shootout, and clear.
          </p>
          {Object.keys(byDay).length === 0 && (
            <div className="border-y border-ice-scratch py-6">
              <p className="text-ink-soft">No games match these filters.</p>
              <button
                type="button"
                onClick={clearFilters}
                className="mt-2 min-h-[44px] font-semibold text-blue-line underline"
              >
                Clear filters
              </button>
            </div>
          )}
          {Object.entries(byDay).map(([day, gs]) => (
            <div key={day} className="mb-5">
              <h2 className="display border-b-2 border-ink pb-1 text-[24px] font-bold">{day}</h2>
              <ul className="divide-y divide-ice-scratch">
                {gs.map((g) => {
                  const o = scenario[g.game_id];
                  const hw = (g.probs?.[0] ?? 0) + (g.probs?.[1] ?? 0) + (g.probs?.[2] ?? 0);
                  return (
                    <li
                      key={g.game_id}
                      className="grid grid-cols-[6.5rem_1.5rem_6.5rem_1fr] items-center py-1.5"
                    >
                      {(["away", "home"] as const).map((side, k) => {
                        const code = side === "home" ? g.home : g.away;
                        const next = pickTeam(o, side);
                        return [
                          k === 1 && (
                            <span key="at" className="text-center text-[13px] text-ink-soft">
                              at
                            </span>
                          ),
                          <button
                            key={side}
                            type="button"
                            aria-pressed={!!o && o.startsWith(side)}
                            onClick={() =>
                              setScenario((s) => {
                                const copy = { ...s };
                                const n = pickTeam(s[g.game_id], side);
                                if (n) copy[g.game_id] = n;
                                else delete copy[g.game_id];
                                return copy;
                              })
                            }
                            className={`flex min-h-[44px] items-center justify-center rounded-[var(--radius)] transition-colors hover:bg-ice-land focus-visible:bg-ice-land ${o && o.startsWith(side) ? "" : "bg-surface ring-1 ring-ice-scratch ring-inset"}`}
                            aria-label={`${g.away} at ${g.home}, ${o ? outcomeLabel(o, g.home, g.away) : "Not decided"}. ${next ? `Pick ${code} to win ${HOW[next.slice(next.indexOf("_") + 1)]}` : "Clear the pick"}.`}
                          >
                            <PickCode code={code} ringed={!!o && o.startsWith(side)} />
                          </button>,
                        ];
                      })}
                      <span
                        className={`text-right text-[13px] ${o ? "font-semibold text-blue-line" : "text-ink-soft"}`}
                      >
                        {o
                          ? HOW[o.slice(o.indexOf("_") + 1)]
                          : `${g.home} ${pct(g.p_home_win ?? hw, 0)} to win`}
                      </span>
                      {o && (
                        <div className="col-span-4 mt-2 flex items-center justify-between gap-2 pb-2 text-[13px]">
                          <label className="inline-flex items-center gap-2 text-ink-soft">
                            Win type
                            <select
                              aria-label={`Win type for ${g.away} at ${g.home}`}
                              value={o.split("_")[1]}
                              onChange={(e) =>
                                setScenario((s) => ({
                                  ...s,
                                  [g.game_id]:
                                    `${o.startsWith("home") ? "home" : "away"}_${e.target.value}` as Outcome,
                                }))
                              }
                              className="min-h-[44px] rounded-[var(--radius)] border border-ice-scratch bg-surface px-2 text-ink"
                            >
                              <option value="reg">Regulation</option>
                              <option value="ot">Overtime</option>
                              <option value="so">Shootout</option>
                            </select>
                          </label>
                          <button
                            type="button"
                            aria-label={`Clear pick for ${g.away} at ${g.home}`}
                            onClick={() =>
                              setScenario((s) => {
                                const copy = { ...s };
                                delete copy[g.game_id];
                                return copy;
                              })
                            }
                            className="min-h-[44px] px-2 font-semibold text-blue-line"
                          >
                            Clear pick
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>

        <section
          id="scenario-results"
          aria-label="Playoff odds under this scenario"
          className="scroll-mt-28"
        >
          <div className="flex min-h-[56px] flex-wrap items-end justify-between gap-3 border-b-2 border-ink pb-3">
            <h2 className="display text-[30px] font-bold">Your forecast</h2>
            <label className="text-[13px] text-ink-soft">
              Sort{" "}
              <select
                aria-label="Sort forecast"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="ml-2 min-h-[44px] rounded-[var(--radius)] border border-ice-scratch bg-surface px-2 text-ink"
              >
                <option value="odds">Playoff odds</option>
                <option value="change">Biggest change</option>
              </select>
            </label>
          </div>
          <p className="mt-3 text-[13px] text-ink-soft">
            {pickCount > 0
              ? "Change compares your picks with the current forecast, in percentage points. Small differences are estimates, not guarantees."
              : "The current forecast for every team. Pick a result to see how it would change."}
          </p>
          {pickCount > 0 && !updating && (
            <ul className="mt-4 divide-y divide-ice-scratch border-y border-ice-scratch">
              {movers
                .filter((t) => Math.abs(t.change) >= 0.0005)
                .map((t) => (
                  <li key={t.team} className="flex items-center justify-between py-3">
                    <Link
                      to={`/team/${t.team}`}
                      className="display flex items-center gap-2 text-[24px] font-bold"
                    >
                      <TeamLogo team={t.team} size={28} />
                      {t.team}
                    </Link>
                    <span
                      className={`display text-[30px] font-bold ${t.change > 0 ? "up" : "down"}`}
                    >
                      {pp(t.change)}
                    </span>
                  </li>
                ))}
            </ul>
          )}
          <table className="mt-5 w-full text-[14px]">
            <thead className="text-left text-[12px] text-ink-soft">
              <tr>
                <th className="font-normal">Team</th>
                <th className="text-right font-normal">Playoff odds</th>
                {pickCount > 0 && <th className="text-right font-normal">Change (pp)</th>}
                <th className="text-right font-normal">Cup odds</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const d = baseBy[t.team] ? t.p_playoffs - baseBy[t.team]!.p_playoffs : 0;
                return (
                  <motion.tr
                    key={t.team}
                    layout={reduce ? false : "position"}
                    className="border-t border-ice-scratch"
                  >
                    <td className="py-2">
                      <Link
                        to={`/team/${t.team}`}
                        className="display inline-flex items-center gap-2 text-[20px] font-bold"
                      >
                        <TeamLogo team={t.team} size={22} />
                        {t.team}
                      </Link>
                    </td>
                    <td className="text-right tabular-nums">{pct(t.p_playoffs)}</td>
                    {pickCount > 0 && (
                      <td
                        className={`text-right tabular-nums ${Math.abs(d) < 0.0005 ? "text-ink-soft" : d > 0 ? "up" : "down"}`}
                      >
                        {pp(d)}
                      </td>
                    )}
                    <td className="text-right tabular-nums">{pct(t.p_cup)}</td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
          <details className="mt-8 border-t border-ice-scratch pt-3">
            <summary className="display flex min-h-[44px] cursor-pointer items-center text-[24px] font-bold">
              Explore a projected playoff bracket
            </summary>
            <p className="mt-2 text-[13px] text-ink-soft">
              One possible matchup projection from the simulated seed probabilities. The actual
              bracket can differ.
            </p>
            <div className="mt-5 grid gap-6 sm:grid-cols-2">
              {["Eastern", "Western"].map((conf) => (
                <div key={conf}>
                  <h3 className="display border-b-2 border-ink pb-2 text-[24px] font-bold">
                    {conf}
                  </h3>
                  <ul>
                    {bracket(conf).map(([a, b], i) => (
                      <li
                        key={i}
                        className="display flex items-center gap-2 border-b border-ice-scratch py-3 text-[20px] font-bold"
                      >
                        {a && <TeamLogo team={a.team} size={24} />}
                        {a?.team ?? "?"}
                        <span className="text-[13px] font-normal text-ink-soft">vs</span>
                        {b && <TeamLogo team={b.team} size={24} />}
                        {b?.team ?? "?"}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        </section>
      </div>
    </div>
  );
}
