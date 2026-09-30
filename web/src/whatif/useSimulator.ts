import { useEffect, useRef, useState } from "react";

export interface TeamResult {
  team: string;
  p_playoffs: number;
  p_division: number;
  p_cup: number;
  p_round2: number;
  p_conf_final: number;
  p_final: number;
  exp_points: number;
  seed_dist: Record<string, number>;
}

export interface SimOutput {
  teams: TeamResult[];
  n_sims: number;
}

/** Runs the WASM simulator in a worker; only the latest request's answer is kept. */
export function useSimulator() {
  const worker = useRef<Worker | null>(null);
  const latest = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolvers = useRef(
    new Map<number, (r: { result: SimOutput; ms: number } | null) => void>(),
  );

  useEffect(() => {
    const w = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e) => {
      const {
        id,
        result,
        ms,
        error: err,
      } = e.data as { id: number; result?: SimOutput; ms?: number; error?: string };
      const resolve = resolvers.current.get(id);
      resolvers.current.delete(id);
      if (id === latest.current) {
        setBusy(false);
        setError(err ?? null);
      }
      resolve?.(result && ms != null ? { result, ms } : null);
    };
    worker.current = w;
    return () => w.terminate();
  }, []);

  const run = (
    state: unknown,
    n: number,
    seed = 1,
  ): Promise<{ result: SimOutput; ms: number } | null> => {
    const id = ++latest.current;
    setBusy(true);
    return new Promise((resolve) => {
      resolvers.current.set(id, resolve);
      worker.current?.postMessage({ id, state, n, seed });
    });
  };

  return {
    run,
    busy,
    error,
    isLatest: (id: number) => id === latest.current,
    latestId: () => latest.current,
  };
}
