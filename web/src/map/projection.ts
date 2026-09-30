import { geoConicConformal, type GeoProjection } from "d3-geo";

/** Rough frame that must stay visible: Vancouver/Edmonton to Florida/Boston. */
export const FRAME: GeoJSON.Feature<GeoJSON.MultiPoint> = {
  type: "Feature",
  properties: {},
  geometry: {
    type: "MultiPoint",
    coordinates: [
      [-125.5, 49.5],
      [-114, 54.5],
      [-66.5, 46],
      [-80.5, 24.8],
      [-118, 32],
      [-97, 25.5],
    ],
  },
};

export interface Viewport {
  width: number;
  height: number;
  padding: number;
}

/** Conic conformal projection centered on North America, fit to the viewport. */
export function makeProjection(vp: Viewport): GeoProjection {
  const p = geoConicConformal().parallels([30, 55]).rotate([96, 0]).center([0, 40]);
  const pad = vp.padding;
  p.fitExtent(
    [
      [pad, pad],
      [Math.max(pad + 1, vp.width - pad), Math.max(pad + 1, vp.height - pad)],
    ],
    FRAME,
  );
  return p;
}

export interface Placed {
  x: number;
  y: number;
  /** True when the venue is outside the map (for example Europe). */
  offMap: boolean;
  /** The edge the chip sits on when off map. */
  edge?: "east" | "west";
}

/**
 * Screen position of a venue. Venues east of -50 or west of -170 (Europe,
 * Asia) sit on the map edge as a chip, at a height that follows latitude.
 */
export function placeVenue(p: GeoProjection, lon: number, lat: number, vp: Viewport): Placed {
  if (lon > -50 || lon < -170) {
    const edge = lon > -50 ? "east" : "west";
    const clampedLat = Math.max(30, Math.min(55, lat));
    const y =
      vp.padding + ((55 - clampedLat) / 25) * (vp.height - 2 * vp.padding) * 0.6 + vp.height * 0.15;
    const x = edge === "east" ? vp.width - vp.padding * 0.6 : vp.padding * 0.6;
    return { x, y, offMap: true, edge };
  }
  const xy = p([lon, lat]);
  if (!xy) return { x: vp.width / 2, y: vp.height / 2, offMap: true };
  return { x: xy[0], y: xy[1], offMap: false };
}
