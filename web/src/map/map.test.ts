import { layoutNodes } from "./layout";
import { makeProjection, placeVenue } from "./projection";
import {
  CROSSING_S,
  easeOut,
  freeSlot,
  ringRadius,
  ringSpeed,
  ringStyle,
  schedule,
  shakeOffset,
  shouldShake,
} from "./shockwave";

const vp = { width: 1200, height: 760, padding: 40 };

describe("projection", () => {
  const p = makeProjection(vp);
  it("keeps every arena corner of the league on screen", () => {
    for (const [lon, lat] of [
      [-123.109, 49.278], // Vancouver
      [-113.498, 53.547], // Edmonton
      [-80.326, 26.158], // Sunrise
      [-71.062, 42.366], // Boston
    ] as const) {
      const pos = placeVenue(p, lon, lat, vp);
      expect(pos.offMap).toBe(false);
      expect(pos.x).toBeGreaterThan(0);
      expect(pos.x).toBeLessThan(vp.width);
      expect(pos.y).toBeGreaterThan(0);
      expect(pos.y).toBeLessThan(vp.height);
    }
  });
  it("puts European venues on the eastern edge", () => {
    const helsinki = placeVenue(p, 24.93, 60.2, vp);
    expect(helsinki.offMap).toBe(true);
    expect(helsinki.edge).toBe("east");
    expect(helsinki.x).toBeGreaterThan(vp.width - vp.padding);
  });
  it("puts Vancouver west of Boston and Florida south of Toronto", () => {
    const van = placeVenue(p, -123.1, 49.28, vp);
    const bos = placeVenue(p, -71.06, 42.37, vp);
    const fla = placeVenue(p, -80.33, 26.16, vp);
    const tor = placeVenue(p, -79.38, 43.64, vp);
    expect(van.x).toBeLessThan(bos.x);
    expect(fla.y).toBeGreaterThan(tor.y);
  });
});

describe("layout", () => {
  it("separates overlapping nodes and flags displaced ones", () => {
    const nodes = layoutNodes(
      [
        { id: "NYR", x: 500, y: 300 },
        { id: "NYI", x: 503, y: 300 },
        { id: "NJD", x: 498, y: 302 },
        { id: "SEA", x: 100, y: 100 },
      ],
      14,
    );
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    for (const a of ["NYR", "NYI", "NJD"]) {
      for (const b of ["NYR", "NYI", "NJD"]) {
        if (a === b) continue;
        const d = Math.hypot(byId[a]!.x - byId[b]!.x, byId[a]!.y - byId[b]!.y);
        expect(d).toBeGreaterThan(2 * 14 * 0.9);
      }
    }
    expect(byId.SEA!.displaced).toBe(false);
    expect(Math.hypot(byId.SEA!.x - 100, byId.SEA!.y - 100)).toBeLessThan(1);
  });
  it("is deterministic", () => {
    const input = [
      { id: "LAK", x: 200, y: 400 },
      { id: "ANA", x: 204, y: 405 },
    ];
    expect(layoutNodes(input, 14)).toEqual(layoutNodes(input, 14));
  });
});

describe("shockwave schedule", () => {
  const speed = ringSpeed(1200, 760);
  it("crosses the viewport diagonal in the target time", () => {
    expect(Math.hypot(1200, 760) / speed).toBeCloseTo(CROSSING_S);
  });
  it("orders arrivals by distance and marks tiny deltas as shimmer", () => {
    const arr = schedule(
      { x: 0, y: 0 },
      [
        { id: "far", x: 600, y: 0, delta: 0.02 },
        { id: "near", x: 100, y: 0, delta: -0.0004 },
      ],
      speed,
    );
    expect(arr.map((a) => a.id)).toEqual(["near", "far"]);
    expect(arr[0]!.kind).toBe("shimmer");
    expect(arr[1]!.kind).toBe("gauge");
    expect(arr[1]!.atMs).toBeCloseTo((600 / speed) * 1000);
  });
  it("reverses: the farthest node is reached first", () => {
    const arr = schedule(
      { x: 0, y: 0 },
      [
        { id: "far", x: 600, y: 0, delta: 0.02 },
        { id: "near", x: 100, y: 0, delta: 0.02 },
      ],
      speed,
      true,
    );
    expect(arr[0]!.id).toBe("far");
    expect(arr[0]!.atMs).toBe(0);
  });
  it("ring radius grows then clamps, or contracts on reversal", () => {
    expect(ringRadius(0, speed, 500)).toBe(0);
    expect(ringRadius(100000, speed, 500)).toBe(500);
    expect(ringRadius(0, speed, 500, true)).toBe(500);
    expect(ringRadius(100000, speed, 500, true)).toBe(0);
  });
  it("styles and shake scale with magnitude", () => {
    expect(ringStyle(8).width).toBeGreaterThan(ringStyle(2).width);
    expect(ringStyle(8).rings).toBe(3);
    expect(shouldShake(6.2, false)).toBe(true);
    expect(shouldShake(6.2, true)).toBe(false);
    expect(shouldShake(5.9, false)).toBe(false);
    expect(shakeOffset(300, 7)).toEqual({ x: 0, y: 0 });
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0)).toBe(0);
  });
  it("keeps even a small goal's ring clearly visible", () => {
    expect(ringStyle(1).alpha).toBeGreaterThanOrEqual(0.6);
    expect(ringStyle(10).alpha).toBeLessThanOrEqual(0.95);
  });
});

describe("label placement", () => {
  const box = { x0: 100, x1: 140, y0: 50, y1: 64, from: 0, to: 1000 };
  it("moves a label that would sit on another one showing at the same time", () => {
    const here = { x0: 110, x1: 150, y0: 55, y1: 69 };
    const above = { x0: 110, x1: 150, y0: 35, y1: 49 };
    expect(freeSlot([box], [here, above], 200, 900)).toBe(1);
  });
  it("ignores labels that have already faded", () => {
    expect(freeSlot([box], [{ x0: 110, x1: 150, y0: 55, y1: 69 }], 1000, 1500)).toBe(0);
  });
  it("skips a label with nowhere free to go", () => {
    expect(freeSlot([box], [{ x0: 100, x1: 140, y0: 50, y1: 64 }], 0, 500)).toBe(-1);
  });
});
