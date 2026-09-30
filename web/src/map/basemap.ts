import { geoPath, type GeoProjection } from "d3-geo";
import { feature, mesh } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";

export interface Palette {
  ice: string;
  land: string;
  scratch: string;
  ink: string;
  inkSoft: string;
  goal: string;
  blue: string;
  glow: boolean;
}

export function readPalette(el: Element = document.documentElement): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    ice: v("--ice", "#eef3f6"),
    land: v("--ice-land", "#dde7ed"),
    scratch: v("--ice-scratch", "#c9d6df"),
    ink: v("--ink", "#14212b"),
    inkSoft: v("--ink-soft", "#5d707e"),
    goal: v("--goal", "#c8102e"),
    blue: v("--blue-line", "#0b4fa8"),
    glow: v("--glow", "0") === "1",
  };
}

export interface Geo {
  land: GeoJSON.FeatureCollection;
  borders: GeoJSON.MultiLineString;
  lakes: GeoJSON.FeatureCollection;
}

let geoPromise: Promise<Geo> | null = null;

export function loadGeo(url = "/geo/north-america.topo.json"): Promise<Geo> {
  geoPromise ??= fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`basemap ${r.status}`);
      return r.json() as Promise<Topology>;
    })
    .then((topo) => {
      const obj = topo.objects as Record<string, GeometryCollection>;
      return {
        land: feature(topo, obj.land!) as unknown as GeoJSON.FeatureCollection,
        borders: mesh(topo, obj.borders!) as GeoJSON.MultiLineString,
        lakes: feature(topo, obj.lakes!) as unknown as GeoJSON.FeatureCollection,
      };
    });
  return geoPromise;
}

/** Small deterministic PRNG for the ice texture, so redraws do not flicker. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw the continent as a sheet of ice: pale land, hairline borders, and
 * faint skate scratches clipped to the land. Returns a canvas at device
 * resolution, used as a Pixi texture.
 */
export function drawBasemap(
  geo: Geo,
  projection: GeoProjection,
  width: number,
  height: number,
  dpr: number,
  pal: Palette,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);
  const path = geoPath(projection, ctx);

  // Arena lights: a soft pool of light over the middle of the continent.
  const light = ctx.createRadialGradient(
    width * 0.55,
    height * 0.45,
    0,
    width * 0.55,
    height * 0.45,
    Math.max(width, height) * 0.75,
  );
  light.addColorStop(0, pal.glow ? "rgba(90,162,255,0.06)" : "rgba(255,255,255,0.55)");
  light.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, width, height);

  ctx.beginPath();
  path(geo.land);
  ctx.fillStyle = pal.land;
  ctx.fill();

  // Skate scratches, clipped to land.
  ctx.save();
  ctx.beginPath();
  path(geo.land);
  ctx.clip();
  const rand = mulberry32(19);
  ctx.strokeStyle = pal.glow ? "rgba(227,235,240,0.035)" : "rgba(255,255,255,0.55)";
  ctx.lineWidth = 0.8;
  const n = Math.round((width * height) / 3500);
  for (let i = 0; i < n; i++) {
    const x = rand() * width;
    const y = rand() * height;
    const len = 20 + rand() * 90;
    const ang = -0.35 + rand() * 0.7;
    const bend = (rand() - 0.5) * 30;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(ang) * len * 0.5,
      y + Math.sin(ang) * len * 0.5 + bend,
      x + Math.cos(ang) * len,
      y + Math.sin(ang) * len,
    );
    ctx.stroke();
  }
  ctx.restore();

  ctx.beginPath();
  path(geo.lakes);
  ctx.fillStyle = pal.ice;
  ctx.fill();

  ctx.beginPath();
  path(geo.borders);
  ctx.strokeStyle = pal.scratch;
  ctx.lineWidth = 0.7;
  ctx.stroke();

  ctx.beginPath();
  path(geo.land);
  ctx.strokeStyle = pal.scratch;
  ctx.lineWidth = 1.1;
  ctx.stroke();
  return canvas;
}
