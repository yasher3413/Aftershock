import type { LiveMessage } from "./messages";

export interface Frame {
  /** Milliseconds from the start of the night. */
  t: number;
  message: LiveMessage;
}

export const SPEEDS = [1, 5, 20, 60] as const;
export type Speed = (typeof SPEEDS)[number];

export interface TimelineOptions {
  frames: Frame[];
  durationMs: number;
  speed?: number;
  loop?: boolean;
  /** Messages due in (from, to]; called in order. */
  onFrames: (frames: Frame[], opts: { seeking: boolean }) => void;
  /** Called before replaying from zero (seek backwards or loop). */
  onReset: () => void;
  onTick?: (t: number) => void;
}

/**
 * Plays a night's frames against a virtual clock. Drives both replay pages
 * and demo mode through the same message reducer the live socket uses.
 */
export class TimelinePlayer {
  t = 0;
  playing = false;
  speed: number;
  private idx = 0;
  private last: number | null = null;
  private raf: number | null = null;

  private opts: TimelineOptions;

  constructor(opts: TimelineOptions) {
    this.opts = opts;
    this.speed = opts.speed ?? 20;
  }

  get duration(): number {
    return this.opts.durationMs;
  }

  /** Advance the clock by `realMs` of wall time. Exposed for tests. */
  advance(realMs: number): void {
    const target = this.t + realMs * this.speed;
    if (target >= this.opts.durationMs) {
      this.emitUntil(this.opts.durationMs, false);
      if (this.opts.loop) {
        this.seek(0);
        return;
      }
      this.t = this.opts.durationMs;
      this.pause();
      this.opts.onTick?.(this.t);
      return;
    }
    this.emitUntil(target, false);
    this.t = target;
    this.opts.onTick?.(this.t);
  }

  seek(t: number): void {
    const clamped = Math.max(0, Math.min(t, this.opts.durationMs));
    if (clamped < this.t || clamped === 0) {
      this.opts.onReset();
      this.idx = 0;
    }
    this.emitUntil(clamped, true);
    this.t = clamped;
    this.opts.onTick?.(this.t);
  }

  play(): void {
    if (this.playing) return;
    this.playing = true;
    this.last = null;
    const step = (now: number) => {
      if (!this.playing) return;
      if (this.last !== null) this.advance(Math.min(now - this.last, 250));
      this.last = now;
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  pause(): void {
    this.playing = false;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  private emitUntil(t: number, seeking: boolean): void {
    const due: Frame[] = [];
    const frames = this.opts.frames;
    while (this.idx < frames.length && frames[this.idx]!.t <= t) {
      due.push(frames[this.idx]!);
      this.idx++;
    }
    if (due.length) this.opts.onFrames(due, { seeking });
  }
}
