import { Link, useParams, useSearchParams } from "react-router";
import { scaleLinear, scaleTime } from "d3-scale";
import { usePlayer } from "../api/client";
import type { Tremor } from "../api/types.gen";
import { useWidth } from "../charts/useWidth";
import { Headshot } from "../components/Headshot";
import { TeamLogo } from "../components/TeamLogo";
import { longDate, magnitude, pp } from "../lib/format";
import { useDocumentMeta } from "../lib/meta";
import { seasonLabel } from "../lib/season";
import { TremorLine } from "../panels/TremorFeed";

const POSITIONS: Record<string, string> = {
  C: "Center",
  L: "Left wing",
  R: "Right wing",
  D: "Defense",
  G: "Goalie",
};

/** The season's goals as a seismograph record: one bar per goal, taller for higher magnitude. */
function GoalLog({ goals, width }: { goals: Tremor[]; width: number }) {
  const h = 150;
  const pad = { l: 8, r: 8, t: 22, b: 24 };
  if (goals.length === 0)
    return <p className="text-[15px] text-ink-soft">No goals this season yet.</p>;
  const times = goals.map((g) => Date.parse(`${g.night_date}T12:00:00Z`));
  const t0 = Math.min(...times) - 86_400_000 * 3;
  const t1 = Math.max(...times) + 86_400_000 * 3;
  const x = scaleTime()
    .domain([t0, t1])
    .range([pad.l, width - pad.r]);
  const y = scaleLinear()
    .domain([0, 10])
    .range([h - pad.b, pad.t]);
  const fmt = (t: number) =>
    new Date(t).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" });
  const ticks = x
    .ticks(Math.max(2, Math.floor(width / 110)))
    .map(Number)
    .filter((t, i, all) => i === 0 || fmt(t) !== fmt(all[i - 1]!));
  const top = [...goals].sort((a, b) => b.magnitude - a.magnitude)[0];
  return (
    <svg width={width} height={h} role="group" aria-label="Goals over the season by magnitude">
      <rect
        x={pad.l}
        y={pad.t}
        width={width - pad.l - pad.r}
        height={h - pad.t - pad.b}
        fill="var(--ice-land)"
      />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={pad.t} y2={h - pad.b} stroke="var(--ice-scratch)" />
          <text x={x(t) + 4} y={h - 8} fontSize={11} fill="var(--ink-soft)">
            {fmt(t)}
          </text>
        </g>
      ))}
      <line x1={pad.l} x2={width - pad.r} y1={y(0)} y2={y(0)} stroke="var(--ink)" />
      {goals.map((g, i) => {
        const gx = x(times[i]!);
        return (
          <Link
            key={g.id}
            to={`/tremor/${g.id}`}
            aria-label={`${longDate(g.night_date)}, magnitude ${magnitude(g.magnitude)}, ${pp(g.ppa)} for ${g.team}`}
          >
            <rect x={gx - 6} y={pad.t} width={12} height={h - pad.t - pad.b} fill="transparent" />
            <line
              x1={gx}
              x2={gx}
              y1={y(0)}
              y2={y(Math.max(0.25, g.magnitude))}
              stroke={g.ppa > 0 ? "var(--blue-line)" : "var(--ink)"}
              strokeWidth={3}
            />
            <title>{`${longDate(g.night_date)}: M${magnitude(g.magnitude)}, ${pp(g.ppa)}`}</title>
            {g === top && (
              <text
                x={gx}
                y={y(g.magnitude) - 5}
                textAnchor="middle"
                className="display"
                fontSize={15}
                fontWeight={700}
                fill="var(--ink)"
              >
                {magnitude(g.magnitude)}
              </text>
            )}
          </Link>
        );
      })}
    </svg>
  );
}

export default function PlayerPage() {
  const id = useParams().id ?? "";
  const [params, setParams] = useSearchParams();
  const season = Number(params.get("season")) || undefined;
  const { data, isLoading, isError } = usePlayer(id, season);
  const [ref, width] = useWidth<HTMLDivElement>(720);
  useDocumentMeta(
    data ? `${data.name}` : "Player",
    data
      ? `${data.name}: Playoff Probability Added and every goal's effect on the playoff race.`
      : undefined,
  );
  if (isLoading) return <div className="p-6 text-ink-soft">Loading</div>;
  if (isError || !data)
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <h1 className="display text-[38px] font-bold">No player with that id</h1>
        <Link
          to="/leaders"
          className="mt-4 inline-block text-blue-line underline underline-offset-4"
        >
          See the leaders
        </Link>
      </div>
    );
  const s = data.seasons.find((x) => x.season === data.season);
  const goalie = data.position === "G";
  const cells: [string, string][] = goalie
    ? [
        ["Goals allowed", String(s?.goals_allowed ?? 0)],
        ["PPA allowed", pp(s?.goalie_ppa_allowed ?? 0)],
      ]
    : [
        ["Goals", String(s?.goals ?? 0)],
        ["Playoff Probability Added", pp(s?.ppa ?? 0)],
        ["Assist PPA", pp(s?.assist_ppa ?? 0)],
        ["On-ice PPA", s?.on_ice_ppa != null ? pp(s.on_ice_ppa) : "-"],
      ];
  const biggest = [...data.goals].sort((a, b) => b.magnitude - a.magnitude).slice(0, 5);
  const seasonIds = [...new Set([data.season, ...data.seasons.map((x) => x.season)])].sort(
    (a, b) => b - a,
  );
  // Early in a season the card is nearly empty: point at the last season with goals.
  const previous = data.seasons.find(
    (x) => x.season < data.season && (goalie ? x.goals_allowed > 0 : x.goals > 0),
  );
  const quiet = !goalie && (s?.goals ?? 0) === 0;
  return (
    <div className="w-full">
      <header className="border-b border-ice-scratch bg-ice-land">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:flex-row sm:items-center md:px-6">
          <Headshot playerId={data.id} name={data.name} src={data.headshot} size={168} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[15px] text-ink/80">
              {data.team && (
                <Link
                  to={`/team/${data.team}`}
                  className="inline-flex items-center gap-1.5 font-semibold text-ink"
                >
                  <TeamLogo team={data.team} size={26} />
                  {data.team}
                </Link>
              )}
              {data.sweater != null && <span>#{data.sweater}</span>}
              {data.position && <span>{POSITIONS[data.position] ?? data.position}</span>}
            </div>
            <h1 className="display mt-1 text-[48px] font-extrabold leading-[0.9] md:text-[72px]">
              {data.name}
            </h1>
            <dl
              className={`mt-5 grid max-w-2xl divide-ice-scratch border-y border-ice-scratch ${goalie ? "grid-cols-2 divide-x" : "grid-cols-2 sm:grid-cols-4 sm:divide-x"}`}
            >
              {cells.map(([k, v]) => (
                <div key={k} className="py-2 pr-3 sm:px-3 sm:first:pl-0">
                  <dt className="text-[12px] text-ink/80">{k}</dt>
                  <dd className="display text-[30px] font-bold leading-none tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            {quiet && previous && (
              <p className="mt-3 text-[14px]">
                No goals yet in {seasonLabel(data.season)}. Last time out:{" "}
                <button
                  type="button"
                  onClick={() => setParams({ season: String(previous.season) })}
                  className="font-semibold text-blue-line underline-offset-4 hover:underline"
                >
                  {previous.goals} goals and {pp(previous.ppa)} in {seasonLabel(previous.season)}
                </button>
                .
              </p>
            )}
            {seasonIds.length > 1 && (
              <label className="mt-4 inline-flex items-center gap-2 text-[13px] text-ink/80">
                Season
                <select
                  value={data.season}
                  onChange={(e) => setParams({ season: e.target.value })}
                  className="rounded-[var(--radius)] border border-ice-scratch bg-surface px-2 py-1 text-ink"
                >
                  {seasonIds.map((id) => (
                    <option key={id} value={id}>
                      {seasonLabel(id)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
      </header>

      <div ref={ref} className="mx-auto w-full max-w-5xl px-4 pb-12 md:px-6">
        {!goalie && (
          <section aria-labelledby="log-h" className="pt-10">
            <h2 id="log-h" className="display mb-4 text-[30px] font-bold">
              Every goal of {seasonLabel(data.season)}
            </h2>
            <GoalLog goals={data.goals} width={width} />
            <p className="mt-2 max-w-[56ch] text-[13px] text-ink-soft">
              One bar per goal, taller for higher magnitude; blue when it raised his team's playoff
              odds. Select one to see everyone it moved.
            </p>
          </section>
        )}
        <div className="grid gap-x-10 md:grid-cols-2">
          {!goalie && (
            <section aria-labelledby="big-h" className="pt-10">
              <h2 id="big-h" className="display mb-4 text-[30px] font-bold">
                Biggest goals
              </h2>
              <ul className="divide-y divide-ice-scratch">
                {biggest.map((t) => (
                  <li key={t.id}>
                    <TremorLine t={t} myTeam={data.team ?? null} />
                  </li>
                ))}
                {biggest.length === 0 && (
                  <li className="text-[14px] text-ink-soft">None yet this season.</li>
                )}
              </ul>
            </section>
          )}
          {!goalie && (
            <section aria-labelledby="ast-h" className="pt-10">
              <h2 id="ast-h" className="display mb-4 text-[30px] font-bold">
                Biggest assists
              </h2>
              <ul className="divide-y divide-ice-scratch">
                {data.assists.slice(0, 5).map((t) => (
                  <li key={t.id}>
                    <TremorLine t={t} myTeam={data.team ?? null} />
                  </li>
                ))}
                {data.assists.length === 0 && (
                  <li className="text-[14px] text-ink-soft">None yet this season.</li>
                )}
              </ul>
            </section>
          )}
        </div>
        {s && (
          <section aria-labelledby="disc-h" className="pt-10">
            <h2 id="disc-h" className="display mb-1 text-[30px] font-bold">
              Discipline and defense
            </h2>
            <p className="mb-4 max-w-[56ch] text-[13px] text-ink-soft">
              Regular season. Penalty and giveaway costs are the playoff odds the power-play goals
              and quick-strike goals that followed actually took from {data.team ?? "the team"};
              they describe what happened more than a repeatable skill.
            </p>
            <dl className="grid grid-cols-2 gap-y-4 border-y border-ice-scratch py-3 sm:grid-cols-4">
              {(
                [
                  [
                    "Plus/minus",
                    s.plus_minus != null
                      ? s.plus_minus > 0
                        ? `+${s.plus_minus}`
                        : String(s.plus_minus)
                      : "-",
                  ],
                  ["PPA plus/minus", s.on_ice_ppa != null ? pp(s.on_ice_ppa) : "-"],
                  ["Penalty minutes", String(s.pim)],
                  [
                    `Penalties cost (${s.penalty_goals} PP goals)`,
                    s.penalties ? pp(s.penalty_ppa) : "-",
                  ],
                  [`Drew ${s.drawn} penalties`, s.drawn ? pp(s.drawn_ppa) : "-"],
                  ["Giveaways / takeaways", `${s.giveaways} / ${s.takeaways}`],
                  [
                    `Costly giveaways (${s.costly_giveaways})`,
                    s.costly_giveaways ? pp(s.giveaway_ppa) : "-",
                  ],
                ] as [string, string][]
              ).map(([k, v]) => (
                <div key={k} className="pr-3">
                  <dt className="text-[12px] text-ink-soft">{k}</dt>
                  <dd className="display text-[26px] font-bold leading-none tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            {s.onice_coverage != null && s.onice_coverage < 0.99 && (
              <p className="mt-2 text-[12px] text-ink-soft">
                The NHL has no shift data for {Math.round((1 - s.onice_coverage) * 100)}% of this
                season's goals, so plus/minus and PPA plus/minus leave those goals out.
              </p>
            )}
          </section>
        )}
        {data.seasons.length > 0 && (
          <section aria-labelledby="seasons-h" className="pt-10">
            <h2 id="seasons-h" className="display mb-4 text-[30px] font-bold">
              By season
            </h2>
            <table className="w-full text-[14px]">
              <thead className="text-left text-[12px] text-ink-soft">
                <tr>
                  <th className="font-normal">Season</th>
                  <th className="font-normal">Team</th>
                  <th className="text-right font-normal">{goalie ? "Goals allowed" : "Goals"}</th>
                  <th className="text-right font-normal">{goalie ? "PPA allowed" : "PPA"}</th>
                  {!goalie && <th className="text-right font-normal">Assist PPA</th>}
                  {!goalie && <th className="text-right font-normal">On-ice PPA</th>}
                </tr>
              </thead>
              <tbody>
                {data.seasons.map((x) => (
                  <tr key={x.season} className="border-t border-ice-scratch">
                    <td className="py-1.5">
                      <button
                        type="button"
                        onClick={() => setParams({ season: String(x.season) })}
                        className={x.season === data.season ? "font-semibold" : "text-blue-line"}
                      >
                        {seasonLabel(x.season)}
                      </button>
                    </td>
                    <td>
                      {x.team && (
                        <span className="inline-flex items-center gap-1.5">
                          <TeamLogo team={x.team} size={20} />
                          <span className="display text-[15px] font-bold">{x.team}</span>
                        </span>
                      )}
                    </td>
                    <td className="text-right tabular-nums">
                      {goalie ? x.goals_allowed : x.goals}
                    </td>
                    <td className="text-right tabular-nums">
                      {pp(goalie ? x.goalie_ppa_allowed : x.ppa)}
                    </td>
                    {!goalie && <td className="text-right tabular-nums">{pp(x.assist_ppa)}</td>}
                    {!goalie && (
                      <td className="text-right tabular-nums">
                        {x.on_ice_ppa != null ? pp(x.on_ice_ppa) : "-"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </div>
  );
}
