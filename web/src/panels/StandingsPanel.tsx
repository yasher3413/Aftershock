import { useState } from "react";
import { Link } from "react-router";
import { motion, useReducedMotion } from "motion/react";
import type { StandingsRow, TeamOdds } from "../api/types.gen";
import { pct } from "../lib/format";
import { useLive } from "../live/store";
import { useMyTeam } from "../lib/myTeam";

const CONFS = ["Eastern", "Western"] as const;

function Row({
  r,
  odds,
  mine,
  cutline = false,
}: {
  r: StandingsRow;
  odds?: TeamOdds;
  mine: boolean;
  cutline?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.li
      layout={reduce ? false : "position"}
      transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
      className={`grid grid-cols-[2.6rem_2rem_1fr_3.2rem_2.4rem] items-center gap-2 py-1 text-[13px] ${mine ? "font-semibold" : ""} ${cutline ? "border-t border-dashed border-goal/50" : ""}`}
    >
      <Link to={`/team/${r.team}`} className="display text-[16px] font-bold">
        {r.team}
      </Link>
      <span className="text-right tabular-nums">{r.points}</span>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-ice-scratch"
        role="img"
        aria-label={`Playoff odds ${pct(odds?.p_playoffs)}`}
      >
        <div className="h-full bg-ink" style={{ width: `${(odds?.p_playoffs ?? 0) * 100}%` }} />
      </div>
      <span className="text-right tabular-nums">{pct(odds?.p_playoffs)}</span>
      <span className="text-right tabular-nums text-ink-soft">
        {odds ? Math.round(odds.exp_points) : ""}
      </span>
    </motion.li>
  );
}

export function StandingsPanel() {
  const standings = useLive((s) => s.standings);
  const odds = useLive((s) => s.odds);
  const teams = useLive((s) => s.teams);
  const myTeam = useMyTeam((s) => s.team);
  const [conf, setConf] = useState<(typeof CONFS)[number]>(() =>
    myTeam && teams[myTeam]?.conference === "Western" ? "Western" : "Eastern",
  );
  const rows = standings.filter((r) => r.conference === conf);
  const divisions = [...new Set(rows.map((r) => r.division))].sort();
  const top3 = (d: string) =>
    rows
      .filter((r) => r.division === d)
      .sort((a, b) => a.division_rank - b.division_rank)
      .slice(0, 3);
  const wildcard = rows
    .filter((r) => (r.wildcard_rank ?? 0) > 0)
    .sort((a, b) => (a.wildcard_rank ?? 99) - (b.wildcard_rank ?? 99));

  return (
    <section aria-labelledby="standings-h" className="px-4 py-3">
      <div className="flex items-baseline justify-between">
        <h2 id="standings-h" className="display text-[24px] font-bold">
          Standings
        </h2>
        <div role="tablist" aria-label="Conference" className="flex gap-1 text-[13px]">
          {CONFS.map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={conf === c}
              onClick={() => setConf(c)}
              className={`rounded-[var(--radius)] px-2 py-0.5 ${conf === c ? "bg-ice-land font-semibold" : "text-ink-soft hover:text-ink"}`}
            >
              {c === "Eastern" ? "East" : "West"}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1 grid grid-cols-[2.6rem_2rem_1fr_3.2rem_2.4rem] gap-2 text-[11px] text-ink-soft">
        <span />
        <span className="text-right">Pts</span>
        <span>Playoff odds</span>
        <span />
        <span className="text-right" title="Projected points">
          Proj
        </span>
      </div>
      {divisions.map((d) => (
        <div key={d} className="mt-2">
          <h3 className="text-[15px] font-semibold text-ink-soft">{d}</h3>
          <ul>
            {top3(d).map((r) => (
              <Row key={r.team} r={r} odds={odds[r.team]} mine={r.team === myTeam} />
            ))}
          </ul>
        </div>
      ))}
      {wildcard.length > 0 && (
        <div className="mt-2">
          <h3 className="text-[15px] font-semibold text-ink-soft">Wild card</h3>
          <ul>
            {wildcard.map((r, i) => (
              <Row
                key={r.team}
                r={r}
                odds={odds[r.team]}
                mine={r.team === myTeam}
                cutline={i === 2}
              />
            ))}
          </ul>
        </div>
      )}
      {standings.length === 0 && (
        <p className="mt-2 text-[13px] text-ink-soft">Standings load with the first update.</p>
      )}
    </section>
  );
}
