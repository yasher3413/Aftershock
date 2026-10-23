import type { ReactNode } from "react";
import { Link } from "react-router";
import { ELSEWHERE, REPO } from "../lib/contact";
import { DIVISIONS } from "../lib/teams";
import { TeamLogo } from "./TeamLogo";

const DISCLAIMER =
  "Data from NHL.com. NHL and team logos and marks, and player photos, are the property of the NHL and its teams. Aftershock is not affiliated with, endorsed by, or sponsored by the NHL or any team.";

const EXPLORE = [
  { to: "/", label: "Tonight" },
  { to: "/nights", label: "Nights" },
  { to: "/leaders", label: "Leaders" },
  { to: "/teams", label: "Teams" },
  { to: "/what-if", label: "What if" },
];

const ABOUT = [
  { to: "/method", label: "How it works" },
  { to: "/about", label: "About" },
  { to: "/about#nerds", label: "The math, briefly" },
  { to: "/?tour=1", label: "Take the tour" },
  { to: "/status", label: "Pipeline status" },
];

function Column({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
        {title}
      </h2>
      <ul className="mt-3 space-y-1 text-[14px]">{children}</ul>
    </div>
  );
}

const linkClass = "inline-flex min-h-[32px] items-center hover:text-blue-line hover:underline";

/** The site footer. The home screen on a desktop is pinned to the viewport,
 * so there it keeps a one-line footer and the full one shows everywhere else. */
export function Footer({ compact }: { compact: boolean }) {
  return (
    <footer className="border-t border-ice-scratch">
      <div
        className={`${compact ? "lg:hidden" : ""} mx-auto max-w-6xl px-4 pb-8 pt-10 md:px-6`}
      >
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-[1.6fr_1fr_1fr] lg:gap-x-10">
          <div className="col-span-2 lg:col-span-1">
            <Link to="/" className="display text-[30px] font-extrabold tracking-tight">
              Aftershock
            </Link>
            <p className="mt-2 max-w-[36ch] text-[14px] text-ink-soft">
              Every goal in the NHL is an earthquake. See how far it travels.
            </p>
            <p className="mt-5 text-[14px]">
              Made by{" "}
              <Link to="/about#maker" className="font-semibold hover:underline">
                Yash Gandhi
              </Link>
              . Found a bug?{" "}
              <a href={`${REPO}/issues`} className="font-semibold text-blue-line hover:underline">
                Tell me on GitHub
              </a>
              .
            </p>
            <ul className="mt-2 flex flex-wrap gap-x-4 text-[14px] text-ink-soft">
              {ELSEWHERE.map((l) => (
                <li key={l.label}>
                  <a href={l.href} target="_blank" rel="noreferrer" className={linkClass}>
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <Column title="Explore">
            {EXPLORE.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className={linkClass}>
                  {l.label}
                </Link>
              </li>
            ))}
          </Column>
          <Column title="About">
            {ABOUT.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className={linkClass}>
                  {l.label}
                </Link>
              </li>
            ))}
          </Column>
        </div>

        <nav aria-label="All teams" className="mt-10 border-t border-ice-scratch pt-8">
          <div className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-4">
            {DIVISIONS.map((d) => (
              <Column key={d.name} title={d.name}>
                {d.teams.map(([abbrev, name]) => (
                  <li key={abbrev}>
                    <Link to={`/team/${abbrev}`} className={`${linkClass} gap-2`}>
                      <TeamLogo team={abbrev} size={18} />
                      <span className="truncate">{name}</span>
                    </Link>
                  </li>
                ))}
              </Column>
            ))}
          </div>
        </nav>

        <div className="mt-10 flex flex-col gap-2 border-t border-ice-scratch pt-6 text-[12px] text-ink-soft sm:flex-row sm:justify-between sm:gap-8">
          <p className="max-w-[90ch]">{DISCLAIMER}</p>
          <p className="shrink-0">© {new Date().getFullYear()} Yash Gandhi</p>
        </div>
      </div>
      {compact && (
        <p className="hidden px-6 py-3 text-[12px] text-ink-soft lg:block">
          {DISCLAIMER}{" "}
          <Link to="/about" className="ml-2 underline decoration-ice-scratch hover:text-ink">
            About
          </Link>
          <Link to="/teams" className="ml-3 underline decoration-ice-scratch hover:text-ink">
            All teams
          </Link>
          <Link to="/status" className="ml-3 underline decoration-ice-scratch hover:text-ink">
            Pipeline status
          </Link>
        </p>
      )}
    </footer>
  );
}
