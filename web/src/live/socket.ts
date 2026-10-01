import type { LiveMessage } from "./messages";

export interface SocketHandlers {
  onMessage: (msg: LiveMessage) => void;
  onStatus: (status: "connecting" | "open" | "retrying") => void;
  /** The server could not fill the gap; refetch /api/state. */
  onResync: () => void;
  lastSeq: () => number;
}

export const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000];

export function backoff(attempt: number): number {
  const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
  return base * (0.75 + Math.random() * 0.5);
}

/**
 * The live socket. Same origin by default; a deployment whose api is on
 * another host (the website on Vercel) sets VITE_WS_URL, since Vercel cannot
 * forward WebSockets.
 */
export function socketUrl(
  lastSeq: number,
  loc: Location = window.location,
  base: string | undefined = import.meta.env.VITE_WS_URL,
): string {
  const since = lastSeq > 0 ? `?since=${lastSeq}` : "";
  if (base) return `${base}${since}`;
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}/ws/live${since}`;
}

/** One WebSocket with automatic reconnect and `since` gap filling. */
export class LiveSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  private handlers: SocketHandlers;

  constructor(handlers: SocketHandlers) {
    this.handlers = handlers;
  }

  start(): void {
    this.closed = false;
    this.connect();
  }

  stop(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    this.handlers.onStatus(this.attempt === 0 ? "connecting" : "retrying");
    const ws = new WebSocket(socketUrl(this.handlers.lastSeq()));
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.handlers.onStatus("open");
    };
    ws.onmessage = (ev) => {
      let data: unknown;
      try {
        data = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const msg = data as { type?: string };
      if (msg.type === "resync") {
        this.handlers.onResync();
        return;
      }
      this.handlers.onMessage(data as LiveMessage);
    };
    ws.onclose = () => {
      if (this.closed) return;
      this.handlers.onStatus("retrying");
      this.timer = setTimeout(() => this.connect(), backoff(this.attempt++));
    };
    ws.onerror = () => ws.close();
  }
}
