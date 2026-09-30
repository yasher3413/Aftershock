import { useCallback, useEffect, useState } from "react";

/**
 * Width of an element, kept current with a ResizeObserver. Returns a
 * callback ref, so it works for elements that mount later (after loading).
 */
export function useWidth<T extends HTMLElement>(initial = 600): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(initial);
  const ref = useCallback((node: T | null) => setEl(node), []);
  useEffect(() => {
    if (!el) return;
    // The observer reports the current size as soon as it starts observing.
    const ro = new ResizeObserver(([entry]) =>
      setW(Math.floor(entry?.contentRect.width ?? el.clientWidth)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [ref, w];
}
