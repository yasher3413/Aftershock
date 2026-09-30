import { useEffect } from "react";
import { api } from "../api/client";
import type { ReplayBundleOut, StateResponse } from "../api/types.gen";
import { useClock } from "./clock";
import type { LiveMessage } from "./messages";
import { emptyLiveData, fromState, type LiveData } from "./reducer";
import { LiveSocket } from "./socket";
import { useLive } from "./store";
import { TimelinePlayer } from "./timeline";

/** Store contents at the start of a replayed night. */
export function replayInitial(state: StateResponse, bundle: ReplayBundleOut): LiveData {
  const base = fromState(state);
  const games = Object.fromEntries(bundle.initial.games.map((g) => [g.id, g]));
  const odds = Object.fromEntries(bundle.initial.odds.map((o) => [o.team, o]));
  return {
    ...emptyLiveData,
    ...base,
    mode: "demo",
    standings: bundle.initial.standings,
    odds,
    oddsDayStart: odds,
    games,
    tonight: bundle.initial.games.map((g) => g.id),
    tremors: [],
    quakes: [],
    lastSeq: 0,
  };
}

/**
 * Play a night's bundle through the same reducer as the live socket.
 * Seeking applies messages without animating them.
 */
export function startReplay(
  state: StateResponse,
  bundle: ReplayBundleOut,
  opts: { speed?: number; loop?: boolean; autoplay?: boolean } = {},
): TimelinePlayer {
  const initial = replayInitial(state, bundle);
  const store = useLive.getState();
  store.reset(initial);
  const start = Date.parse(bundle.start_utc);
  const player = new TimelinePlayer({
    frames: bundle.frames.map((f) => ({ t: f.t, message: f.message as LiveMessage })),
    durationMs: bundle.duration_ms,
    speed: opts.speed ?? 20,
    loop: opts.loop ?? false,
    onReset: () => useLive.getState().reset(initial),
    onFrames: (frames, { seeking }) => {
      const s = useLive.getState();
      s.applyMany(frames.map((f) => f.message));
      if (seeking) s.consumeQuakes(Number.MAX_SAFE_INTEGER);
    },
    onTick: (t) => useClock.getState().tick(t),
  });
  const clock = useClock.getState();
  clock.setReplay(player, start, bundle.duration_ms);
  clock.setSpeed(player.speed);
  if (opts.autoplay ?? true) {
    player.play();
    clock.setPlaying(true);
  }
  return player;
}

/** Load /api/state, then go live over the socket or start the demo replay. */
export function useLiveBootstrap(): void {
  useEffect(() => {
    let cancelled = false;
    let socket: LiveSocket | null = null;
    let player: TimelinePlayer | null = null;

    async function load() {
      player?.pause();
      player = null;
      const state = await api<StateResponse>("/state");
      if (cancelled) return;
      if (state.mode === "demo" && state.replay) {
        const bundle = await api<ReplayBundleOut>(`/replay/${state.replay.night_date}`);
        if (cancelled) return;
        useLive.getState().bootstrap(state);
        player = startReplay(state, bundle, { speed: state.replay.speed, loop: true });
        useLive.setState({ mode: "demo", replay: state.replay });
      } else {
        useClock.getState().setLive();
        useLive.getState().bootstrap(state);
      }
    }

    function connect() {
      socket = new LiveSocket({
        onMessage: (msg) => {
          if (msg.type === "hello" && msg.mode !== useLive.getState().mode) {
            // Live games started or ended: reload the page state.
            void load();
            return;
          }
          if (useClock.getState().mode === "live") useLive.getState().apply(msg);
        },
        onStatus: (c) => useLive.getState().setConnection(c),
        onResync: () => void load(),
        lastSeq: () => (useClock.getState().mode === "live" ? useLive.getState().lastSeq : 0),
      });
      socket.start();
    }

    load()
      .catch(() => useLive.getState().setConnection("retrying"))
      .finally(() => {
        if (!cancelled) connect();
      });
    return () => {
      cancelled = true;
      socket?.stop();
      player?.pause();
    };
  }, []);
}
