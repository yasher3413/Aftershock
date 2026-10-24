// Renders puckquake.html frame by frame in headless Chromium and pipes the
// frames into ffmpeg.
//
//   node render.mjs --sheet                 one frame per beat, as a contact sheet
//   node render.mjs                         16:9, 1920x1080, 60 fps
//   node render.mjs --at 3.4,8.6            full-size stills at those seconds
import { createServer } from "node:http";
import { readFile, mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// CommonJS require so a global Playwright install (NODE_PATH) is found too.
const { chromium } = createRequire(import.meta.url)("playwright");

const here = fileURLToPath(new URL(".", import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
    return acc;
  }, []),
);
const W = +(args.w || 1920);
const H = +(args.h || 1080);
const FPS = +(args.fps || 60);
const SUB = +(args.sub || 6);
const WORKERS = +(args.workers || 3);
const OUT = args.out || join(here, "out", `puckquake-${W}x${H}.mp4`);
const AUDIO = args.audio === undefined ? join(here, "out", "puckquake.wav") : args.audio;

const types = { ".html": "text/html", ".js": "text/javascript", ".woff2": "font/woff2", ".json": "application/json" };
const server = createServer(async (req, res) => {
  try {
    const path = join(here, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!path.startsWith(here)) throw new Error("outside");
    res.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" });
    res.end(await readFile(path));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/puckquake.html`;

const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--disable-gpu-vsync"] });

async function openPage(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  const q = new URLSearchParams({ w, h, render: "1", still: "1" });
  if (args.fit) q.set("fit", args.fit);
  await page.goto(`${base}?${q}`);
  await page.evaluate(() => window.ready);
  return page;
}
async function grab(page, t, sub) {
  const b64 = await page.evaluate(
    ([t, fps, sub]) => {
      window.renderFrame(t, fps, sub);
      return document.getElementById("out").toDataURL("image/png").split(",")[1];
    },
    [t, FPS, sub],
  );
  return Buffer.from(b64, "base64");
}

function ffmpeg(argv) {
  const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...argv], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((res, rej) => p.on("close", (c) => (c === 0 ? res() : rej(new Error(`ffmpeg ${c}`)))));
  return { stdin: p.stdin, done };
}
const write = (stream, buf) => new Promise((r) => (stream.write(buf) ? r() : stream.once("drain", r)));

await mkdir(join(here, "out"), { recursive: true });
const duration = await (await openPage(64, 36)).evaluate(() => window.DURATION);

if (args.sheet) {
  // One frame per beat (or per --every seconds), tiled for a quick review.
  const every = +(args.every || 0.5);
  const tw = 480, th = Math.round((480 * H) / W);
  const page = await openPage(tw, th);
  const times = [];
  for (let t = every / 2; t < duration; t += every) times.push(+t.toFixed(3));
  const dir = join(here, "out", "sheet");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const [i, t] of times.entries()) await writeFile(join(dir, `${String(i).padStart(3, "0")}.png`), await grab(page, t, 1));
  const cols = 6;
  await ffmpeg(["-framerate", "1", "-i", join(dir, "%03d.png"), "-vf",
    `drawtext=text='%{eif\\:(n+0.5)*${every}\\:d}.%{eif\\:mod((n*${every}+${every / 2})*10\\,10)\\:d}s':x=8:y=8:fontcolor=white:fontsize=18:box=1:boxcolor=black@0.6,tile=${cols}x${Math.ceil(times.length / cols)}:padding=4`,
    "-frames:v", "1", join(here, "out", args.sheetName || "sheet.png")]).done;
  console.log(`contact sheet: out/${args.sheetName || "sheet.png"} (${times.length} frames)`);
} else if (args.at) {
  const page = await openPage(W, H);
  for (const t of String(args.at).split(",")) {
    await writeFile(join(here, "out", `still-${t}.png`), await grab(page, +t, SUB));
    console.log(`out/still-${t}.png`);
  }
} else {
  const total = Math.round(duration * FPS);
  const per = Math.ceil(total / WORKERS);
  const started = Date.now();
  let doneFrames = 0;
  const parts = [];
  await Promise.all(
    Array.from({ length: WORKERS }, async (_, w) => {
      const f0 = w * per, f1 = Math.min(total, f0 + per);
      if (f0 >= f1) return;
      const part = join(here, "out", `part-${w}.mp4`);
      parts[w] = part;
      const page = await openPage(W, H);
      const enc = ffmpeg(["-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
        "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-tune", "grain", "-pix_fmt", "yuv420p",
        "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", part]);
      for (let f = f0; f < f1; f++) {
        await write(enc.stdin, await grab(page, f / FPS, SUB));
        if (++doneFrames % 60 === 0) {
          const s = (Date.now() - started) / 1000;
          console.log(`${doneFrames}/${total} frames, ${s.toFixed(0)} s, eta ${((s / doneFrames) * (total - doneFrames)).toFixed(0)} s`);
        }
      }
      enc.stdin.end();
      await enc.done;
    }),
  );
  const list = join(here, "out", "parts.txt");
  await writeFile(list, parts.filter(Boolean).map((p) => `file '${p}'`).join("\n"));
  let hasAudio = false;
  try { await readFile(AUDIO); hasAudio = !!AUDIO; } catch {}
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, ...(hasAudio ? ["-i", AUDIO] : []),
    "-c:v", "copy", ...(hasAudio ? ["-c:a", "aac", "-b:a", "256k", "-shortest"] : []), "-movflags", "+faststart", OUT]).done;
  for (const p of parts.filter(Boolean)) await rm(p);
  await rm(list);
  console.log(`${OUT} (${((Date.now() - started) / 1000).toFixed(0)} s${hasAudio ? ", with audio" : ", no audio"})`);
}

await browser.close();
server.close();
