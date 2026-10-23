import { act, render, screen } from "@testing-library/react";
import { useLive } from "../live/store";
import { ConnectionNote, GRACE_MS } from "./ConnectionNote";

describe("ConnectionNote", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useLive.setState({ connection: "idle", downSince: null, lastMessageAt: null });
  });
  afterEach(() => vi.useRealTimers());

  it("stays quiet through a normal connect", () => {
    render(<ConnectionNote />);
    act(() => useLive.getState().setConnection("connecting"));
    act(() => vi.advanceTimersByTime(1500));
    act(() => useLive.getState().setConnection("open"));
    act(() => vi.advanceTimersByTime(GRACE_MS));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("speaks up once the feed has been down past the grace period", () => {
    render(<ConnectionNote />);
    act(() => useLive.getState().setConnection("connecting"));
    act(() => useLive.getState().setConnection("retrying"));
    act(() => vi.advanceTimersByTime(GRACE_MS - 1000));
    expect(screen.queryByRole("status")).toBeNull();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("status")).toHaveTextContent("Live updates paused");
    act(() => useLive.getState().setConnection("open"));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
