import { MapKey } from "./MapKey";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useLive } from "../live/store";
import { useClock } from "../live/clock";
import { useMyTeam } from "../lib/myTeam";
import { useDarkScheme, useReducedMotion } from "../lib/useMedia";
import { announceTremor } from "../lib/announce";
import { arrow, liveClock, pct, pp } from "../lib/format";
import { MapController, type MapLayout } from "./controller";
import { TeamLogo } from "../components/TeamLogo";
import type { GameSummary } from "../api/types.gen";
import { teamTickColor } from "../lib/teamColor";

const LIVE = new Set(["LIVE", "CRIT"]);

export function MapView() {
  const host = useRef<HTMLDivElement>(null);
  const shaker = useRef<HTMLDivElement>(null);
  const ctrl = useRef<MapController | null>(null);
  const [layout, setLayout] = useState<MapLayout | null>(null);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  // On touch there is no hover: the first tap previews a team, the second
  // (or the card's link) opens it.
  const pointer = useRef("mouse");
  const [pinned, setPinned] = useState(false);
  const replaying = useClock((s) => s.mode === "replay");
  const outer = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [zoomHint, setZoomHint] = useState(false);
  const navigate = useNavigate();

  const teams = useLive((s) => s.teams);
  const odds = useLive((s) => s.odds);
  const oddsStart = useLive((s) => s.oddsDayStart);
  const quakes = useLive((s) => s.quakes);
  const games = useLive((s) => s.games);
  const venues = useLive((s) => s.venues);
  const consumeQuakes = useLive((s) => s.consumeQuakes);
  const myTeam = useMyTeam((s) => s.team);
  const reduced = useReducedMotion();
  const dark = useDarkScheme();

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const c = new MapController(el);
    ctrl.current = c;
    c.onLayout = setLayout;
    c.onZoom = setZoom;
    c.shakeTarget = shaker.current;
    let alive = true;
    c.init().then(() => alive && setReady(true));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el);
    return () => {
      alive = false;
      ro.disconnect();
      c.destroy();
      ctrl.current = null;
    };
  }, []);

  // Zoom: ctrl or cmd + scroll (and a trackpad pinch, which arrives the same
  // way) zooms at the pointer; two fingers pinch on a touch screen; a drag
  // pans once zoomed in. Plain scrolling is left to the page.
  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const local = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      return [x - r.left, y - r.top] as const;
    };
    let hintTimer: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      const c = ctrl.current;
      if (!c) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const d = Math.max(-60, Math.min(60, e.deltaY));
        c.zoomAt(Math.exp(-d * 0.01), ...local(e.clientX, e.clientY));
      } else {
        setZoomHint(true);
        clearTimeout(hintTimer);
        hintTimer = setTimeout(() => setZoomHint(false), 1600);
      }
    };
    const pts = new Map<number, { x: number; y: number }>();
    let pinch: { cx: number; cy: number; d: number } | null = null;
    let moved = 0;
    const onDown = (e: PointerEvent) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) moved = 0;
      pinch = null;
    };
    const onMove = (e: PointerEvent) => {
      const prev = pts.get(e.pointerId);
      const c = ctrl.current;
      if (!prev || !c) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size >= 2) {
        const [a, b] = [...pts.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch && pinch.d > 0) {
          c.zoomAt(d / pinch.d, ...local(cx, cy));
          c.panBy(cx - pinch.cx, cy - pinch.cy);
          moved += 10;
        }
        pinch = { cx, cy, d };
      } else if (c.zoomLevel > 1 && (e.pointerType !== "mouse" || e.buttons === 1)) {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        moved += Math.abs(dx) + Math.abs(dy);
        if (moved > 4) c.panBy(dx, dy);
      }
    };
    const onUp = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      pinch = null;
      // A drag or pinch is not a tap: swallow the click it would end in.
      if (e.type === "pointerup" && moved > 6 && pts.size === 0) {
        const stop = (ev: Event) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        el.addEventListener("click", stop, { capture: true, once: true });
        setTimeout(() => el.removeEventListener("click", stop, { capture: true }), 0);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      clearTimeout(hintTimer);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const teamList = useMemo(() => Object.values(teams), [teams]);

  useEffect(() => {
    if (!ready || !ctrl.current) return;
    ctrl.current.setTeams(
      teamList.map((t) => ({
        abbrev: t.abbrev,
        lat: t.lat,
        lon: t.lon,
        color: teamTickColor(t.color_primary, t.color_secondary, dark),
      })),
    );
  }, [ready, teamList, dark]);

  useEffect(() => {
    if (ctrl.current) ctrl.current.reducedMotion = reduced;
  }, [reduced]);

  useEffect(() => {
    if (ready) ctrl.current?.setTheme();
  }, [dark, ready]);

  useEffect(() => {
    if (ready) ctrl.current?.setHighlight(myTeam);
  }, [myTeam, ready, layout]);

  // Quakes first, so a ring is scheduled before the new odds arrive at nodes.
  useEffect(() => {
    const c = ctrl.current;
    if (!ready || !c) return;
    if (quakes.length) {
      for (const q of quakes) {
        const t = q.tremor;
        c.quake({
          id: t.id,
          kind: q.kind,
          lat: t.origin.lat,
          lon: t.origin.lon,
          magnitude: t.magnitude,
          deltas: Object.fromEntries(t.deltas.map((d) => [d.team, d.d_playoffs])),
          after: Object.fromEntries(t.deltas.map((d) => [d.team, d.p_playoffs_after])),
        });
      }
      consumeQuakes(quakes[quakes.length - 1]!.seq);
    }
    c.setOdds(Object.fromEntries(Object.values(odds).map((o) => [o.team, o.p_playoffs])));
  }, [quakes, odds, ready, consumeQuakes]);

  const latest = useLive((s) => s.tremors[0]);
  const announcement = useMemo(
    () => (latest ? announceTremor(latest, teams, myTeam) : ""),
    [latest, teams, myTeam],
  );
  const positions = layout?.nodes ?? [];

  const liveGames = useMemo(() => Object.values(games).filter((g) => LIVE.has(g.state)), [games]);
  const gameByTeam = useMemo(() => {
    const m: Record<string, GameSummary> = {};
    for (const g of Object.values(games)) {
      m[g.home] = g;
      m[g.away] = g;
    }
    return m;
  }, [games]);
  const keyNodes = useMemo(
    () => (layout?.nodes ?? []).map((p) => ({ x: p.x, y: p.y, r: p.r })),
    [layout],
  );
  const venueByName = useMemo(() => Object.fromEntries(venues.map((v) => [v.name, v])), [venues]);

  return (
    <div
      ref={outer}
      className="relative h-full w-full overflow-hidden"
      // One finger scrolls the page until the map is zoomed in; then it pans.
      style={{ touchAction: zoom > 1 ? "none" : "pan-y" }}
      data-testid="map"
      data-tour="map"
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button, [role=tooltip]")) {
          setHover(null);
          setPinned(false);
        }
      }}
    >
      <MapKey nodes={keyNodes} width={layout?.width ?? 0} height={layout?.height ?? 0} />
      <ZoomControls
        zoom={zoom}
        onZoom={(f) => ctrl.current?.zoomBy(f)}
        onReset={() => ctrl.current?.resetZoom()}
      />
      <p
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 bottom-3 z-20 mx-auto w-max rounded-[var(--radius)] bg-ink/85 px-3 py-1.5 text-[13px] font-semibold text-ice transition-opacity duration-300 ${zoomHint ? "opacity-100" : "opacity-0"}`}
      >
        {/Mac|iPhone|iPad/.test(navigator.platform)
          ? "Pinch or hold ⌘ and scroll to zoom the map"
          : "Hold Ctrl and scroll to zoom the map"}
      </p>
      <div className="sr-only" aria-live="polite" role="status">
        {announcement}
      </div>
      <div ref={shaker} className="absolute inset-0">
        <div ref={host} className="absolute inset-0" />
        {layout &&
          liveGames.map((g) => {
            const v = g.venue ? venueByName[g.venue] : undefined;
            const home = teams[g.home];
            const lat = v?.lat ?? home?.lat;
            const lon = v?.lon ?? home?.lon;
            if (lat == null || lon == null) return null;
            // At the home arena, pulse on the home team's circle, which the
            // layout may have nudged off the arena's exact spot; a neutral
            // site pulses where it really is.
            const node = positions.find((n) => n.id === g.home);
            const atHome = !v || !home || v.name === home.arena;
            const p =
              atHome && node ? { x: node.x, y: node.y, offMap: false } : layout.place(lat, lon);
            if (!p) return null;
            return (
              <div
                key={g.id}
                className="pointer-events-none absolute"
                style={{ left: p.x, top: p.y, transform: "translate(-50%, -50%)" }}
              >
                {!reduced && <span className="live-pulse" aria-hidden />}
                {p.offMap && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-[var(--radius)] border border-ice-scratch bg-surface px-2 py-0.5 text-[12px] text-ink-soft">
                    {v?.city.split(",")[0] ?? g.venue}
                  </span>
                )}
              </div>
            );
          })}
        {positions.map((p) => {
          const t = teams[p.id];
          const o = odds[p.id];
          if (!t) return null;
          const g = gameByTeam[p.id];
          const live = !!g && LIVE.has(g.state);
          const change = o && oddsStart[p.id] ? o.p_playoffs - oddsStart[p.id]!.p_playoffs : 0;
          const label = `${t.name}${live ? ", playing now" : ""}. Playoff odds ${o ? pct(o.p_playoffs) : "unknown"}.${
            change ? ` ${pp(change, 1, " percentage points")} today.` : ""
          }`;
          const size = p.r * 2;
          const targetSize = Math.max(24, size);
          return (
            <div key={p.id}>
              {/* Both teams in a game on now get a red outline; the arena also pulses. */}
              {live && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute rounded-full border-2 border-goal"
                  style={{
                    left: p.x - p.r - 4,
                    top: p.y - p.r - 4,
                    width: (p.r + 4) * 2,
                    height: (p.r + 4) * 2,
                  }}
                />
              )}
              <button
                type="button"
                aria-label={label}
                onPointerDown={(e) => {
                  pointer.current = e.pointerType;
                }}
                onClick={() => {
                  if (pointer.current === "touch" && !(pinned && hover === p.id)) {
                    setHover(p.id);
                    setPinned(true);
                    return;
                  }
                  navigate(`/team/${p.id}`);
                }}
                onMouseEnter={() => {
                  if (!pinned) setHover(p.id);
                }}
                onMouseLeave={() => {
                  if (!pinned) setHover((h) => (h === p.id ? null : h));
                }}
                onFocus={() => setHover(p.id)}
                onBlur={() => setHover((h) => (h === p.id ? null : h))}
                data-team={p.id}
                className="display absolute flex items-center justify-center rounded-full text-[12px] font-bold text-ink"
                style={{
                  left: p.x - targetSize / 2,
                  top: p.y - targetSize / 2,
                  width: targetSize,
                  height: targetSize,
                  fontSize: p.r < 13 ? 10 : 12,
                }}
              >
                <TeamLogo team={p.id} size={Math.round(size * 0.66)} />
              </button>
              {hover === p.id && (
                <div
                  role="tooltip"
                  className={`${pinned ? "pointer-events-auto" : "pointer-events-none"} absolute z-20 w-52 rounded-[var(--radius)] border border-ice-scratch bg-surface p-3 text-[13px] shadow-[0_6px_24px_rgba(10,20,30,0.14)]`}
                  style={{
                    left: Math.min(p.x + p.r + 8, (layout?.width ?? 9999) - 220),
                    top: Math.max(8, p.y - 30),
                  }}
                >
                  <div className="font-semibold">{t.name}</div>
                  <div className="mt-1 flex items-baseline justify-between">
                    {/* A replay shows the odds as they were then; the team
                      page shows them now, so say which this is. */}
                    <span className="text-ink-soft">
                      {replaying ? "Odds in this replay" : "Playoff odds"}
                    </span>
                    <span className="display text-[22px] font-bold">
                      {o ? pct(o.p_playoffs) : ""}
                    </span>
                  </div>
                  {change !== 0 && (
                    <div className={`text-right ${change > 0 ? "up" : "down"}`}>
                      {arrow(change)} {pp(change)} today
                    </div>
                  )}
                  {g && (
                    <div className="mt-2 border-t border-ice-scratch pt-2 text-ink-soft">
                      {g.away} at {g.home}
                      {LIVE.has(g.state)
                        ? `, ${g.away_score}-${g.home_score}, ${liveClock(g)}`
                        : g.state === "FUT" || g.state === "PRE"
                          ? `, ${new Date(g.start_utc).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
                          : `, final ${g.away_score}-${g.home_score}`}
                    </div>
                  )}
                  {pinned && (
                    <Link
                      to={`/team/${p.id}`}
                      className="mt-2 flex min-h-[44px] items-center justify-center rounded-[var(--radius)] border border-ink text-[13px] font-semibold"
                    >
                      Open {t.name}
                    </Link>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const icon = {
  viewBox: "0 0 20 20",
  width: 16,
  height: 16,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  "aria-hidden": true,
};

/** Zoom buttons in the map's top right corner. */
function ZoomControls({
  zoom,
  onZoom,
  onReset,
}: {
  zoom: number;
  onZoom: (factor: number) => void;
  onReset: () => void;
}) {
  const button =
    "flex h-10 w-10 items-center justify-center bg-surface text-ink hover:bg-ice-land disabled:text-ink-soft disabled:opacity-50 sm:h-9 sm:w-9";
  return (
    <div className="absolute right-3 top-3 z-20 flex gap-2">
      {zoom > 1 && (
        <button
          type="button"
          onClick={onReset}
          aria-label="Reset map"
          className={`${button} rounded-[var(--radius)] border border-ice-scratch`}
        >
          <svg {...icon}>
            <path d="M4 10a6 6 0 1 0 2-4.5M4 3v3.5h3.5" />
          </svg>
        </button>
      )}
      <div className="flex overflow-hidden rounded-[var(--radius)] border border-ice-scratch">
        <button
          type="button"
          onClick={() => onZoom(1 / 1.6)}
          disabled={zoom <= 1}
          aria-label="Zoom out"
          className={`${button} border-r border-ice-scratch`}
        >
          <svg {...icon}>
            <path d="M5 10h10" />
          </svg>
        </button>
        <button type="button" onClick={() => onZoom(1.6)} aria-label="Zoom in" className={button}>
          <svg {...icon}>
            <path d="M5 10h10M10 5v10" />
          </svg>
        </button>
      </div>
    </div>
  );
}
