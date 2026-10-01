import { Link } from "react-router";
import type { Tremor } from "../api/types.gen";
import { arrow, periodLabel, clock, pp } from "../lib/format";
import { useLive } from "../live/store";
import { useMyTeam } from "../lib/myTeam";

export function TremorLine({ t, myTeam }: { t: Tremor; myTeam: string | null }) {
  const movers = t.deltas.slice(0, 3);
  const mine = myTeam ? t.deltas.find((d) => d.team === myTeam) : undefined;
  return (
    <Link
      to={`/tremor/${t.id}`}
      className={`grid grid-cols-[3.2rem_1fr] gap-3 py-2 ${t.overturned ? "opacity-50" : ""}`}
    >
      <div className="display text-right text-[30px] font-extrabold leading-none">
        {t.magnitude.toFixed(1)}
      </div>
      <div className="min-w-0 text-[13px]">
        <div className="truncate font-semibold">
          {t.overturned ? "No goal: " : ""}
          {t.scorer?.name ?? "Goal"} <span className="font-normal text-ink-soft">({t.team})</span>
        </div>
        <div className="text-[12px] text-ink-soft">
          {t.away} {t.score_after.away}, {t.home} {t.score_after.home},{" "}
          {periodLabel(t.period, t.period_type)} {clock(t.t_period_s)}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] tabular-nums">
          {movers.map((d) => (
            <span key={d.team} className={d.d_playoffs > 0 ? "up" : "down"}>
              {d.team} {arrow(d.d_playoffs)} {pp(d.d_playoffs)}
            </span>
          ))}
        </div>
        {mine &&
          myTeam &&
          !movers.some((d) => d.team === myTeam) &&
          Math.abs(mine.d_playoffs) >= 0.0005 && (
            <div className={`text-[12px] ${mine.d_playoffs > 0 ? "up" : "down"}`}>
              {mine.d_playoffs > 0 ? "Helped" : "Cost"} {myTeam} {pp(Math.abs(mine.d_playoffs))}
            </div>
          )}
      </div>
    </Link>
  );
}

export function TremorFeed({ limit = 12 }: { limit?: number }) {
  const tremors = useLive((s) => s.tremors);
  const myTeam = useMyTeam((s) => s.team);
  const replaying = useLive((s) => s.mode === "demo");
  return (
    <section aria-labelledby="feed-h" className="px-4 py-3">
      <h2 id="feed-h" className="display text-[24px] font-bold">
        Tremors
      </h2>
      {tremors.length === 0 && (
        <p className="mt-2 text-[13px] text-ink-soft">
          {replaying
            ? "No goals yet in this replay. Each one shows up here with how far it moved the standings."
            : "No goals yet. Every goal tonight will show up here with how far it moved the standings."}
        </p>
      )}
      <ul className="divide-y divide-ice-scratch">
        {tremors.slice(0, limit).map((t) => (
          <li key={t.id}>
            <TremorLine t={t} myTeam={myTeam} />
          </li>
        ))}
      </ul>
    </section>
  );
}
