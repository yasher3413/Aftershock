import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { useDocumentMeta } from "../lib/meta";
import { ELSEWHERE, EMAIL, REPO } from "../lib/contact";

function H({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="display mb-4 mt-12 scroll-mt-6 border-t border-ice-scratch pt-6 text-[30px] font-bold leading-tight"
    >
      {children}
    </h2>
  );
}

/** The math in five steps, each a sentence a non-statistician can follow. */
const STEPS: { title: string; body: ReactNode; math?: string }[] = [
  {
    title: "Score every shot",
    body: "Each shot gets a chance of going in, based on where it came from and how: distance, angle, shot type, rebounds, rushes, manpower. That number is expected goals, or xG.",
    math: "xG = P(goal | shot situation)",
  },
  {
    title: "Rate every team",
    body: "Each team carries an attack and a defense rating that drift toward how it has really played, measured in goals and xG, with recent games weighted most. Two ratings in a matchup give the chance of every result: a win in regulation, overtime, or a shootout, for either side.",
  },
  {
    title: "Play the season out, again and again",
    body: "A simulator rolls those chances for every game left on the schedule, applies the NHL's real tiebreakers, and repeats the whole season tens of thousands of times. A team's playoff odds are simply the share of those seasons in which it got in.",
    math: "P(playoffs) = seasons it made it ÷ seasons simulated",
  },
  {
    title: "Measure one goal",
    body: "When someone scores, the season is simulated twice: just before the goal and just after, with exactly the same dice everywhere else. The only difference between the two runs is that goal, so the change in each team's odds is the goal's effect, in percentage points (pp).",
    math: "pp = odds after − odds before",
  },
  {
    title: "Size the shockwave",
    body: "Add up how far the goal moved every team, then put it on a logarithmic scale from 0 to 10, like the Richter scale for earthquakes. A player's Playoff Probability Added (PPA) is the sum of the pp the player's goals gave their own team.",
    math: "M = a + b · log₁₀(1 + 10,000 · S)",
  },
];

export default function AboutPage() {
  // The page loads lazily, after the router has tried to scroll to the
  // footer's #nerds or #maker link, so scroll once it exists.
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);
  useDocumentMeta(
    "About",
    "Who makes Puckquake, how to send feedback, and the math behind it in five steps.",
  );
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-12">
      <article className="max-w-[72ch] text-[16px] leading-relaxed">
        <h1 className="display text-[38px] font-extrabold leading-none sm:text-[60px]">About</h1>
        <p className="mt-5 text-[19px] leading-relaxed">
          Puckquake treats every NHL goal like an earthquake and shows how far it travels through
          the playoff race.
        </p>
        <p className="mt-3 text-ink-soft">
          It watches every game at once. Each time someone scores, it reruns the rest of the season
          and measures how that one goal changed every team's chances, then draws the result as a
          shockwave on the map. It is an independent project, made by Yash Gandhi.
        </p>

        <H id="feedback">Feedback and bugs</H>
        <p>
          Something look wrong, or have an idea? Open an issue on{" "}
          <a href={`${REPO}/issues`} className="font-semibold text-blue-line underline">
            GitHub
          </a>{" "}
          or email{" "}
          <a href={`mailto:${EMAIL}`} className="font-semibold text-blue-line underline">
            {EMAIL}
          </a>
          . A link to the page and what you expected to see helps the most.
        </p>

        <H id="maker">Made by Yash Gandhi</H>
        <ul className="divide-y divide-ice-scratch border-y border-ice-scratch">
          {ELSEWHERE.map((l) => (
            <li key={l.label}>
              <a
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-[48px] items-center justify-between gap-4 hover:text-blue-line"
              >
                <span className="text-ink-soft">{l.label}</span>
                <span className="font-semibold">{l.handle}</span>
              </a>
            </li>
          ))}
        </ul>

        <H id="nerds">For nerds: the math in five steps</H>
        <p className="text-ink-soft">No statistics degree needed. Each step feeds the next.</p>
        <ol className="mt-6 space-y-7">
          {STEPS.map((s, i) => (
            <li key={s.title} className="grid grid-cols-[2.25rem_1fr] gap-x-3">
              <span className="display text-[30px] font-extrabold leading-none text-ink-soft">
                {i + 1}
              </span>
              <div>
                <h3 className="font-semibold">{s.title}</h3>
                <p className="mt-1 text-ink-soft">{s.body}</p>
                {s.math && (
                  <p className="mt-2 inline-block rounded-[var(--radius)] bg-ice-land px-2.5 py-1 font-mono text-[14px] text-ink">
                    {s.math}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-8">
          The full method, with every model's test results and known limitations, is on{" "}
          <Link to="/method" className="font-semibold text-blue-line underline">
            How it works
          </Link>
          . The code is open on{" "}
          <a href={REPO} className="font-semibold text-blue-line underline">
            GitHub
          </a>
          .
        </p>

        <H id="privacy">Privacy</H>
        <p>
          No accounts, no ads, no tracking scripts. Your browser remembers the team you pick and
          whether you have seen the walkthrough; neither leaves your device. If you turn on goal
          alerts, the server keeps your browser's alert address and team so it can send them, and
          deletes both when you turn alerts off.
        </p>

        <H id="data">Data</H>
        <p>
          Data from NHL.com, through the league's public play-by-play feed. NHL and team logos and
          marks, and player photos, are the property of the NHL and its teams. Puckquake is not
          affiliated with, endorsed by, or sponsored by the NHL or any team.
        </p>
      </article>
    </div>
  );
}
