import { useStatus } from "../api/client";
import { useDocumentMeta } from "../lib/meta";

function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return `${s} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

export default function StatusPage() {
  const { data, isLoading, isError } = useStatus();
  useDocumentMeta("Pipeline status");
  if (isLoading) return <div className="p-6 text-ink-soft">Loading status</div>;
  if (isError || !data)
    return <div className="p-6">The API is not answering. Check that it is running.</div>;
  const h = data.health;
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6">
      <h1 className="display text-[48px] font-extrabold leading-none">Pipeline status</h1>
      <p className={`mt-2 text-[15px] ${h.ok ? "" : "down"}`}>
        {h.ok ? "Worker is running." : "Worker heartbeat is stale or missing."} Mode: {h.mode}.
        {h.worker_lag_s != null && ` Last heartbeat ${Math.round(h.worker_lag_s)} s ago.`}
        {h.last_sim_ms != null && ` Last simulation took ${Math.round(h.last_sim_ms)} ms.`}
      </p>
      <section className="mt-6">
        <h2 className="text-[17px] font-semibold">Last successful polls</h2>
        <ul className="mt-2 text-[14px]">
          {Object.entries(h.last_poll).map(([k, v]) => (
            <li key={k} className="flex justify-between border-t border-ice-scratch py-1.5">
              <span>{k}</span>
              <span className="tabular-nums text-ink-soft">{ago(v)}</span>
            </li>
          ))}
          {Object.keys(h.last_poll).length === 0 && (
            <li className="text-ink-soft">No polls yet.</li>
          )}
        </ul>
      </section>
      <section className="mt-6">
        <h2 className="text-[17px] font-semibold">Recent simulations</h2>
        <table className="mt-2 w-full text-[14px]">
          <thead className="text-left text-[12px] text-ink-soft">
            <tr>
              <th className="font-normal">When</th>
              <th className="font-normal">Trigger</th>
              <th className="text-right font-normal">Seasons</th>
              <th className="text-right font-normal">Time</th>
            </tr>
          </thead>
          <tbody>
            {data.sim_runs.map((r) => (
              <tr key={String(r.id)} className="border-t border-ice-scratch">
                <td className="py-1.5">{ago(String(r.created_at))}</td>
                <td>{String(r.trigger)}</td>
                <td className="text-right tabular-nums">{Number(r.n_sims).toLocaleString()}</td>
                <td className="text-right tabular-nums">{Math.round(Number(r.duration_ms))} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="mt-6">
        <h2 className="text-[17px] font-semibold">Standings reconciliation</h2>
        {data.reconcile.length === 0 ? (
          <p className="mt-2 text-[14px] text-ink-soft">
            No mismatches between computed standings and NHL.com.
          </p>
        ) : (
          <ul className="mt-2 text-[14px]">
            {data.reconcile.map((r) => (
              <li key={String(r.id)} className="border-t border-ice-scratch py-1.5">
                {ago(String(r.created_at))}: {String(r.kind)}{" "}
                <code className="text-[12px] text-ink-soft">{JSON.stringify(r.detail)}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="mt-6">
        <h2 className="text-[17px] font-semibold">Jobs</h2>
        <table className="mt-2 w-full text-[14px]">
          <tbody>
            {data.jobs.map((j) => (
              <tr key={j.id} className="border-t border-ice-scratch">
                <td className="py-1.5">{j.job}</td>
                <td>{j.status}</td>
                <td className="text-right text-ink-soft">{ago(j.started_at)}</td>
                <td className="text-right tabular-nums text-ink-soft">
                  {j.finished_at
                    ? `${Math.round((Date.parse(j.finished_at) - Date.parse(j.started_at)) / 1000)} s`
                    : "running"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
