import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import type { GeoProjection } from "d3-geo";
import { drawBasemap, loadGeo, readPalette, type Geo, type Palette } from "./basemap";
import { layoutNodes, type NodeOut } from "./layout";
import { makeProjection, placeVenue, type Placed, type Viewport } from "./projection";
import {
  GAUGE_MS,
  LABEL_MS,
  SHAKE_MS,
  easeOut,
  ringDurationMs,
  ringRadius,
  ringSpeed,
  ringStyle,
  schedule,
  shakeOffset,
  shouldShake,
} from "./shockwave";

export interface MapTeam {
  abbrev: string;
  lat: number;
  lon: number;
  color: string;
}

export interface QuakeInput {
  id: number;
  kind: "tremor" | "reversed";
  lat: number;
  lon: number;
  magnitude: number;
  /** Change in playoff odds per team (for reversals, the original deltas). */
  deltas: Record<string, number>;
  /** Playoff odds after the goal (for reversals, the odds after the goal too). */
  after: Record<string, number>;
}

export interface NodePosition extends NodeOut {
  r: number;
}

export interface MapLayout {
  nodes: NodePosition[];
  width: number;
  height: number;
  place: (lat: number, lon: number) => Placed | null;
}

interface NodeView {
  abbrev: string;
  g: Graphics;
  shown: number;
  from: number;
  to: number;
  startedAt: number | null;
  tint: "up" | "down" | null;
  tintUntil: number;
  shimmerAt: number | null;
  highlighted: boolean;
  color: string;
  /** Odds values waiting for a ring to arrive; the store may already hold them. */
  pendingUntil: number;
}

interface Anim {
  kind: "ring" | "flash" | "label" | "text";
  start: number;
  end: number;
  update: (now: number) => boolean; // false when finished
  dispose: () => void;
}

const NODE_R = 15;

/** Imperative owner of the Pixi scene. React feeds it data and events. */
export class MapController {
  private app = new Application();
  private ready = false;
  private destroyed = false;
  private stage = new Container();
  private base = new Sprite();
  private leaders = new Graphics();
  private effects = new Container();
  private nodesLayer = new Container();
  private labels = new Container();
  private projection: GeoProjection | null = null;
  private vp: Viewport = { width: 0, height: 0, padding: 40 };
  private geo: Geo | null = null;
  private pal: Palette = readPalette();
  private teams: MapTeam[] = [];
  private nodes = new Map<string, NodeView>();
  private positions = new Map<string, NodePosition>();
  private anims: Anim[] = [];
  private shake: { start: number; magnitude: number } | null = null;
  private running = false;

  onLayout: (layout: MapLayout) => void = () => {};
  reducedMotion = false;

  private host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  async init(): Promise<void> {
    await this.app.init({
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoStart: false,
      width: Math.max(1, this.host.clientWidth),
      height: Math.max(1, this.host.clientHeight),
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    this.app.canvas.setAttribute("aria-hidden", "true");
    this.app.canvas.style.position = "absolute";
    this.app.canvas.style.inset = "0";
    this.host.prepend(this.app.canvas);
    this.stage.addChild(this.base, this.leaders, this.nodesLayer, this.effects, this.labels);
    this.app.stage.addChild(this.stage);
    this.app.ticker.add(() => this.tick());
    this.geo = await loadGeo();
    this.ready = true;
    this.resize();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.ready) this.app.destroy(true, { children: true, texture: true });
  }

  setTeams(teams: MapTeam[]): void {
    this.teams = teams;
    this.layout();
  }

  setTheme(): void {
    this.pal = readPalette();
    this.drawBase();
    this.redrawNodes();
    this.render();
  }

  resize(): void {
    if (!this.ready) return;
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (width < 10 || height < 10) return;
    this.app.renderer.resize(width, height);
    this.vp = { width, height, padding: Math.max(24, Math.min(width, height) * 0.06) };
    this.projection = makeProjection(this.vp);
    this.drawBase();
    this.layout();
  }

  /** Current screen position of a lat/lon (edge chip for off-map venues). */
  place(lat: number, lon: number) {
    if (!this.projection) return null;
    return placeVenue(this.projection, lon, lat, this.vp);
  }

  private drawBase(): void {
    if (!this.geo || !this.projection) return;
    const canvas = drawBasemap(
      this.geo,
      this.projection,
      this.vp.width,
      this.vp.height,
      this.app.renderer.resolution,
      this.pal,
    );
    const old = this.base.texture;
    this.base.texture = Texture.from(canvas);
    this.base.width = this.vp.width;
    this.base.height = this.vp.height;
    if (old && old !== Texture.EMPTY) old.destroy(true);
  }

  private layout(): void {
    if (!this.projection || !this.teams.length) return;
    const r = this.vp.width < 640 ? 11 : NODE_R;
    const inputs = this.teams.map((t) => {
      const pos = placeVenue(this.projection!, t.lon, t.lat, this.vp);
      return { id: t.abbrev, x: pos.x, y: pos.y };
    });
    const out = layoutNodes(inputs, r + 2.5);
    this.positions.clear();
    for (const n of out) this.positions.set(n.id, { ...n, r });
    for (const t of this.teams) {
      if (!this.nodes.has(t.abbrev)) {
        const g = new Graphics();
        this.nodesLayer.addChild(g);
        this.nodes.set(t.abbrev, {
          abbrev: t.abbrev,
          g,
          shown: 0,
          from: 0,
          to: 0,
          startedAt: null,
          tint: null,
          tintUntil: 0,
          shimmerAt: null,
          highlighted: false,
          color: t.color,
          pendingUntil: 0,
        });
      }
    }
    this.leaders.clear();
    for (const n of out) {
      if (!n.displaced) continue;
      this.leaders
        .moveTo(n.x0, n.y0)
        .lineTo(n.x, n.y)
        .stroke({ width: 1, color: this.pal.inkSoft, alpha: 0.5 });
      this.leaders.circle(n.x0, n.y0, 1.6).fill({ color: this.pal.inkSoft, alpha: 0.7 });
    }
    this.redrawNodes();
    const projection = this.projection;
    const vp = { ...this.vp };
    this.onLayout({
      nodes: [...this.positions.values()],
      width: vp.width,
      height: vp.height,
      place: (lat, lon) => placeVenue(projection, lon, lat, vp),
    });
    this.render();
  }

  /** Sync displayed odds with the store, except where a ring is on its way. */
  setOdds(odds: Record<string, number>): void {
    const now = performance.now();
    for (const [team, p] of Object.entries(odds)) {
      const n = this.nodes.get(team);
      if (!n || now < n.pendingUntil) continue;
      if (n.startedAt === null && Math.abs(n.shown - p) > 1e-9) {
        n.shown = p;
        n.from = p;
        n.to = p;
      }
    }
    this.redrawNodes();
    this.render();
  }

  setHighlight(team: string | null): void {
    for (const n of this.nodes.values()) n.highlighted = n.abbrev === team;
    this.redrawNodes();
    this.render();
  }

  /** Start a shockwave (or its reversal). */
  quake(q: QuakeInput): void {
    const pos = this.place(q.lat, q.lon);
    if (!pos) return;
    const now = performance.now();
    const targets = [...this.positions.values()].map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      delta: q.kind === "tremor" ? (q.deltas[p.id] ?? 0) : -(q.deltas[p.id] ?? 0),
    }));

    if (this.reducedMotion) {
      for (const t of targets) {
        const n = this.nodes.get(t.id);
        if (!n) continue;
        const target =
          q.kind === "tremor"
            ? (q.after[t.id] ?? n.shown)
            : (q.after[t.id] ?? n.shown) - (q.deltas[t.id] ?? 0);
        n.shown = n.from = n.to = target;
        n.startedAt = null;
        if (Math.abs(t.delta) >= 0.001) {
          n.tint = t.delta > 0 ? "up" : "down";
          n.tintUntil = now + 1000;
        }
      }
      this.redrawNodes();
      this.startTicker();
      return;
    }

    const speed = ringSpeed(this.vp.width, this.vp.height);
    const maxR =
      Math.max(
        ...[...this.positions.values()].map((p) => Math.hypot(p.x - pos.x, p.y - pos.y)),
        Math.hypot(this.vp.width, this.vp.height) * 0.5,
      ) + 40;
    const reverse = q.kind === "reversed";
    const arrivals = schedule(pos, targets, speed, reverse);
    const style = ringStyle(q.magnitude);

    for (const a of arrivals) {
      const n = this.nodes.get(a.id);
      if (!n) continue;
      const at = now + a.atMs;
      n.pendingUntil = Math.max(n.pendingUntil, at + GAUGE_MS);
      const target = q.kind === "tremor" ? (q.after[a.id] ?? n.shown + a.delta) : n.shown + a.delta;
      this.anims.push({
        kind: "label",
        start: at,
        end: at + 1,
        update: (t) => {
          if (t < at) return true;
          if (a.kind === "shimmer") {
            n.shimmerAt = t;
          } else {
            n.from = n.shown;
            n.to = Math.max(0, Math.min(1, target));
            n.startedAt = t;
            n.tint = a.delta > 0 ? "up" : "down";
            n.tintUntil = t + GAUGE_MS + 900;
            this.popLabel(a.id, a.delta, t);
          }
          return false;
        },
        dispose: () => {},
      });
    }

    // Goal-lamp flash at the origin.
    const flash = new Graphics();
    this.effects.addChild(flash);
    const flashEnd = now + 700;
    this.anims.push({
      kind: "flash",
      start: now,
      end: flashEnd,
      update: (t) => {
        const k = (t - now) / 700;
        if (k >= 1) return false;
        flash.clear();
        const r = 6 + easeOut(k) * (10 + q.magnitude * 3);
        if (this.pal.glow)
          flash.circle(pos.x, pos.y, r * 1.8).fill({ color: this.pal.goal, alpha: 0.18 * (1 - k) });
        flash.circle(pos.x, pos.y, r).fill({ color: this.pal.goal, alpha: 0.85 * (1 - k) });
        return true;
      },
      dispose: () => flash.destroy(),
    });

    // Rings.
    const dur = ringDurationMs(maxR, speed);
    for (let i = 0; i < style.rings; i++) {
      const ring = new Graphics();
      this.effects.addChild(ring);
      const start = now + i * 170;
      this.anims.push({
        kind: "ring",
        start,
        end: start + dur,
        update: (t) => {
          if (t < start) return true;
          const el = t - start;
          if (el >= dur) return false;
          const r = ringRadius(el, speed, maxR, reverse);
          const life = el / dur;
          const alpha = style.alpha * (1 - life) * (i === 0 ? 1 : 0.55);
          ring.clear();
          if (r > 0.5) {
            if (this.pal.glow) {
              ring
                .circle(pos.x, pos.y, r)
                .stroke({ width: style.width * 3, color: this.pal.goal, alpha: alpha * 0.25 });
            }
            ring
              .circle(pos.x, pos.y, r)
              .stroke({ width: style.width * (i === 0 ? 1 : 0.6), color: this.pal.goal, alpha });
          }
          return true;
        },
        dispose: () => ring.destroy(),
      });
    }

    // Magnitude at the origin, or "No goal" when reversed.
    this.floatText(
      pos.x,
      pos.y - 22,
      reverse ? "No goal" : `M ${q.magnitude.toFixed(1)}`,
      reverse ? this.pal.ink : this.pal.goal,
      reverse ? 15 : 22,
      now + (reverse ? dur : 0),
      2600,
    );

    if (shouldShake(q.magnitude, this.reducedMotion))
      this.shake = { start: now, magnitude: q.magnitude };
    this.startTicker();
  }

  private popLabel(team: string, delta: number, at: number): void {
    const p = this.positions.get(team);
    if (!p) return;
    const v = delta * 100;
    const text = `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;
    this.floatText(
      p.x,
      p.y - p.r - 8,
      text,
      delta > 0 ? this.pal.blue : this.pal.goal,
      14,
      at,
      LABEL_MS,
      14,
    );
  }

  private floatText(
    x: number,
    y: number,
    text: string,
    color: string,
    size: number,
    start: number,
    life: number,
    rise = 6,
  ): void {
    const label = new Text({
      text,
      style: {
        fontFamily: "Big Shoulders Display, Arial Narrow, sans-serif",
        fontWeight: "800",
        fontSize: size,
        fill: color,
        stroke: { color: this.pal.ice, width: 3 },
      },
      resolution: Math.min(window.devicePixelRatio || 1, 2) * 1.5,
    });
    label.anchor.set(0.5, 1);
    label.position.set(x, y);
    label.alpha = 0;
    this.labels.addChild(label);
    this.anims.push({
      kind: "text",
      start,
      end: start + life,
      update: (t) => {
        if (t < start) return true;
        const k = (t - start) / life;
        if (k >= 1) return false;
        label.alpha = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.55) / 0.45);
        label.y = y - easeOut(k) * rise;
        return true;
      },
      dispose: () => label.destroy(),
    });
  }

  private startTicker(): void {
    if (this.running || !this.ready) return;
    this.running = true;
    this.app.ticker.start();
  }

  private tick(): void {
    const now = performance.now();
    this.anims = this.anims.filter((a) => {
      const keep = a.update(now);
      if (!keep) a.dispose();
      return keep;
    });
    let nodesBusy = false;
    for (const n of this.nodes.values()) {
      if (n.startedAt !== null) {
        const k = (now - n.startedAt) / GAUGE_MS;
        n.shown = n.from + (n.to - n.from) * easeOut(k);
        if (k >= 1) {
          n.shown = n.to;
          n.startedAt = null;
        }
        nodesBusy = true;
      }
      if (n.tint && now > n.tintUntil) n.tint = null;
      if (n.tint || (n.shimmerAt !== null && now - n.shimmerAt < 500)) nodesBusy = true;
      else n.shimmerAt = null;
    }
    if (this.shake) {
      const el = now - this.shake.start;
      const o = shakeOffset(el, this.shake.magnitude);
      this.stage.position.set(o.x, o.y);
      if (el >= SHAKE_MS) {
        this.shake = null;
        this.stage.position.set(0, 0);
      }
    }
    this.redrawNodes();
    this.app.render();
    if (!this.anims.length && !nodesBusy && !this.shake) {
      this.running = false;
      this.app.ticker.stop();
    }
  }

  private render(): void {
    if (this.ready && !this.running) this.app.render();
  }

  private redrawNodes(): void {
    const now = performance.now();
    for (const n of this.nodes.values()) {
      const p = this.positions.get(n.abbrev);
      if (!p) continue;
      const g = n.g;
      g.clear();
      const r = p.r;
      const shimmer = n.shimmerAt !== null ? Math.max(0, 1 - (now - n.shimmerAt) / 500) : 0;
      g.circle(p.x, p.y, r + 3).fill({ color: this.pal.ice, alpha: 0.92 });
      if (n.highlighted)
        g.circle(p.x, p.y, r + 6).stroke({ width: 2, color: this.pal.blue, alpha: 0.9 });
      g.circle(p.x, p.y, r).stroke({ width: 3, color: this.pal.scratch, alpha: 1 });
      if (shimmer > 0)
        g.circle(p.x, p.y, r).stroke({ width: 3, color: this.pal.inkSoft, alpha: shimmer * 0.6 });
      const sweep = Math.max(0, Math.min(1, n.shown)) * Math.PI * 2;
      if (sweep > 0.001) {
        const color =
          n.tint === "up" ? this.pal.blue : n.tint === "down" ? this.pal.goal : this.pal.ink;
        g.arc(p.x, p.y, r, -Math.PI / 2, -Math.PI / 2 + sweep).stroke({
          width: 3,
          color,
          cap: "butt",
        });
      }
      // Team color tick under the node.
      g.moveTo(p.x - 4, p.y + r + 5)
        .lineTo(p.x + 4, p.y + r + 5)
        .stroke({ width: 3, color: n.color });
    }
  }
}
