import { NavLink, Outlet, Link, useLocation } from "react-router";
import { useLive } from "../live/store";
import { useClock } from "../live/clock";
import { longDate } from "../lib/format";

const NAV = [
  { to: "/", label: "Tonight", end: true },
  { to: "/nights", label: "Nights" },
  { to: "/leaders", label: "Leaders" },
  { to: "/what-if", label: "What if" },
  { to: "/method", label: "How it works" },
];

export function Shell() {
  // The home view is an app-like screen pinned to the viewport on desktop.
  const path = useLocation().pathname;
  const home = path === "/" || path.startsWith("/night/");
  return (
    <div className={`flex flex-col ${home ? "min-h-dvh lg:h-dvh" : "min-h-dvh"}`}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-ice-scratch px-4 py-2 md:px-6">
        <Link to="/" className="display text-[30px] font-extrabold tracking-tight text-ink">
          Aftershock
        </Link>
        <ModeChip />
        <nav
          aria-label="Main"
          className="-mx-2 flex w-full justify-between text-[14px] sm:mx-0 sm:ml-auto sm:w-auto sm:justify-start sm:gap-1"
        >
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-[var(--radius)] px-2 py-1 transition-colors sm:px-2.5 sm:py-1.5 ${
                  isActive ? "bg-ice-land font-semibold text-ink" : "text-ink-soft hover:text-ink"
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main id="main" className="flex min-h-0 flex-1 flex-col">
        <Outlet />
      </main>
      <footer className="border-t border-ice-scratch px-4 py-3 text-[12px] text-ink-soft md:px-6">
        Data from NHL.com. Aftershock is not affiliated with or endorsed by the NHL.{" "}
        <Link
          to="/status"
          className="underline decoration-ice-scratch underline-offset-2 hover:text-ink"
        >
          Pipeline status
        </Link>
      </footer>
    </div>
  );
}

function ModeChip() {
  const mode = useLive((s) => s.mode);
  const replay = useLive((s) => s.replay);
  const liveCount = useLive(
    (s) => Object.values(s.games).filter((g) => g.state === "LIVE" || g.state === "CRIT").length,
  );
  const loaded = useLive((s) => s.loaded);
  const replaying = useClock((s) => s.mode === "replay");
  if (!loaded) return null;
  if (replaying && !(mode === "demo" && replay)) {
    return <span className="hidden text-[13px] text-ink-soft sm:inline">Replay</span>;
  }
  if (mode === "demo" && replay) {
    return (
      <span className="hidden text-[13px] text-ink-soft sm:inline">
        Replay of {longDate(replay.night_date)}
      </span>
    );
  }
  return (
    <span className="hidden items-center gap-2 text-[13px] text-ink-soft sm:inline-flex">
      {liveCount > 0 && <span aria-hidden className="h-2 w-2 rounded-full bg-goal" />}
      {liveCount > 0 ? `${liveCount} ${liveCount === 1 ? "game" : "games"} live` : "No games live"}
    </span>
  );
}
