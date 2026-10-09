import { create } from "zustand";

/** Set once the visitor finishes or skips the tour, so it never reopens on
 * its own. (The old one-line intro used aftershock.introSeen.) */
const KEY = "aftershock.tourSeen";

export function tourSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function remember(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // Storage unavailable (private mode): the tour may show again next visit.
  }
}

interface TourStore {
  open: boolean;
  step: number;
  start: () => void;
  go: (step: number) => void;
  close: () => void;
}

export const useTour = create<TourStore>((set) => ({
  open: false,
  step: 0,
  start: () => set({ open: true, step: 0 }),
  go: (step) => set({ step }),
  close: () => {
    remember();
    set({ open: false, step: 0 });
  },
}));
