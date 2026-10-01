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

it("uses the configured live socket when the api is on another host", () => {
  const loc = { protocol: "https:", host: "aftershock.vercel.app" } as Location;
  expect(socketUrl(0, loc, "wss://api.example/ws/live")).toBe("wss://api.example/ws/live");
  expect(socketUrl(42, loc, "wss://api.example/ws/live")).toBe(
    "wss://api.example/ws/live?since=42",
  );
  expect(socketUrl(0, loc, undefined)).toBe("wss://aftershock.vercel.app/ws/live");
});
