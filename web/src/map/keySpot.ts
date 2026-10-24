/** A team node on the map, in map pixels. */
export interface KeyNode {
  x: number;
  y: number;
  r: number;
}

const INSET = 12;
// A node's footprint: the ring and the team tick below it.
const footprint = (n: KeyNode) => ({
  left: n.x - n.r - 4,
  right: n.x + n.r + 4,
  top: n.y - n.r - 4,
  bottom: n.y + n.r + 10,
});

/**
 * Where a w by h key covers no team: the bottom left corner if it can,
 * then along the bottom edge, then along the top edge, nearest the left
 * first. Null when every spot would cover a team.
 */
export function freeSpot(
  w: number,
  h: number,
  mapW: number,
  mapH: number,
  nodes: KeyNode[],
): { left: number; top: number } | null {
  const boxes = nodes.map(footprint);
  const clear = (left: number, top: number) =>
    boxes.every(
      (b) => b.left >= left + w || b.right <= left || b.top >= top + h || b.bottom <= top,
    );
  const maxLeft = mapW - INSET - w;
  if (maxLeft < INSET) return null;
  for (const top of [mapH - INSET - h, INSET]) {
    for (let left = INSET; left <= maxLeft; left += 8) if (clear(left, top)) return { left, top };
    if (clear(maxLeft, top)) return { left: maxLeft, top };
  }
  return null;
}
