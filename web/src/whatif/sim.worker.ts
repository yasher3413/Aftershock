/// <reference lib="webworker" />
import init, { simulate } from "../wasm/pkg/aftershock_wasm";

export interface SimRequest {
  id: number;
  state: unknown;
  n: number;
  seed: number;
}

let ready: Promise<unknown> | null = null;

self.onmessage = async (e: MessageEvent<SimRequest>) => {
  const { id, state, n, seed } = e.data;
  try {
    ready ??= init();
    await ready;
    const t0 = performance.now();
    const out = simulate(JSON.stringify(state), n, BigInt(seed));
    self.postMessage({ id, result: JSON.parse(out), ms: performance.now() - t0 });
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
