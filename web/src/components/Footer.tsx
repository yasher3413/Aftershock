import type { ReactNode } from "react";
import { Link } from "react-router";
import { ELSEWHERE, REPO } from "../lib/contact";
import { DIVISIONS } from "../lib/teams";
import { TeamLogo } from "./TeamLogo";

const DISCLAIMER =
  "NHL and team logos and marks, and player photos, are the property of the NHL and its teams. Puckquake is not affiliated with, endorsed by, or sponsored by the NHL or any team.";

const EXPLORE = [
  { to: "/", label: "Tonight" },
  { to: "/nights", label: "Nights" },
  { to: "/leaders", label: "Leaders" },
  { to: "/standings", label: "Standings" },
  { to: "/what-if", label: "What if" },
  { to: "/roster-lab", label: "Roster Lab" },
];

const ABOUT = [
  { to: "/method", label: "How it works" },
  { to: "/about", label: "About" },
  { to: "/about#nerds", label: "The math, briefly" },
  { to: "/?tour=1", label: "Take the tour" },
  { to: "/status", label: "Pipeline status" },
];

function Column({
  title,
  children,
  className = "",
  listClassName = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
  listClassName?: string;
}) {
  return (
    <div className={className}>
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
        {title}
      </h2>
      <ul className={`mt-3 space-y-1 text-[14px] ${listClassName}`}>{children}</ul>
    </div>
  );
}

// Where every number and picture on the site comes from.
const SOURCES = [
  { before: "Games, shots, and shift charts from", label: "NHL.com", href: "https://www.nhl.com" },
  {
    before: "Standings checked against",
    label: "NHL.com standings",
    href: "https://www.nhl.com/standings",
  },
  {
    before: "Preseason point totals from",
    label: "Hockey-Reference",
    href: "https://www.hockey-reference.com",
  },
  { before: "Logos and player photos from", label: "NHL.com", href: "https://www.nhl.com" },
  { before: "Map from", label: "Natural Earth", href: "https://www.naturalearthdata.com" },
];

const sourceLink =
  "text-ink underline decoration-ice-scratch underline-offset-4 hover:decoration-ink";

const linkClass = "inline-flex min-h-[32px] items-center hover:text-blue-line hover:underline";

/** The site footer: every section, all 32 teams, and who made the site. */
export function Footer() {
  return (
    <footer className="border-t border-ice-scratch">
      <div className="mx-auto max-w-6xl px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-8 md:px-6 md:pt-10">
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-[1.5fr_0.8fr_1fr_1.3fr] lg:gap-x-10">
          <div className="col-span-2 lg:col-span-1">
            <Link to="/" className="display text-[30px] font-extrabold tracking-tight">
              Puckquake
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
          {/* The header's navigation is always on screen on phones. */}
          <Column title="Explore" className="hidden md:block">
            {EXPLORE.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className={linkClass}>
                  {l.label}
                </Link>
              </li>
            ))}
          </Column>
          <Column
            title="About"
            className="col-span-2 md:col-span-1"
            listClassName="grid grid-cols-2 gap-x-6 space-y-0 md:block md:space-y-1"
          >
            {ABOUT.map((l) => (
              <li key={l.to}>
                <Link to={l.to} className={linkClass}>
                  {l.label}
                </Link>
              </li>
            ))}
          </Column>
          {/* Phones get the sources as one sentence; the list is for wide screens. */}
          <p className="col-span-2 text-[13px] text-ink-soft md:hidden">
            Data from{" "}
            <a href="https://www.nhl.com" target="_blank" rel="noreferrer" className={sourceLink}>
              NHL.com
            </a>{" "}
            (games, shots, shift charts, standings, logos, and photos), preseason point totals from{" "}
            <a
              href="https://www.hockey-reference.com"
              target="_blank"
              rel="noreferrer"
              className={sourceLink}
            >
              Hockey-Reference
            </a>
            , and the map from{" "}
            <a
              href="https://www.naturalearthdata.com"
              target="_blank"
              rel="noreferrer"
              className={sourceLink}
            >
              Natural Earth
            </a>
            .
          </p>
          <div className="col-span-2 hidden md:block lg:col-span-1">
            <Column title="Sources">
              {SOURCES.map((src) => (
                <li key={src.before} className="py-1 text-ink-soft">
                  {src.before}{" "}
                  <a href={src.href} target="_blank" rel="noreferrer" className={sourceLink}>
                    {src.label}
                  </a>
                </li>
              ))}
            </Column>
          </div>
        </div>

        <nav
          aria-label="All teams"
          className="mt-8 border-t border-ice-scratch pt-6 md:mt-10 md:pt-8"
        >
          {/* Phones: one row of logos per division instead of 32 names. */}
          <div className="space-y-3 md:hidden">
            {DIVISIONS.map((d) => (
              <div key={d.name}>
                <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                  {d.name}
                </h2>
                <ul className="mt-1 grid grid-cols-8">
                  {d.teams.map(([abbrev, name]) => (
                    <li key={abbrev}>
                      <Link
                        to={`/team/${abbrev}`}
                        aria-label={name}
                        title={name}
                        className="flex h-11 items-center justify-center rounded-[var(--radius)] hover:bg-ice-land"
                      >
                        <TeamLogo team={abbrev} size={30} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="hidden grid-cols-2 gap-x-6 gap-y-8 md:grid md:grid-cols-4">
            {DIVISIONS.map((d) => (
              <Column key={d.name} title={d.name}>
                {d.teams.map(([abbrev, name]) => (
                  <li key={abbrev}>
                    <Link
                      to={`/team/${abbrev}`}
                      className="flex min-h-[32px] min-w-0 items-center gap-2 hover:text-blue-line hover:underline"
                    >
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
    </footer>
  );
}
