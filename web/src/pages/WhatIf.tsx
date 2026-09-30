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
    <span className="relative inline-flex h-10 w-[4.5rem] items-center justify-center">
      {ringed && (
        <svg
          aria-hidden
          viewBox="0 0 72 40"
          className="absolute inset-0 h-full w-full overflow-visible"
          preserveAspectRatio="none"
        >
          <path
            d="M8 22 C 6 8, 40 2, 60 8 C 72 12, 70 32, 48 36 C 26 40, 4 34, 9 18"
            fill="none"
            stroke="var(--blue-line)"
            strokeWidth={2.2}
            strokeLinecap="round"
          />
        </svg>
      )}
      <span className="display relative text-[26px] font-bold leading-none">{code}</span>
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
  const [scenario, setScenario] = useState<Scenario>(() => decode(params.get("s")));
  const [team, setTeam] = useState("");
  const [range, setRange] = useState("7");
  const [highStakes, setHighStakes] = useState(false);
  const [base, setBase] = useState<SimOutput | null>(null);
  const [out, setOut] = useState<SimOutput | null>(null);
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
    setParams(encoded ? { s: encoded } : {}, { replace: true });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const id = sim.latestId() + 1;
      const r = await sim.run(toSimInput(applyScenario(boot.data!, scenario)), N_SIMS);
      if (r && sim.isLatest(id)) {
        setOut(r.result);
        setMs(r.ms);
      }
    }, DEBOUNCE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, boot.data]);

  const [now] = useState(() => Date.now());
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
  const rows = [...(out?.teams ?? [])].sort((a, b) => b.p_playoffs - a.p_playoffs);
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
          The simulator's data is built by the live worker after its first run. Try again in a
          minute.
        </p>
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
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[48px] font-extrabold leading-none">What-If Lab</h1>
          <p className="mt-2 max-w-[62ch] text-[14px] text-ink-soft">
            Click a team to pick it to win. Click it again for overtime, again for a shootout, and
            once more to clear. Every change reruns the rest of the season {N_SIMS.toLocaleString()}{" "}
            times in your browser with the same random numbers, so the differences you see come from
            your picks, not luck.
          </p>
        </div>
        <div className="text-right text-[13px] text-ink-soft" aria-live="polite">
          {sim.busy
            ? "Simulating"
            : ms != null
              ? `${N_SIMS.toLocaleString()} seasons in ${Math.round(ms)} ms`
              : ""}
          {sim.error && <div className="down">Simulation failed: {sim.error}</div>}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-[13px]">
        <select
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          className="rounded-[var(--radius)] border border-ice-scratch bg-surface px-2 py-1"
          aria-label="Filter by team"
        >
          <option value="">All teams</option>
          {(boot.data?.teams ?? []).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          className="rounded-[var(--radius)] border border-ice-scratch bg-surface px-2 py-1"
          aria-label="Date range"
        >
          {RANGES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={highStakes}
            onChange={(e) => setHighStakes(e.target.checked)}
          />{" "}
          High stakes only
        </label>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className="rounded-[var(--radius)] border border-ice-scratch px-3 py-1.5 font-semibold"
            onClick={() => setScenario({})}
          >
            Reset
          </button>
          <button
            type="button"
            className="rounded-[var(--radius)] bg-ink px-3 py-1.5 font-semibold text-ice"
            onClick={() => boot.data && setScenario((s) => chaos(boot.data!, s, Date.now()))}
          >
            Chaos
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-8 lg:grid-cols-[1fr_1.1fr]">
        <section aria-label="Games" className="max-h-[70vh] overflow-y-auto pr-1">
          {Object.keys(byDay).length === 0 && (
            <p className="text-ink-soft">No games match these filters.</p>
          )}
          {Object.entries(byDay).map(([day, gs]) => (
            <div key={day} className="mb-5">
              <h2 className="display border-b-2 border-ink pb-1 text-[20px] font-bold">{day}</h2>
              <ul className="divide-y divide-ice-scratch">
                {gs.map((g) => {
                  const o = scenario[g.game_id];
                  const hw = (g.probs?.[0] ?? 0) + (g.probs?.[1] ?? 0) + (g.probs?.[2] ?? 0);
                  return (
                    <li
                      key={g.game_id}
                      className="grid grid-cols-[4.5rem_1.5rem_4.5rem_1fr] items-center py-1.5"
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
                            className="rounded-[var(--radius)] hover:bg-ice-land focus-visible:bg-ice-land"
                            aria-label={`${g.away} at ${g.home}, ${o ? outcomeLabel(o, g.home, g.away) : "Not decided"}. ${next ? `Pick ${code} to win ${HOW[next.slice(next.indexOf("_") + 1)]}` : "Clear the pick"}.`}
                          >
                            <PickCode code={code} ringed={!!o && o.startsWith(side)} />
                          </button>,
                        ];
                      })}
                      <span
                        className={`text-right text-[14px] ${o ? "font-semibold text-blue-line" : "text-ink-soft"}`}
                      >
                        {o
                          ? HOW[o.slice(o.indexOf("_") + 1)]
                          : `${g.home} ${pct(g.p_home_win ?? hw, 0)} to win`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>

        <section aria-label="Playoff odds under this scenario">
          <div className="grid gap-6 sm:grid-cols-2">
            {["Eastern", "Western"].map((conf) => (
              <div key={conf}>
                <h2 className="display border-b-2 border-ink pb-1 text-[20px] font-bold">
                  {conf} bracket, most likely
                </h2>
                <ul className="mt-1 text-[13px]">
                  {bracket(conf).map(([a, b], i) => (
                    <li key={i} className="flex justify-between border-t border-ice-scratch py-1">
                      <span className="display text-[16px] font-bold">
                        {a?.team ?? "?"}{" "}
                        <span className="text-[12px] font-normal text-ink-soft">vs</span>{" "}
                        {b?.team ?? "?"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <table className="mt-5 w-full text-[13px]">
            <thead className="text-left text-[12px] text-ink-soft">
              <tr>
                <th className="font-normal">Team</th>
                <th className="text-right font-normal">Playoff odds</th>
                <th className="text-right font-normal">Change (percentage points)</th>
                <th className="text-right font-normal">Cup</th>
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
                    <td className="py-1">
                      <Link to={`/team/${t.team}`} className="display text-[15px] font-bold">
                        {t.team}
                      </Link>
                    </td>
                    <td className="text-right tabular-nums">{pct(t.p_playoffs)}</td>
                    <td
                      className={`text-right tabular-nums ${Math.abs(d) < 0.0005 ? "text-ink-soft" : d > 0 ? "up" : "down"}`}
                    >
                      {pp(d)}
                    </td>
                    <td className="text-right tabular-nums">{pct(t.p_cup)}</td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
