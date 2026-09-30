import { create } from "zustand";
import type { TimelinePlayer } from "./timeline";

/**
 * The page's notion of "now". Live: the wall clock. Replay: the night's
 * first puck drop plus the timeline player's position.
 */
interface ClockStore {
  mode: "live" | "replay";
  /** Epoch ms of the replayed night's first puck drop. */
  replayStart: number;
  replayDuration: number;
  replayT: number;
  playing: boolean;
  speed: number;
  player: TimelinePlayer | null;
  setReplay: (p: TimelinePlayer, start: number, duration: number) => void;
  setLive: () => void;
  tick: (t: number) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
}

export const useClock = create<ClockStore>((set) => ({
  mode: "live",
  replayStart: 0,
  replayDuration: 0,
  replayT: 0,
  playing: false,
  speed: 20,
  player: null,
  setReplay: (player, start, duration) =>
    set({ mode: "replay", player, replayStart: start, replayDuration: duration, replayT: 0 }),
  setLive: () => set({ mode: "live", player: null }),
  tick: (replayT) => set({ replayT }),
  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),
}));

export function nowMs(): number {
  const c = useClock.getState();
  return c.mode === "replay" ? c.replayStart + c.replayT : Date.now();
}
