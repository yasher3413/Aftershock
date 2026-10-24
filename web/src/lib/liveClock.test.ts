import { expect, test } from "vitest";
import { liveClock } from "./format";

test("a live clock reads like a broadcast", () => {
  expect(liveClock({ period: 1, period_type: "REG", clock_seconds: 754 })).toBe("1st 12:34");
  expect(
    liveClock({ period: 1, period_type: "REG", clock_seconds: 0, in_intermission: true }),
  ).toBe("End 1st");
  // The feed shows the next period at its full clock before puck drop.
  expect(liveClock({ period: 2, period_type: "REG", clock_seconds: 1200 })).toBe("Start of 2nd");
  expect(liveClock({ period: 4, period_type: "OT", clock_seconds: 300 })).toBe("Start of OT");
  // Opening faceoff of the game is just the clock.
  expect(liveClock({ period: 1, period_type: "REG", clock_seconds: 1200 })).toBe("1st 20:00");
  expect(liveClock({ period: 5, period_type: "SO", clock_seconds: 0 })).toBe("Shootout");
});
