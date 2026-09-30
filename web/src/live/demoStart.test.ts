import { expect, it } from "vitest";
import { demoStart } from "./bootstrap";

const tremor = (t: number, magnitude: number) => ({
  t,
  message: { type: "tremor", tremor: { magnitude } },
});

it("opens a few seconds before the first goal of magnitude 4 or more", () => {
  const frames = [
    { t: 0, message: { type: "game_update" } },
    tremor(600_000, 2.1),
    tremor(900_000, 5.3),
  ];
  // 3 s of wall time at 20x is 60 s of replay.
  expect(demoStart(frames, 20)).toBe(840_000);
});

it("falls back to the first goal, and to the start with no goals", () => {
  expect(demoStart([tremor(100_000, 1.0)], 60)).toBe(0);
  expect(demoStart([tremor(400_000, 1.0)], 20)).toBe(340_000);
  expect(demoStart([{ t: 5, message: { type: "odds_update" } }], 20)).toBe(0);
});
