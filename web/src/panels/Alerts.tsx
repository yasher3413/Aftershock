import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

const THRESHOLDS = [3, 4, 5, 6];

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type Status = "idle" | "on" | "blocked" | "error" | "working";

/** Web push for tremors above a chosen magnitude that involve this team. */
export function Alerts({ team }: { team: string }) {
  const supported =
    typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
  const key = useQuery({
    queryKey: ["push-key"],
    queryFn: () => api<{ key: string }>("/push/key"),
    retry: false,
    enabled: supported,
    staleTime: Infinity,
  });
  const [min, setMin] = useState(5);
  const [status, setStatus] = useState<Status>("idle");

  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.getRegistration().then(async (reg) => {
      const sub = await reg?.pushManager.getSubscription();
      if (sub) setStatus("on");
    });
  }, [supported]);

  if (!supported || !key.data) return null;

  const enable = async () => {
    setStatus("working");
    try {
      if ((await Notification.requestPermission()) !== "granted") {
        setStatus("blocked");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64ToBytes(key.data.key),
        }));
      const json = sub.toJSON();
      await api("/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: { endpoint: json.endpoint, keys: json.keys },
          team,
          min_magnitude: min,
        }),
      }).catch(() => null);
      setStatus("on");
    } catch {
      setStatus("error");
    }
  };

  const disable = async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint, keys: sub.toJSON().keys }),
      });
      await sub.unsubscribe();
    }
    setStatus("idle");
  };

  return (
    <div className="mt-2 flex flex-wrap items-center justify-end gap-2 text-[13px]">
      {status === "on" ? (
        <>
          <span>Alerts on for {team} tremors.</span>
          <button type="button" onClick={disable} className="font-semibold text-blue-line">
            Turn off
          </button>
        </>
      ) : (
        <>
          <label className="text-ink-soft">
            Alert me for {team} tremors of magnitude{" "}
            <select
              value={min}
              onChange={(e) => setMin(Number(e.target.value))}
              className="rounded-[var(--radius)] border border-ice-scratch bg-surface px-1 py-0.5 text-ink"
            >
              {THRESHOLDS.map((t) => (
                <option key={t} value={t}>
                  {t}+
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={enable}
            disabled={status === "working"}
            className="font-semibold text-blue-line"
          >
            Turn on
          </button>
        </>
      )}
      {status === "blocked" && (
        <span className="down">
          Notifications are blocked for this site in your browser settings.
        </span>
      )}
      {status === "error" && <span className="down">Could not turn on alerts. Try again.</span>}
    </div>
  );
}
