import {
  arrow,
  clock,
  direction,
  duration,
  longDate,
  magnitude,
  pct,
  periodLabel,
  pp,
} from "./format";

describe("pct", () => {
  it("formats with one decimal", () => {
    expect(pct(0.4567)).toBe("45.7%");
    expect(pct(1)).toBe("100.0%");
    expect(pct(0)).toBe("0.0%");
  });
  it("never rounds tiny or near-certain odds to 0 or 100", () => {
    expect(pct(0.0001)).toBe("<0.1%");
    expect(pct(0.99996)).toBe(">99.9%");
  });
});

describe("pp", () => {
  it("signs changes in percentage points", () => {
    expect(pp(0.023)).toBe("+2.3 pp");
    expect(pp(-0.009)).toBe("−0.9 pp");
    expect(pp(0.00001)).toBe("0.0 pp");
  });
  it("never uses a percent sign for changes", () => {
    expect(pp(0.1)).not.toContain("%");
  });
});

it("direction and arrows", () => {
  expect(direction(0.01)).toBe("up");
  expect(direction(-0.01)).toBe("down");
  expect(direction(0.0001)).toBe("flat");
  expect(arrow(0.01)).toBe("▲");
  expect(arrow(0)).toBe("");
});

it("clock, periods, durations, dates", () => {
  expect(clock(65)).toBe("1:05");
  expect(periodLabel(2, "REG")).toBe("2nd");
  expect(periodLabel(4, "OT")).toBe("OT");
  expect(periodLabel(6, "OT")).toBe("3OT");
  expect(periodLabel(5, "SO")).toBe("SO");
  expect(duration(3 * 3600000 + 12 * 60000)).toBe("3h 12m");
  expect(duration(45 * 60000)).toBe("45m");
  expect(magnitude(4.06)).toBe("4.1");
  expect(longDate("2026-04-11")).toBe("April 11, 2026");
});
