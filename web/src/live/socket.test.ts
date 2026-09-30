import { backoff, socketUrl } from "./socket";

it("builds the socket url with since", () => {
  const loc = { protocol: "https:", host: "aftershock.example" } as Location;
  expect(socketUrl(0, loc)).toBe("wss://aftershock.example/ws/live");
  expect(socketUrl(42, loc)).toBe("wss://aftershock.example/ws/live?since=42");
});

it("backs off up to 30 seconds with jitter", () => {
  expect(backoff(0)).toBeGreaterThanOrEqual(750);
  expect(backoff(0)).toBeLessThanOrEqual(1250);
  expect(backoff(99)).toBeLessThanOrEqual(37500);
});
