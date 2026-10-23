import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, Link, ScrollRestoration, useLocation } from "react-router";
import { useLive } from "../live/store";
import { useClock } from "../live/clock";
import { longDate } from "../lib/format";
import { Search } from "./Search";
import { Footer } from "./Footer";

const NAV = [
  { to: "/", label: "Tonight", end: true },
  { to: "/nights", label: "Nights" },
  { to: "/leaders", label: "Leaders" },
  { to: "/teams", label: "Teams" },
  { to: "/what-if", label: "What if" },
  { to: "/method", label: "How it works" },
];

export function Shell() {
  // The home view is an app-like screen that fills the viewport on desktop;
  // the footer sits below it, a scroll away, as on every other page. Every
  // page starts at least a screen tall, so the footer never shows while a
  // page is still loading and then jumps away.
  const path = useLocation().pathname;
  const home = path === "/";
  return (
    <div className="flex flex-col">
      <div className={`flex min-h-dvh flex-col ${home ? "lg:h-dvh" : ""}`}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:bg-surface focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <header className="border-b border-ice-scratch">
          {/* The home map runs edge to edge; every other page sits in the
            max-w-6xl column, so the header lines up with it. */}
          <div
            className={`flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 md:px-6 ${home ? "" : "mx-auto max-w-6xl"}`}
          >
            <Link to="/" className="display text-[30px] font-extrabold tracking-tight text-ink">
              Puckquake
            </Link>
            {/* Home states live or replay in its own title block. */}
            {!home && <ModeChip />}
            <Search />
            <MainNav />
          </div>
        </header>
        <main id="main" className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </main>
      </div>
      <Footer />
      <ScrollRestoration />
    </div>
  );
}

/** On narrow screens the links scroll sideways, and the edge fades while
 * more of them sit off screen, so a cut-off label reads as "scroll", not a bug. */
function MainNav() {
  const ref = useRef<HTMLElement>(null);
  const [more, setMore] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [pathname]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      ro.disconnect();
    };
  }, []);
  return (
    <nav
      ref={ref}
      aria-label="Main"
      data-tour="nav"
      className={`-mx-2 flex w-[calc(100%+1rem)] overflow-x-auto text-[14px] [scrollbar-width:none] lg:mx-0 lg:ml-auto lg:w-auto lg:gap-1 lg:overflow-visible ${more ? "[mask-image:linear-gradient(to_right,#000_calc(100%-40px),transparent)]" : ""}`}
    >
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          className={({ isActive }) =>
            `inline-flex min-h-[44px] items-center whitespace-nowrap rounded-[var(--radius)] px-2 py-1 transition-colors lg:px-2.5 lg:py-1.5 ${
              isActive ? "bg-ice-land font-semibold text-ink" : "text-ink-soft hover:text-ink"
            }`
          }
        >
          {n.label}
        </NavLink>
      ))}
    </nav>
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
