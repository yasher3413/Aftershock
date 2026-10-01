import { MapKey } from "./MapKey";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useLive } from "../live/store";
import { useMyTeam } from "../lib/myTeam";
import { useDarkScheme, useReducedMotion } from "../lib/useMedia";
import { announceTremor } from "../lib/announce";
import { arrow, clock, pct, periodLabel, pp } from "../lib/format";
import { MapController, type MapLayout } from "./controller";
import type { GameSummary } from "../api/types.gen";

const LIVE = new Set(["LIVE", "CRIT"]);

export function MapView() {
  const host = useRef<HTMLDivElement>(null);
  const ctrl = useRef<MapController | null>(null);
  const [layout, setLayout] = useState<MapLayout | null>(null);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
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

  const teamList = useMemo(() => Object.values(teams), [teams]);

  useEffect(() => {
    if (!ready || !ctrl.current) return;
    ctrl.current.setTeams(
      teamList.map((t) => ({ abbrev: t.abbrev, lat: t.lat, lon: t.lon, color: t.color_primary })),
    );
  }, [ready, teamList]);

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
  const venueByName = useMemo(() => Object.fromEntries(venues.map((v) => [v.name, v])), [venues]);

  return (
    <div className="relative h-full w-full overflow-hidden" data-testid="map">
      <div ref={host} className="absolute inset-0" />
      <MapKey />
      <div className="sr-only" aria-live="polite" role="status">
        {announcement}
      </div>
      {layout &&
        liveGames.map((g) => {
          const v = g.venue ? venueByName[g.venue] : undefined;
          const home = teams[g.home];
          const lat = v?.lat ?? home?.lat;
          const lon = v?.lon ?? home?.lon;
          if (lat == null || lon == null) return null;
          const p = layout.place(lat, lon);
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
        const live = g && LIVE.has(g.state);
        const change = o && oddsStart[p.id] ? o.p_playoffs - oddsStart[p.id]!.p_playoffs : 0;
        const label = `${t.name}. Playoff odds ${o ? pct(o.p_playoffs) : "unknown"}.${
          change ? ` ${pp(change, 1, " percentage points")} today.` : ""
        }`;
        const size = p.r * 2;
        return (
          <div key={p.id}>
            <button
              type="button"
              aria-label={label}
              onClick={() => navigate(`/team/${p.id}`)}
              onMouseEnter={() => setHover(p.id)}
              onMouseLeave={() => setHover((h) => (h === p.id ? null : h))}
              onFocus={() => setHover(p.id)}
              onBlur={() => setHover((h) => (h === p.id ? null : h))}
              data-team={p.id}
              className="display absolute flex items-center justify-center rounded-full text-[12px] font-bold text-ink before:absolute before:-inset-2 before:rounded-full"
              style={{
                left: p.x - size / 2,
                top: p.y - size / 2,
                width: size,
                height: size,
                fontSize: p.r < 13 ? 10 : 12,
              }}
            >
              {p.id}
            </button>
            {live && g && (
              <span
                className="pointer-events-none absolute whitespace-nowrap rounded-[var(--radius)] bg-ink px-1.5 py-px text-[11px] font-semibold text-ice"
                style={{ left: p.x + p.r + 4, top: p.y - 8 }}
                aria-hidden
              >
                {g.home === p.id ? g.home_score : g.away_score}
              </span>
            )}
            {hover === p.id && (
              <div
                role="tooltip"
                className="pointer-events-none absolute z-20 w-52 rounded-[var(--radius)] border border-ice-scratch bg-surface p-3 text-[13px] shadow-[0_6px_24px_rgba(10,20,30,0.14)]"
                style={{
                  left: Math.min(p.x + p.r + 8, (layout?.width ?? 9999) - 220),
                  top: Math.max(8, p.y - 30),
                }}
              >
                <div className="font-semibold">{t.name}</div>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-ink-soft">Playoff odds</span>
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
                      ? `, ${g.away_score}-${g.home_score}, ${periodLabel(g.period, g.period_type)} ${clock(g.clock_seconds)}`
                      : g.state === "FUT" || g.state === "PRE"
                        ? `, ${new Date(g.start_utc).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
                        : `, final ${g.away_score}-${g.home_score}`}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
