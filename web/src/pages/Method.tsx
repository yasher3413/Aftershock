import { useEffect, useState, type ReactNode } from "react";
import { useMethodology } from "../api/client";
import { useDocumentMeta } from "../lib/meta";
import { CalibrationChart, GroupedBars } from "../charts/Calibration";

/* eslint-disable @typescript-eslint/no-explicit-any */
const f = (v: any, d = 3) => (typeof v === "number" ? v.toFixed(d) : "");
const p1 = (v: any) => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "");

const STEPS = [
  { id: "read-map", label: "Read the map" },
  { id: "xg", label: "Shot danger" },
  { id: "strength", label: "Team strength" },
  { id: "wp", label: "Who is winning" },
  { id: "sim", label: "Rerun the season" },
  { id: "crn", label: "Isolate one goal" },
  { id: "magnitude", label: "Magnitude and PPA" },
  { id: "discipline", label: "Discipline and defense" },
  { id: "metrics", label: "Reading the evidence" },
  { id: "limits", label: "Known limitations" },
  { id: "data", label: "Data and attribution" },
];

/** The method is a pipeline: each step feeds the next. The rail follows the reader. */
function PipelineRail() {
  const [active, setActive] = useState(STEPS[0]!.id);
  useEffect(() => {
    const els = STEPS.map((st) => document.getElementById(st.id)).filter(Boolean) as HTMLElement[];
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "0px 0px -70% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  const links = (
    <ol className="border-l border-ice-scratch">
      {STEPS.map((step) => (
        <li key={step.id}>
          <a
            href={`#${step.id}`}
            aria-current={active === step.id ? "location" : undefined}
            className={`-ml-px flex min-h-[44px] items-center border-l px-4 py-2 text-[14px] leading-snug ${active === step.id ? "border-ink font-semibold text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
          >
            {step.label}
          </a>
        </li>
      ))}
    </ol>
  );
  return (
    <nav aria-label="Page contents" className="lg:sticky lg:top-6 lg:h-max lg:w-52 lg:shrink-0">
      <div className="hidden lg:block">
        <p className="mb-3 px-4 text-[15px] font-semibold">On this page</p>
        {links}
      </div>
      <details className="mb-8 border-y border-ice-scratch lg:hidden">
        <summary className="min-h-[44px] cursor-pointer py-3 text-[15px] font-semibold">
          On this page
        </summary>
        <div className="pb-4">{links}</div>
      </details>
    </nav>
  );
}

function Evidence({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="mt-5 border-y border-ice-scratch">
      <summary className="min-h-[44px] cursor-pointer py-3 text-[15px] font-semibold hover:text-ink-soft">
        {label}
      </summary>
      <div className="space-y-4 pb-5">{children}</div>
    </details>
  );
}

function H({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="display mb-4 mt-12 scroll-mt-6 border-t border-ice-scratch pt-6 text-[30px] font-bold leading-tight text-balance"
    >
      {children}
    </h2>
  );
}

export default function MethodPage() {
  const { data: m, isPending, isError, isFetching, refetch } = useMethodology();
  useDocumentMeta(
    "How it works",
    "The models, the simulator, magnitude, and Playoff Probability Added, explained with real metrics.",
  );
  const xg = m?.xg?.test;
  const st = m?.strength?.test;
  const wp = m?.wp?.test;
  const bt = m?.backtest;
  const mag = m?.magnitude;
  const disc = m?.discipline;
  const charts = m?.charts ?? {};
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8 max-w-[72ch] lg:ml-62 lg:mb-12">
        <h1 className="display text-[52px] font-extrabold leading-none sm:text-[60px]">
          How it works
        </h1>
        <p className="mt-5 text-[19px] leading-relaxed">One goal. A different playoff picture.</p>
        <p className="mt-3 text-[16px] leading-relaxed text-ink-soft">
          Aftershock watches every NHL game at once. When anyone scores, it reruns the rest of the
          season thousands of times and measures how that one goal changed every team's chances.
          Start with the map, then follow the models behind it.
        </p>
        <div className="mt-4 flex flex-wrap gap-x-6">
          <a
            href="#xg"
            className="flex min-h-[44px] items-center text-[15px] font-semibold underline underline-offset-4"
          >
            Read the full method
          </a>
          <a
            href="#limits"
            className="flex min-h-[44px] items-center text-[15px] underline underline-offset-4"
          >
            See the limitations
          </a>
        </div>
      </header>
      <div className="flex flex-col gap-x-10 lg:flex-row">
        <PipelineRail />
        <article className="min-w-0 w-full max-w-[72ch] text-[16px] leading-relaxed">
          <h2
            id="read-map"
            className="display mb-4 scroll-mt-6 text-[30px] font-bold leading-tight"
          >
            Read the map
          </h2>
          <dl className="space-y-5">
            <div>
              <dt className="font-semibold">A team's ring is its playoff chance</dt>
              <dd className="mt-1 text-ink-soft">
                The ring fills as the chance of making the playoffs rises. This is a season outcome,
                not the chance of winning tonight's game. The tick beneath the ring is the team's
                color.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">A shockwave begins where a goal was scored</dt>
              <dd className="mt-1 text-ink-soft">
                The spreading ring connects that goal to changes across the league. Blue, with a
                plus sign, means odds rose; red, with a minus sign, means they fell. Geography sets
                the scene, not the size of the effect.
              </dd>
            </div>
          </dl>
          <figure className="my-7 border-y border-ice-scratch py-5">
            <figcaption className="text-[15px] font-semibold">A hypothetical goal</figcaption>
            <p className="mt-2 text-ink-soft">
              Imagine a team's playoff chance moves from 40% before a goal to 42% after it.
            </p>
            <dl className="mt-4 grid grid-cols-3 gap-3">
              <div>
                <dt className="text-[13px] text-ink-soft">Before</dt>
                <dd className="display mt-1 text-[30px] font-bold">40%</dd>
              </div>
              <div>
                <dt className="text-[13px] text-ink-soft">After</dt>
                <dd className="display mt-1 text-[30px] font-bold">42%</dd>
              </div>
              <div>
                <dt className="text-[13px] text-ink-soft">Change</dt>
                <dd className="display mt-1 text-[30px] font-bold up">+2 pp</dd>
              </div>
            </dl>
            <p className="mt-4 text-[15px]">
              That is an increase of <strong>2 percentage points</strong>, written +2 pp. If this is
              the scoring team, the goal adds +2 PPA to the scorer.
            </p>
          </figure>
          <dl className="space-y-5">
            <div>
              <dt className="font-semibold">PPA adds up what a player's goals changed</dt>
              <dd className="mt-1 text-ink-soft">
                Playoff Probability Added sums each goal's effect on the scoring team's playoff
                chance. A season total is cumulative impact in percentage points, not a team's
                current probability or an overall player talent rating.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Magnitude measures the league-wide tremor</dt>
              <dd className="mt-1 text-ink-soft">
                M summarizes the total movement in everyone's odds on a logarithmic scale. It is not
                a goal count or the scoring team's PPA. In the playoffs, making the field is already
                settled: Cup Probability Added (CPA) measures changes in Stanley Cup chances
                instead.
              </dd>
            </div>
          </dl>

          <div className="mt-10 border-t border-ice-scratch pt-6">
            <h2 className="display text-[38px] font-bold leading-tight">
              From a shot to the standings
            </h2>
            <p className="mt-3 text-ink-soft">
              Each step feeds the next. Open the evidence beside a model to see its measured results
              and comparison charts, then use the{" "}
              <a href="#metrics" className="underline underline-offset-4">
                metric guide
              </a>{" "}
              to read them.
            </p>
            {isPending && (
              <p role="status" className="mt-4 text-[15px] text-ink-soft">
                Loading model evidence. The method below is ready to read.
              </p>
            )}
            {isError && (
              <div role="status" className="mt-4 border-y border-ice-scratch py-4">
                <p className="font-semibold">Model evidence is unavailable right now.</p>
                <p className="mt-1 text-[15px] text-ink-soft">
                  The explanation and limitations are still available. Retry to load the measured
                  results and charts.
                </p>
                <button
                  type="button"
                  disabled={isFetching}
                  onClick={() => void refetch()}
                  className="mt-3 min-h-[44px] rounded-[var(--radius)] border border-ice-scratch px-4 py-2 text-[15px] font-semibold hover:bg-ice-land disabled:cursor-wait disabled:opacity-60"
                >
                  {isFetching ? "Retrying model evidence…" : "Retry model evidence"}
                </button>
              </div>
            )}
          </div>
          <H id="xg">1. How dangerous was each shot (expected goals)</H>
          <p>
            Expected goals (xG) is the chance a shot goes in, judged only by the situation:
            distance, angle, shot type, whether it followed a rebound or a rush, the manpower,
            whether the net was empty, and the score. It never looks at who shot or who was in goal.
            It is a gradient-boosted model trained on 2015-16 through 2023-24.
          </p>
          {(xg || charts.xg_reliability) && (
            <Evidence label="Shot model evidence">
              {xg && (
                <p>
                  On the 2025-26 season it had never seen, it scored an AUC of {f(xg.lightgbm.auc)}{" "}
                  and a log loss of {f(xg.lightgbm.log_loss)}, against{" "}
                  {f(xg.baseline_logistic_distance_angle.log_loss)} for a simple distance and angle
                  model. Its calibration error was {f(xg.lightgbm.ece, 4)}: when it says 10 percent,
                  about 10 percent go in.
                </p>
              )}
              {charts.xg_reliability && (
                <CalibrationChart
                  title="Shots: predicted against actual goal rate, 2025-26"
                  curves={charts.xg_reliability}
                />
              )}
            </Evidence>
          )}

          <H id="strength">2. How good is each team</H>
          <p>
            Every team carries an offense and a defense rating. After each game, both move toward
            how the team actually played, measured as a blend of goals and expected goals, with
            recent games counting most. Those ratings give each team's expected goals in any
            matchup, which become the chances of each result: a win in regulation, overtime, or a
            shootout, for either side.
          </p>
          {(st || charts.strength_reliability) && (
            <Evidence label="Team strength evidence">
              {st && (
                <p>
                  Predicting every game from 2021-22 to 2025-26 using only what was known that
                  morning, it picked the winner {p1(st.strength.accuracy)} of the time, against{" "}
                  {p1(st.points_pct_to_date.accuracy)} for picking the team with the better record
                  so far and {p1(st.home_ice_only.accuracy)} for always picking the home team.
                </p>
              )}
              {charts.strength_reliability && (
                <CalibrationChart
                  title="Home team wins: predicted against actual, 2021-22 to 2025-26"
                  curves={charts.strength_reliability}
                  max={1}
                />
              )}
            </Evidence>
          )}

          <H id="wp">3. Who is winning right now</H>
          <p>
            During a game, win probability starts from a simple physical model: goals keep arriving
            at the rates we measured for the current manpower, so a team up two with five minutes
            left almost always wins, and a pulled goalie changes both teams' scoring rates. A
            boosted model then corrects that estimate using the pregame matchup, power-play clocks,
            and shots so far. It can only ever rise as a team's lead grows. Overtime and the
            shootout are handled exactly: overtime as a race between two scoring rates, the shootout
            round by round.
          </p>
          {(wp || charts.wp_logloss_by_time || charts.wp_reliability) && (
            <Evidence label="In-game probability evidence">
              {wp && (
                <p>
                  On 2025-26, its log loss was {f(wp.lightgbm_ordinal.log_loss)}, against{" "}
                  {f(wp.lookup_table.log_loss)} for a table of outcomes by score and minute and{" "}
                  {f(wp.multinomial_logistic.log_loss)} for a logistic model. The gains are small,
                  as they should be: score and clock carry most of the signal.
                </p>
              )}
              {charts.wp_logloss_by_time && (
                <GroupedBars
                  title="Log loss by minutes played, 2025-26 (lower is better)"
                  labels={charts.wp_logloss_by_time.labels}
                  series={charts.wp_logloss_by_time.series}
                  unit="log loss"
                />
              )}
              {charts.wp_reliability && (
                <CalibrationChart
                  title="In-game outcomes: predicted against actual, 2025-26"
                  curves={charts.wp_reliability}
                  max={1}
                />
              )}
            </Evidence>
          )}

          <H id="sim">4. Rerunning the season</H>
          <p>
            With a chance for every remaining game, a simulator written in Rust plays out the rest
            of the season tens of thousands of times, applies the NHL's real tiebreakers (checked
            against nine seasons of official final standings), builds the playoff bracket, and plays
            every series. Your team's playoff odds are the share of those seasons in which it made
            it. Because nobody knows exactly how good a team is, each simulated season also nudges
            every team up or down a little, and ratings are pulled toward average for games far in
            the future.
          </p>
          <p className="mt-4">
            Early-season odds carry more uncertainty. In October, before a game is played, the
            backtested odds only modestly beat a coin flip. By April they are sharper.
          </p>
          {(bt || charts.backtest_reliability) && (
            <Evidence label="Season simulation evidence">
              {bt && (
                <p>
                  Simulating past seasons from the first of every month using only what was known
                  then, playoff odds scored a Brier score of {f(bt.brier.sim)}, against{" "}
                  {f(bt.brier.points_pct_baseline)} for a model based on points percentage (lower is
                  better).
                </p>
              )}
              {charts.backtest_reliability && (
                <CalibrationChart
                  title="Making the playoffs: predicted against actual, 2021-22 to 2025-26"
                  curves={charts.backtest_reliability}
                  max={1}
                />
              )}
            </Evidence>
          )}

          <H id="crn">5. Why one goal can be measured</H>
          <p>
            To measure a goal, Aftershock runs the season twice: once as if the goal had not
            happened, once with it. The trick is that both runs use exactly the same random numbers
            for every game. Each simulated game draws its randomness from a fixed recipe keyed to
            that game and that simulation, so the only thing that differs between the two runs is
            the one game where the goal happened. Without this, a real shift of a few tenths of a
            percentage point would drown in random noise; with it, the difference is the goal alone.
          </p>

          <H id="magnitude">6. Magnitude and Playoff Probability Added</H>
          <p>
            A goal's total shift is the sum of how much it moved every team's playoff odds.
            Magnitude puts that on a logarithmic scale from 0 to 10, like an earthquake: M = a + b
            log10(1 + 10000 S), where S is the total shift.
            {mag &&
              ` The constants (a = ${f(mag.a, 2)}, b = ${f(mag.b, 2)}) were set on ${mag.n_goals?.toLocaleString()} goals from 2024-25 and 2025-26 so the typical goal lands near 2 and a season's ten biggest near 8.`}{" "}
            {mag?.zero_share != null &&
              `The scale stops at 0: a goal that moves the league by less than ${f(mag.floor_shift * 100, 1)} percentage points in total reads as M0.0, and ${f(mag.zero_share * 100, 0)}% of goals in those two seasons did.`}{" "}
            {mag?.top25_march_april_share != null &&
              `The map gets more violent as April approaches, but only at the top: ${f(mag.top25_march_april_share * 100, 0)}% of each season's 25 biggest goals came in March or April, while ${f(mag.april_zero_share * 100, 0)}% of April goals read M0.0 because most races are already settled.`}
          </p>
          <p>
            Playoff Probability Added (PPA) is how much a goal moved the scoring team's own playoff
            odds, in percentage points. A player's PPA is the sum over his goals. Assists earn the
            goal's full PPA as a separate stat, and a goalie's "PPA allowed" is the damage from
            goals scored on him. Cup Probability Added (CPA) is the same idea for Stanley Cup odds,
            and the only measure used in the playoffs, where playoff odds are already settled.
          </p>

          <H id="discipline">Discipline and defense</H>
          <p>
            Penalties, giveaways, and plus/minus are counted from the play-by-play and shift charts
            for the regular season, then tied to the goals they led to. A power-play goal is charged
            to the oldest penalty that put the team short-handed (a minor ends at the first goal, a
            major runs its length) and credited to whoever drew it. A giveaway is costly when the
            other team scores within 10 seconds. Each carries that goal's change in the team's
            playoff odds.
          </p>
          {(disc?.validation?.["20252026"] || disc?.stability?.["20252026"]) && (
            <Evidence label="Discipline validation and stability">
              {disc?.validation?.["20252026"] && (
                <p>
                  Checked against the NHL's official 2025-26 totals, giveaways and takeaways match
                  for {p1(disc.validation["20252026"].giveaways.exact)} of players, penalty minutes
                  for {p1(disc.validation["20252026"].penalty_minutes.exact)}, and plus/minus for{" "}
                  {p1(disc.validation["20252026"].plus_minus.exact)} (within one goal for{" "}
                  {p1(disc.validation["20252026"].plus_minus.within_1)}; the rest are line changes
                  in the same second as a goal).
                </p>
              )}
              {disc?.stability?.["20252026"] && (
                <p>
                  To see which numbers describe a player rather than luck, each season is split into
                  a player's odd and even games. PPA plus/minus repeats from one half to the other
                  with a correlation of{" "}
                  {f(disc.stability["20252026"].ppa_plus_minus.split_half_r, 2)}, drawn penalties{" "}
                  {f(disc.stability["20252026"].penalties_drawn.split_half_r, 2)}, and giveaways{" "}
                  {f(disc.stability["20252026"].giveaways.split_half_r, 2)}. What penalties and
                  giveaways cost in playoff odds barely repeats (
                  {f(disc.stability["20252026"].penalty_ppa.split_half_r, 2)} and{" "}
                  {f(disc.stability["20252026"].costly_giveaway_ppa.split_half_r, 2)}): those
                  columns say what happened, not who is good at it.
                </p>
              )}
            </Evidence>
          )}

          <H id="metrics">Reading the evidence</H>
          <p>
            These checks answer different questions. None makes an individual hockey outcome
            certain.
          </p>
          <dl className="mt-5 space-y-5">
            <div>
              <dt className="font-semibold">AUC: can the model rank shot danger?</dt>
              <dd className="mt-1 text-ink-soft">
                AUC checks whether shots that became goals tend to receive higher estimates than
                shots that did not. Higher is better, but ranking alone does not tell you whether
                the percentages are accurate.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Log loss: how costly were wrong predictions?</dt>
              <dd className="mt-1 text-ink-soft">
                Log loss judges the probability assigned to the outcome that happened. A confident
                wrong prediction gets a larger penalty. Lower is better.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">
                Brier score: how far were probabilities from outcomes?
              </dt>
              <dd className="mt-1 text-ink-soft">
                The Brier score averages the squared gap between the forecast probability and what
                happened. Lower is better. The simulation evidence compares it with a simpler
                points-percentage forecast.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Calibration: do the percentages match reality?</dt>
              <dd className="mt-1 text-ink-soft">
                Calibration groups similar predictions and checks how often the outcome actually
                occurred. On the charts, closer to the diagonal is better. Expected calibration
                error (ECE) summarizes those gaps; lower is better.
              </dd>
            </div>
          </dl>

          <H id="limits">Known limitations</H>
          <ul className="list-disc space-y-3 pl-5">
            <li>Ratings do not know about injuries, trades, or which goalie starts.</li>
            <li>
              xG has no information about screens or pre-shot passing, which the public feed does
              not record.
            </li>
            <li>
              The NHL has no shift charts for the last 78 games of 2024-25, so that season's
              plus/minus and on-ice numbers leave out about 5 percent of its goals.
            </li>
            <li>Four-on-three overtime power plays are not modeled separately.</li>
          </ul>

          <H id="data">Data and attribution</H>
          <p>
            Data from NHL.com. Aftershock uses the league's public play-by-play feed, asks for it
            politely, and never redistributes it. NHL and team logos and marks, and player photos,
            are the property of the NHL and its teams. Aftershock is not affiliated with, endorsed
            by, or sponsored by the NHL or any team.
          </p>
        </article>
      </div>
    </div>
  );
}
