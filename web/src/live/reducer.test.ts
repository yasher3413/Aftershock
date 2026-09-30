import type { Tremor } from "../api/types.gen";
import type { LiveMessage } from "./messages";
import { applyMessage, emptyLiveData } from "./reducer";

const ts = "2026-09-30T23:00:00Z";

function tremor(id: number): Tremor {
  const six = { home_reg: 1, home_ot: 0, home_so: 0, away_reg: 0, away_ot: 0, away_so: 0 };
  return {
    id,
    season: 20262027,
    game_id: 1,
    event_id: id,
    night_date: "2026-09-30",
    team: "TOR",
    opponent: "NYI",
    home: "TOR",
    away: "NYI",
    scorer: null,
    assists: [],
    goalie: null,
    period: 1,
    period_type: "REG",
    t_period_s: 100,
    t_game_s: 100,
    shootout: false,
    score_before: { home: 0, away: 0 },
    score_after: { home: 1, away: 0 },
    wp_before: six,
    wp_after: six,
    deltas: [{ team: "TOR", d_playoffs: 0.01, d_division: 0, d_cup: 0, p_playoffs_after: 0.5 }],
    total_shift: 0.02,
    magnitude: 2.1,
    ppa: 0.01,
    cpa: 0.001,
    origin: { venue: "Scotiabank Arena", lat: 43.6, lon: -79.4, off_map: false, label: null },
    overturned: false,
    created_at: ts,
  };
}

it("adds tremors newest first and queues a quake", () => {
  let s = applyMessage(emptyLiveData, { type: "tremor", seq: 1, ts, tremor: tremor(1) });
  s = applyMessage(s, { type: "tremor", seq: 2, ts, tremor: tremor(2) });
  expect(s.tremors.map((t) => t.id)).toEqual([2, 1]);
  expect(s.quakes.map((q) => q.kind)).toEqual(["tremor", "tremor"]);
  expect(s.lastSeq).toBe(2);
});

it("ignores duplicate or stale sequence numbers", () => {
  const s = applyMessage(emptyLiveData, { type: "tremor", seq: 5, ts, tremor: tremor(1) });
  const again = applyMessage(s, { type: "tremor", seq: 5, ts, tremor: tremor(9) });
  expect(again).toBe(s);
});

it("marks reversals and queues a reverse quake", () => {
  let s = applyMessage(emptyLiveData, { type: "tremor", seq: 1, ts, tremor: tremor(7) });
  const msg: LiveMessage = {
    type: "tremor_reversed",
    seq: 2,
    ts,
    tremor_id: 7,
    game_id: 1,
    origin: tremor(7).origin,
    deltas: [],
  };
  s = applyMessage(s, msg);
  expect(s.tremors[0]!.overturned).toBe(true);
  expect(s.quakes.at(-1)!.kind).toBe("reversed");
});

it("merges odds and applies tremor corrections", () => {
  let s = applyMessage(emptyLiveData, { type: "tremor", seq: 1, ts, tremor: tremor(3) });
  s = applyMessage(s, {
    type: "tremor_updated",
    seq: 2,
    ts,
    tremor_id: 3,
    changes: { scorer: { id: 9, name: "Corrected Scorer" } },
  });
  expect(s.tremors[0]!.scorer?.name).toBe("Corrected Scorer");
  const odds = {
    team: "TOR",
    p_playoffs: 0.6,
    p_division: 0.2,
    p_top3_div: 0.5,
    p_wildcard: 0.1,
    p_presidents: 0.05,
    p_conf_first: 0.1,
    p_round2: 0.3,
    p_conf_final: 0.15,
    p_final: 0.07,
    p_cup: 0.03,
    p_last: 0.01,
    p_bottom3: 0.03,
    exp_points: 95,
  };
  s = applyMessage(s, {
    type: "odds_update",
    seq: 3,
    ts,
    sim_run_id: 44,
    trigger: "goal",
    odds: [odds],
  });
  expect(s.odds.TOR!.p_playoffs).toBe(0.6);
  expect(s.simRunId).toBe(44);
});
