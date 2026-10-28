import { describe, expect, it } from "vitest";
import { encodeMoves, headline, outLabel, parseMoves, withMove } from "./moves";

describe("moves", () => {
  it("encodes canonically, the way the server does", () => {
    expect(encodeMoves(parseMoves("t5-MTL_i9-4"))).toBe("i9-4_t5-MTL");
    expect(encodeMoves(parseMoves("i9-4_t5-MTL"))).toBe("i9-4_t5-MTL");
  });

  it("reads every kind of move and drops what it cannot read", () => {
    expect(parseMoves("i9-0_s7-TOR_t5-MTL_x1-TOR_i3-3")).toEqual([
      { kind: "i", id: 9, weeks: null },
      { kind: "s", id: 7, to: "TOR" },
      { kind: "t", id: 5, to: "MTL" },
    ]);
    expect(parseMoves(null)).toEqual([]);
  });

  it("keeps one move per player", () => {
    const moves = withMove(parseMoves("t5-MTL"), { kind: "i", id: 5, weeks: 2 });
    expect(encodeMoves(moves)).toBe("i5-2");
    expect(withMove(moves, { kind: "none", id: 5 })).toEqual([]);
  });

  it("words the moves like the server's headline", () => {
    expect(
      headline([
        { name: "Matthew Knies", move: "trade", to_team: "VAN", weeks: null },
        { name: "Quinn Hughes", move: "trade", to_team: "TOR", weeks: null },
        { name: "Auston Matthews", move: "injury", to_team: null, weeks: 4 },
        { name: "Elias Pettersson", move: "injury", to_team: null, weeks: null },
      ]),
    ).toBe(
      "VAN gets Matthew Knies, TOR gets Quinn Hughes, Auston Matthews out 4 weeks, Elias Pettersson out for the season",
    );
  });

  it("names injury lengths", () => {
    expect(outLabel(1)).toBe("Out 1 week");
    expect(outLabel(6)).toBe("Out 6 weeks");
    expect(outLabel(null)).toBe("Out for the season");
  });
});
