import type { ReactNode } from "react";
import { useMethodology } from "../api/client";
import { useDocumentMeta } from "../lib/meta";

/* eslint-disable @typescript-eslint/no-explicit-any */
const f = (v: any, d = 3) => (typeof v === "number" ? v.toFixed(d) : "");
const p1 = (v: any) => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : "");

function H({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="mt-10 border-t border-ice-scratch pt-6 text-[22px] font-semibold">
      {children}
    </h2>
  );
}

function Plot({ src, alt }: { src?: string; alt: string }) {
  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt}
      className="my-4 w-full max-w-[560px] rounded-[var(--radius)] bg-white p-2"
      loading="lazy"
    />
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
  const plots = m?.plots ?? {};
  return (
    <article className="mx-auto w-full max-w-[72ch] px-4 py-8 text-[16px] leading-relaxed">
      <h1 className="display text-[52px] font-extrabold leading-none">How it works</h1>
      <p className="mt-4 text-ink-soft">
        Aftershock watches every NHL game at once. When anyone scores, it reruns the rest of the
        season thousands of times and measures how that one goal changed every team's chances. Here
        is how each piece works, with the numbers we measured on seasons the models never saw.
      </p>

      <H id="xg">1. How dangerous was each shot (expected goals)</H>
      <p>
        Expected goals (xG) is the chance a shot goes in, judged only by the situation: distance,
        angle, shot type, whether it followed a rebound or a rush, the manpower, whether the net was
        empty, and the score. It never looks at who shot or who was in goal. It is a
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
      <Plot
        src={plots.xg_reliability}
        alt="xG reliability: predicted against observed goal rates"
      />

      <H id="strength">2. How good is each team</H>
      <p>
        Every team carries an offense and a defense rating. After each game, both move toward how
        the team actually played, measured as a blend of goals and expected goals, with recent games
        counting most. Those ratings give each team's expected goals in any matchup, which become
        the chances of each result: a win in regulation, overtime, or a shootout, for either side.
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
      <Plot
        src={plots.strength_reliability}
        alt="Team strength reliability for the home team winning"
      />

      <H id="wp">3. Who is winning right now</H>
      <p>
        During a game, win probability starts from a simple physical model: goals keep arriving at
        the rates we measured for the current manpower, so a team up two with five minutes left
        almost always wins, and a pulled goalie changes both teams' scoring rates. A boosted model
        then corrects that estimate using the pregame matchup, power-play clocks, and shots so far.
        It can only ever rise as a team's lead grows. Overtime and the shootout are handled exactly:
        overtime as a race between two scoring rates, the shootout round by round.
      </p>
      {wp && (
        <p>
          On 2025-26, its log loss was {f(wp.lightgbm_ordinal.log_loss)}, against{" "}
          {f(wp.lookup_table.log_loss)} for a table of outcomes by score and minute and{" "}
          {f(wp.multinomial_logistic.log_loss)} for a logistic model. The gains are small, as they
          should be: score and clock carry most of the signal.
        </p>
      )}
      <Plot src={plots.wp_logloss_by_time} alt="Win probability log loss by game time" />
      <Plot src={plots.wp_reliability} alt="Win probability reliability" />

      <H id="sim">4. Rerunning the season</H>
      <p>
        With a chance for every remaining game, a simulator written in Rust plays out the rest of
        the season tens of thousands of times, applies the NHL's real tiebreakers (checked against
        nine seasons of official final standings), builds the playoff bracket, and plays every
        series. Your team's playoff odds are the share of those seasons in which it made it. Because
        nobody knows exactly how good a team is, each simulated season also nudges every team up or
        down a little, and ratings are pulled toward average for games far in the future.
      </p>
      {bt && (
        <p>
          Simulating past seasons from the first of every month using only what was known then,
          playoff odds scored a Brier score of {f(bt.brier.sim)}, against{" "}
          {f(bt.brier.points_pct_baseline)} for a model based on points percentage (lower is
          better). In October, before a game is played, the odds only modestly beat a coin flip. By
          April they are sharp.
        </p>
      )}
      <Plot
        src={plots.backtest_reliability}
        alt="Season simulation reliability for making the playoffs"
      />

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
        puts that on a logarithmic scale from 0 to 10, like an earthquake: M = a + b log10(1 + 10000
        S), where S is the total shift.
        {mag &&
          ` The constants (a = ${f(mag.a, 2)}, b = ${f(mag.b, 2)}) were set on ${mag.n_goals?.toLocaleString()} goals from 2024-25 and 2025-26 so the typical goal lands near 2 and a season's ten biggest near 8.`}{" "}
        Early-season goals are small. That is correct: the map gets more violent as April
        approaches.
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
  );
}
