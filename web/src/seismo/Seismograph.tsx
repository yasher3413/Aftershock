import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useClock } from "../live/clock";
import { useLive } from "../live/store";
import { SPEEDS } from "../live/timeline";
import { energyTrace, groupSpikes, type Spike } from "./trace";

const LIVE_SPAN_MS = 3 * 3600_000;
const HEIGHT = 92;
const PAD_TOP = 16;
const PAD_BOTTOM = 18;

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function Seismograph() {
  const navigate = useNavigate();
  const tremors = useLive((s) => s.tremors);
  const tremorById = useMemo(() => new Map(tremors.map((t) => [t.id, t])), [tremors]);
  const mode = useClock((s) => s.mode);
  const replayStart = useClock((s) => s.replayStart);
  const replayDuration = useClock((s) => s.replayDuration);
  const replayT = useClock((s) => s.replayT);
  const playing = useClock((s) => s.playing);
  const speed = useClock((s) => s.speed);
  const player = useClock((s) => s.player);
  const wallNow = useNow(mode === "live");
  const [boxRef, width] = useWidth<HTMLDivElement>();

  const replay = mode === "replay";
  const now = replay ? replayStart + replayT : wallNow;
  const win = replay
    ? { from: replayStart, to: replayStart + replayDuration }
    : { from: now - LIVE_SPAN_MS, to: now + 2 * 60_000 };

  const spikes: Spike[] = useMemo(
    () =>
      tremors
        .filter((t) => !t.overturned)
        .map((t) => ({
          id: t.id,
          at: Date.parse(t.created_at),
          magnitude: t.magnitude,
          shift: t.total_shift,
        }))
        .filter((s) => s.at <= now),
    [tremors, now],
  );

  const plotW = Math.max(100, width - (replay ? 0 : 0));
  const x = (t: number) => ((t - win.from) / (win.to - win.from)) * plotW;
  const trace = energyTrace(spikes, win.from, win.to, now, Math.round(plotW / 3));
  const maxE = Math.max(0.02, ...trace.map((p) => p.e));
  const inner = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const y = (e: number) => PAD_TOP + inner * (1 - e / maxE) * 0.9 + inner * 0.1;
  const baseY = PAD_TOP + inner;
  const path = trace
    .map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.e).toFixed(1)}`)
    .join("");

  const ticks: number[] = [];
  const hour = 3600_000;
  for (let t = Math.ceil(win.from / hour) * hour; t < win.to; t += hour) ticks.push(t);
  // Label only as many hours as fit; every hour keeps its gridline.
  const labelEvery = Math.max(1, Math.ceil(64 / Math.max(1, (plotW * hour) / (win.to - win.from))));

  const seek = (clientX: number) => {
    const el = boxRef.current;
    if (!replay || !player || !el) return;
    const r = el.getBoundingClientRect();
    player.seek(((clientX - r.left) / r.width) * replayDuration);
  };

  const visible = spikes.filter((s) => s.at >= win.from);
  const groups = groupSpikes(visible, x, plotW);
  const labelled = new Set(
    groups.map((g) => [...g.spikes].sort((a, b) => b.magnitude - a.magnitude)[0]!.id),
  );

  return (
    <section aria-label="Seismograph" className="border-t border-ice-scratch bg-surface">
      <p className="border-b border-ice-scratch px-4 py-1.5 text-[12px] text-ink-soft">
        Goal timeline. Numbers group nearby goals; select a marker to open them.
      </p>
      <div className="flex items-stretch">
        {replay && player && (
          <div className="flex shrink-0 items-center gap-1 border-r border-ice-scratch px-3">
            <button
              type="button"
              className="h-8 w-16 rounded-[var(--radius)] bg-ink text-[13px] font-semibold text-ice"
              onClick={() => {
                if (playing) player.pause();
                else player.play();
                useClock.getState().setPlaying(!playing);
              }}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <div role="group" aria-label="Replay speed" className="ml-1 flex">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={speed === s}
                  onClick={() => {
                    player.setSpeed(s);
                    useClock.getState().setSpeed(s);
                  }}
                  className={`h-8 px-2 text-[12px] tabular-nums ${
                    speed === s ? "font-semibold text-ink" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>
          </div>
        )}
        {/* The slider and the tremor buttons are siblings: a control may not nest another. */}
        <div className="relative min-w-0 flex-1">
          <div
            ref={boxRef}
            className={replay ? "cursor-ew-resize" : undefined}
            onPointerDown={(e) => {
              if (!replay) return;
              (e.target as Element).setPointerCapture?.(e.pointerId);
              seek(e.clientX);
            }}
            onPointerMove={(e) => {
              if (replay && e.buttons === 1) seek(e.clientX);
            }}
            role={replay ? "slider" : undefined}
            aria-label={replay ? "Replay position" : undefined}
            aria-valuemin={replay ? 0 : undefined}
            aria-valuemax={replay ? Math.round(replayDuration / 60000) : undefined}
            aria-valuenow={replay ? Math.round(replayT / 60000) : undefined}
            aria-valuetext={replay ? timeLabel(now) : undefined}
            tabIndex={replay ? 0 : undefined}
            onKeyDown={(e) => {
              if (!replay || !player) return;
              if (e.key === "ArrowRight") player.seek(replayT + 5 * 60_000);
              if (e.key === "ArrowLeft") player.seek(replayT - 5 * 60_000);
            }}
          >
            <svg width={plotW} height={HEIGHT} className="block" aria-hidden>
              {ticks.map((t, i) => (
                <g key={t}>
                  <line
                    x1={x(t)}
                    x2={x(t)}
                    y1={PAD_TOP}
                    y2={baseY}
                    stroke="var(--ice-scratch)"
                    strokeWidth={1}
                  />
                  {i % labelEvery === 0 && (
                    <text x={x(t) + 4} y={HEIGHT - 5} fontSize={11} fill="var(--ink-soft)">
                      {timeLabel(t)}
                    </text>
                  )}
                </g>
              ))}
              <line x1={0} x2={plotW} y1={baseY} y2={baseY} stroke="var(--ice-scratch)" />
              {path && (
                <path
                  d={path}
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth={1.4}
                  strokeLinejoin="round"
                />
              )}
              {visible.map((s) => {
                const h = inner * Math.min(1, s.magnitude / 10);
                return (
                  <g key={s.id}>
                    <line
                      x1={x(s.at)}
                      x2={x(s.at)}
                      y1={baseY}
                      y2={baseY - h}
                      stroke="var(--goal)"
                      strokeWidth={s.magnitude >= 6 ? 2.5 : 1.5}
                    />
                    {labelled.has(s.id) && (
                      <text
                        x={x(s.at)}
                        y={baseY - h - 3}
                        textAnchor="middle"
                        fontSize={12}
                        fontWeight={800}
                        fontFamily="var(--font-display)"
                        fill="var(--goal)"
                      >
                        {s.magnitude.toFixed(1)}
                      </text>
                    )}
                  </g>
                );
              })}
              <line
                x1={x(now)}
                x2={x(now)}
                y1={4}
                y2={baseY}
                stroke="var(--blue-line)"
                strokeWidth={1.5}
              />
              <circle
                cx={x(now)}
                cy={path ? y(trace.at(-1)?.e ?? 0) : baseY}
                r={3.5}
                fill="var(--blue-line)"
              />
            </svg>
          </div>
          {groups.map((group) => {
            const spike = group.spikes[0]!;
            const marker = "absolute bottom-[18px] h-[58px] w-[24px] -translate-x-1/2";
            return group.spikes.length === 1 ? (
              <button
                key={spike.id}
                type="button"
                className={marker}
                style={{ left: group.x }}
                aria-label={`Open tremor, magnitude ${spike.magnitude.toFixed(1)}`}
                title={`${timeLabel(spike.at)}: magnitude ${spike.magnitude.toFixed(1)}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => navigate(`/tremor/${spike.id}`)}
              >
                <span className="absolute bottom-0 left-0 w-full bg-surface text-center text-[12px] font-semibold text-goal">
                  1
                </span>
              </button>
            ) : (
              <details
                key={spike.id}
                name="timeline-goals"
                className={`${marker} z-10`}
                style={{ left: group.x }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <summary
                  aria-label={`Open tremors: ${group.spikes.length} goals near ${timeLabel(spike.at)}`}
                  title="Nearby goals: choose one to open"
                  className="relative h-full w-full cursor-pointer list-none [&::-webkit-details-marker]:hidden"
                >
                  <span className="absolute bottom-0 left-0 w-full bg-surface text-center text-[12px] font-semibold text-goal">
                    {group.spikes.length}
                  </span>
                </summary>
                <div
                  className="absolute bottom-[64px] max-h-60 w-[220px] overflow-y-auto rounded-[var(--radius)] border border-ice-scratch bg-surface p-2"
                  style={{ left: Math.max(12 - group.x, Math.min(-98, plotW - group.x - 232)) }}
                >
                  <p className="px-2 py-1 text-[12px] text-ink-soft">Choose a goal to open</p>
                  {group.spikes.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="block min-h-[44px] w-full rounded-[var(--radius)] px-2 py-2 text-left text-[13px] hover:bg-ice-land"
                      onClick={() => navigate(`/tremor/${s.id}`)}
                    >
                      <span className="block font-semibold">
                        {tremorById.get(s.id)?.scorer?.name ?? "Goal"}{" "}
                        {tremorById.get(s.id)?.team && `(${tremorById.get(s.id)!.team})`}
                      </span>
                      <span className="mt-1 flex justify-between gap-2 text-[12px] text-ink-soft">
                        <span>{timeLabel(s.at)}</span>
                        <span>Magnitude {s.magnitude.toFixed(1)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      </div>
    </section>
  );
}
