import { expect, it } from "vitest";
import { seasonLabel, seasonOf } from "./season";

it("labels and assigns seasons", () => {
  expect(seasonLabel(20252026)).toBe("2025-26");
  expect(seasonLabel(20992100)).toBe("2099-00");
  expect(seasonOf("2026-04-05")).toBe(20252026);
  expect(seasonOf("2026-09-30")).toBe(20262027);
  expect(seasonOf("2025-06-17")).toBe(20242025);
});
