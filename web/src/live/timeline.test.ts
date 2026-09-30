import type { Frame } from "./timeline";
import { TimelinePlayer } from "./timeline";

const ts = "2026-09-30T23:00:00Z";
const frames: Frame[] = [100, 2000, 5000, 9000].map((t, i) => ({
  t,
  message: { type: "heartbeat", seq: i + 1, ts },
}));

function setup(loop = false) {
  const seen: number[] = [];
  let resets = 0;
  const player = new TimelinePlayer({
    frames,
    durationMs: 10000,
    speed: 10,
    loop,
    onFrames: (fs) => seen.push(...fs.map((f) => f.t)),
    onReset: () => {
      resets++;
      seen.length = 0;
    },
  });
  return { player, seen, resets: () => resets };
}

it("emits frames as the virtual clock passes them", () => {
  const { player, seen } = setup();
  player.advance(50); // 500 ms of night time at 10x
  expect(seen).toEqual([100]);
  player.advance(200);
  expect(seen).toEqual([100, 2000]);
});

it("seeking backwards resets and replays up to the target", () => {
  const { player, seen, resets } = setup();
  player.advance(600);
  expect(seen).toEqual([100, 2000, 5000]);
  player.seek(2500);
  expect(resets()).toBe(1);
  expect(seen).toEqual([100, 2000]);
});

it("stops at the end or loops", () => {
  const a = setup(false);
  a.player.advance(5000);
  expect(a.player.t).toBe(10000);
  expect(a.seen).toEqual([100, 2000, 5000, 9000]);
  const b = setup(true);
  b.player.advance(5000);
  expect(b.player.t).toBe(0);
  expect(b.resets()).toBe(1);
});
