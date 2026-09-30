import { create } from "zustand";

const KEY = "aftershock.myTeam";

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

interface MyTeamStore {
  team: string | null;
  setTeam: (t: string | null) => void;
}

/** The viewer's team, remembered in this browser only. */
export const useMyTeam = create<MyTeamStore>((set) => ({
  team: read(),
  setTeam: (team) => {
    try {
      if (team) localStorage.setItem(KEY, team);
      else localStorage.removeItem(KEY);
    } catch {
      // Storage can be unavailable (private mode); the choice still applies for this visit.
    }
    set({ team });
  },
}));
