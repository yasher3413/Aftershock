// Composites one frame: the 3D world, then the 2D layer, averaged over
// jittered subframes for motion blur and anti-aliasing.
import { createWorld } from "./world.js";
import { DURATION, BEAT, T } from "./timeline.js";
import { clamp, smooth, hash } from "./motion.js";
import { drawGoalTrace, drawColdOpen, drawLamp, drawQuakeLabels, drawRankLabels, drawWordmark } from "./scenes.js";
import { drawProduct } from "./ui.js";

const params = new URLSearchParams(location.search);
const W = +(params.get("w") || 1920), H = +(params.get("h") || 1080);
const out = document.getElementById("out");
out.width = W;
out.height = H;
const octx = out.getContext("2d");
const gl = document.getElementById("gl");
const world = createWorld(gl, W, H);
const work = document.createElement("canvas");
work.width = W;
work.height = H;
const wctx = work.getContext("2d");
const S = W / 1920; // the 2D layer is laid out at 1920x1080

function frame(ctx, t, jx, jy) {
  world.render(t, jx, jy);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(gl, 0, 0);
  ctx.setTransform(S, 0, 0, S, jx * S * 0, 0);
  const project = (x, y, z) => {
    const p = world.project(x, y, z);
    return p && [p[0] / S, p[1] / S, p[2]];
  };
  // Darkness returns for the wordmark.
  const dark = smooth(clamp((t - T.payoff - 0.1) / 0.9));
  if (dark > 0) {
    ctx.fillStyle = `rgba(5,9,14,${dark})`;
    ctx.fillRect(0, 0, 1920, 1080);
  }
  drawLamp(ctx, t);
  drawGoalTrace(ctx, t, project);
  drawQuakeLabels(ctx, t, project);
  drawRankLabels(ctx, t, project);
  drawProduct(ctx, t, project);
  drawColdOpen(ctx, t);
  drawWordmark(ctx, t);
}

// Fixed grain tiles, picked by frame, keep the dark gradients from banding.
const GRAIN = Array.from({ length: 6 }, (_, n) => {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const img = g.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const v = Math.floor(hash(i * 1.618 + n * 7919) * 255);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
});
// Halton (2, 3) jitter, in pixels.
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

window.renderFrame = (t, fps = 60, sub = 4, shutter = 0.5) => {
  for (let i = 0; i < sub; i++) {
    const ts = t + ((i + 0.5) / sub - 0.5) * (shutter / fps);
    const jx = sub > 1 ? halton(i + 1, 2) - 0.5 : 0, jy = sub > 1 ? halton(i + 1, 3) - 0.5 : 0;
    frame(wctx, ts, jx, jy);
    octx.globalAlpha = 1 / (i + 1);
    octx.drawImage(work, 0, 0);
  }
  octx.globalAlpha = 1;
  const v = octx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.38, W / 2, H / 2, Math.hypot(W, H) * 0.62);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.5)");
  octx.fillStyle = v;
  octx.fillRect(0, 0, W, H);
  octx.save();
  octx.globalAlpha = 0.05;
  octx.globalCompositeOperation = "overlay";
  octx.fillStyle = octx.createPattern(GRAIN[Math.floor(t * fps) % GRAIN.length], "repeat");
  octx.fillRect(0, 0, W, H);
  octx.restore();
};
window.DURATION = DURATION;
window.BEAT = BEAT;
window.ready = (async () => {
  const faces = ["600", "700", "800", "900"].map((w) => `${w} 40px "Big Shoulders Display"`)
    .concat(["400", "600", "700"].map((w) => `${w} 40px "Overpass"`));
  await Promise.all(faces.map((f) => document.fonts.load(f)));
  return true;
})();
