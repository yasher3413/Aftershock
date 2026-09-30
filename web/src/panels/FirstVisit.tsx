import { useState } from "react";

const KEY = "aftershock.introSeen";

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function FirstVisit() {
  const [hidden, setHidden] = useState(seen);
  if (hidden) return null;
  return (
    <div className="pointer-events-auto flex items-center gap-3 rounded-[var(--radius)] border border-ice-scratch bg-surface/95 px-3 py-2 text-[14px] shadow-[0_4px_18px_rgba(10,20,30,0.10)]">
      <span>Every goal changes every team's playoff odds. Watch it spread.</span>
      <button
        type="button"
        className="text-[13px] font-semibold text-blue-line"
        onClick={() => {
          try {
            localStorage.setItem(KEY, "1");
          } catch {
            // Storage unavailable; hide for this visit only.
          }
          setHidden(true);
        }}
      >
        Got it
      </button>
    </div>
  );
}
