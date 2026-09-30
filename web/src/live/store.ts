import { create } from "zustand";
import type { StateResponse } from "../api/types.gen";
import type { LiveMessage } from "./messages";
import { applyMessage, emptyLiveData, fromState, type LiveData } from "./reducer";

export type Connection = "idle" | "connecting" | "open" | "retrying";

interface LiveStore extends LiveData {
  connection: Connection;
  loaded: boolean;
  bootstrap: (s: StateResponse) => void;
  apply: (msg: LiveMessage) => void;
  applyMany: (msgs: LiveMessage[]) => void;
  reset: (data: LiveData) => void;
  setConnection: (c: Connection) => void;
  consumeQuakes: (upToSeq: number) => void;
}

export const useLive = create<LiveStore>((set) => ({
  ...emptyLiveData,
  connection: "idle",
  loaded: false,
  bootstrap: (s) => set({ ...fromState(s), loaded: true }),
  apply: (msg) => set((st) => applyMessage(st, msg)),
  applyMany: (msgs) =>
    set((st) => {
      let next: LiveData = st;
      for (const m of msgs) next = applyMessage(next, m);
      return next;
    }),
  reset: (data) => set({ ...data, loaded: true }),
  setConnection: (connection) => set({ connection }),
  consumeQuakes: (upToSeq) => set((st) => ({ quakes: st.quakes.filter((q) => q.seq > upToSeq) })),
}));
