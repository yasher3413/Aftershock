import { useEffect, useState, type ReactNode } from "react";
import { useMethodology } from "../api/client";
import { useDocumentMeta } from "../lib/meta";
import { CalibrationChart, GroupedBars } from "../charts/Calibration";

/* eslint-disable @typescript-eslint/no-explicit-any */
const f = (v: any, d = 3) => (typeof v === "number" ? v.toFixed(d) : "");
const p1 = (v: any) => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "");

const STEPS = [
  { id: "xg", label: "Shot danger" },
  { id: "strength", label: "Team strength" },
  { id: "wp", label: "Who is winning" },
  { id: "sim", label: "Rerun the season" },
  { id: "crn", label: "Isolate one goal" },
  { id: "magnitude", label: "Magnitude and PPA" },
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
  return (
    <nav aria-label="The pipeline" className="sticky top-6 hidden h-max w-48 shrink-0 lg:block">
      <ol className="relative border-l-2 border-ice-scratch">
        {STEPS.map((st, i) => (
          <li key={st.id}>
            <a
              href={`#${st.id}`}
              aria-current={active === st.id ? "step" : undefined}
              className={`-ml-[2px] flex gap-2 border-l-2 py-1.5 pl-3 text-[14px] ${active === st.id ? "border-ink font-semibold text-ink" : "border-transparent text-ink-soft hover:text-ink"}`}
            >
              <span className="display w-4 text-[16px] font-bold tabular-nums">{i + 1}</span>
              {st.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function H({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="display mt-12 scroll-mt-6 border-t border-ice-scratch pt-6 text-[30px] font-bold leading-tight"
    >
      {children}
    </h2>
  );
}

export default function MethodPage() {
  const { data: m } = useMethodology();
  useDocumentMeta(
    "How it works",
    "The models, the simulator, magnitude, and Playoff Probability Added, explained with real metrics.",
  );
  const xg = m?.xg?.test;
  const st = m?.strength?.test;
  const wp = m?.wp?.test;
  const bt = m?.backtest;
  const mag = m?.magnitude;
  const charts = m?.charts ?? {};
  return (
    <div className="mx-auto flex w-full max-w-5xl gap-10 px-4 py-8">
      <PipelineRail />
      <article className="w-full max-w-[72ch] text-[16px] leading-relaxed">
        <h1 className="display text-[52px] font-extrabold leading-none">How it works</h1>
        <p className="mt-4 text-ink-soft">
          Aftershock watches every NHL game at once. When anyone scores, it reruns the rest of the
          season thousands of times and measures how that one goal changed every team's chances.
          Here is how each piece works, with the numbers we measured on seasons the models never
          saw.
        </p>

        <H id="xg">1. How dangerous was each shot (expected goals)</H>
        <p>
          Expected goals (xG) is the chance a shot goes in, judged only by the situation: distance,
          angle, shot type, whether it followed a rebound or a rush, the manpower, whether the net
          was empty, and the score. It never looks at who shot or who was in goal. It is a
          gradient-boosted model trained on 2015-16 through 2023-24.
        </p>
        {xg && (
          <p>
            On the 2025-26 season it had never seen, it scored an AUC of {f(xg.lightgbm.auc)} and a
            log loss of {f(xg.lightgbm.log_loss)}, against{" "}
            {f(xg.baseline_logistic_distance_angle.log_loss)} for a simple distance and angle model.
            Its calibration error was {f(xg.lightgbm.ece, 4)}: when it says 10 percent, about 10
            percent go in.
          </p>
        )}
        {charts.xg_reliability && (
          <CalibrationChart
            title="Shots: predicted against actual goal rate, 2025-26"
            curves={charts.xg_reliability}
          />
        )}

        <H id="strength">2. How good is each team</H>
        <p>
          Every team carries an offense and a defense rating. After each game, both move toward how
          the team actually played, measured as a blend of goals and expected goals, with recent
          games counting most. Those ratings give each team's expected goals in any matchup, which
          become the chances of each result: a win in regulation, overtime, or a shootout, for
          either side.
        </p>
        {st && (
          <p>
            Predicting every game from 2021-22 to 2025-26 using only what was known that morning, it
            picked the winner {p1(st.strength.accuracy)} of the time, against{" "}
            {p1(st.points_pct_to_date.accuracy)} for picking the team with the better record so far
            and {p1(st.home_ice_only.accuracy)} for always picking the home team. Hockey is noisy;
            good models live around 58 to 62 percent.
          </p>
        )}
        {charts.strength_reliability && (
          <CalibrationChart
            title="Home team wins: predicted against actual, 2021-22 to 2025-26"
            curves={charts.strength_reliability}
            max={1}
          />
        )}

        <H id="wp">3. Who is winning right now</H>
        <p>
          During a game, win probability starts from a simple physical model: goals keep arriving at
          the rates we measured for the current manpower, so a team up two with five minutes left
          almost always wins, and a pulled goalie changes both teams' scoring rates. A boosted model
          then corrects that estimate using the pregame matchup, power-play clocks, and shots so
          far. It can only ever rise as a team's lead grows. Overtime and the shootout are handled
          exactly: overtime as a race between two scoring rates, the shootout round by round.
        </p>
        {wp && (
          <p>
            On 2025-26, its log loss was {f(wp.lightgbm_ordinal.log_loss)}, against{" "}
            {f(wp.lookup_table.log_loss)} for a table of outcomes by score and minute and{" "}
            {f(wp.multinomial_logistic.log_loss)} for a logistic model. The gains are small, as they
            should be: score and clock carry most of the signal.
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

        <H id="sim">4. Rerunning the season</H>
        <p>
          With a chance for every remaining game, a simulator written in Rust plays out the rest of
          the season tens of thousands of times, applies the NHL's real tiebreakers (checked against
          nine seasons of official final standings), builds the playoff bracket, and plays every
          series. Your team's playoff odds are the share of those seasons in which it made it.
          Because nobody knows exactly how good a team is, each simulated season also nudges every
          team up or down a little, and ratings are pulled toward average for games far in the
          future.
        </p>
        {bt && (
          <p>
            Simulating past seasons from the first of every month using only what was known then,
            playoff odds scored a Brier score of {f(bt.brier.sim)}, against{" "}
            {f(bt.brier.points_pct_baseline)} for a model based on points percentage (lower is
            better). In October, before a game is played, the odds only modestly beat a coin flip.
            By April they are sharp.
          </p>
        )}
        {charts.backtest_reliability && (
          <CalibrationChart
            title="Making the playoffs: predicted against actual, 2021-22 to 2025-26"
            curves={charts.backtest_reliability}
            max={1}
          />
        )}

        <H id="crn">5. Why one goal can be measured</H>
        <p>
          To measure a goal, Aftershock runs the season twice: once as if the goal had not happened,
          once with it. The trick is that both runs use exactly the same random numbers for every
          game. Each simulated game draws its randomness from a fixed recipe keyed to that game and
          that simulation, so the only thing that differs between the two runs is the one game where
          the goal happened. Without this, a real shift of a few tenths of a percentage point would
          drown in random noise; with it, the difference is the goal alone.
        </p>

        <H id="magnitude">6. Magnitude and Playoff Probability Added</H>
        <p>
          A goal's total shift is the sum of how much it moved every team's playoff odds. Magnitude
          puts that on a logarithmic scale from 0 to 10, like an earthquake: M = a + b log10(1 +
          10000 S), where S is the total shift.
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
          goal's full PPA as a separate stat, and a goalie's "PPA allowed" is the damage from goals
          scored on him. Cup Probability Added (CPA) is the same idea for Stanley Cup odds, and the
          only measure used in the playoffs, where playoff odds are already settled.
        </p>

        <H id="limits">Known limitations</H>
        <ul className="list-disc pl-5">
          <li>Ratings do not know about injuries, trades, or which goalie starts.</li>
          <li>
            xG has no information about screens or pre-shot passing, which the public feed does not
            record.
          </li>
          <li>
            Preseason odds for teams far from average can be more extreme than anything in our
            backtests.
          </li>
          <li>Four-on-three overtime power plays are not modeled separately.</li>
        </ul>

        <H id="data">Data</H>
        <p>
          Data from NHL.com. Aftershock is not affiliated with or endorsed by the NHL. It uses the
          league's public play-by-play feed, asks for it politely, and never redistributes it. Teams
          appear by abbreviation and color only.
        </p>
      </article>
    </div>
  );
}
