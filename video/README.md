# Demo video

A 35 second launch video for Puckquake, written as code: one canvas and one
`draw(t)` function in `puckquake.html`, rendered frame by frame in headless
Chromium. The soundtrack is synthesized in `audio.py` on the same 120 BPM
grid.

The approach follows the "motion design is becoming a prompt" brief from
[awesome-opus5-5-videos](https://github.com/yihui-dev/awesome-opus5-5-videos)
(by @verbove): one draw function with no timers and no state between frames,
closed-form springs with a small overshoot, one spring per change of target,
a short blur on every transition, a contact sheet before the full render, and
60 fps with 6 subframes averaged for motion blur.

## The story

1. Centre Bell, October 16, 2025. Nashville leads 2-1, 20 seconds left in the third.
2. Cole Caufield ties it. Montreal's win chance goes from 3.9% to 51.9%.
3. The shockwave crosses the map, and every team's playoff odds move as it passes.
4. The ranking of all 32 changes, then 20,000 seasons run with and without the goal.
5. Caufield's season as a seismogram, a team page, every night, and the What-If Lab.
6. The measured results (AUC, picks, standings, speed), then the wordmark.

Every number is real. `prepare.mjs` reads the basemap, team list, and the API
responses captured as end-to-end fixtures (`web/e2e/fixtures`) and writes
`data.js`. The goal is the biggest tremor in Caufield's 2025-26 fixture; the
stats come from the README.

## Render

Needs Node 20+, Playwright with Chromium, Python 3 with numpy, and ffmpeg.

```sh
cd video
npm install
node prepare.mjs              # data.js from the repo's data
python3 audio.py              # out/puckquake.wav
node render.mjs --sheet       # out/sheet.png, one frame per beat
node render.mjs               # out/puckquake-1920x1080.mp4
node render.mjs --at 3.4,8.6  # full-size stills at those seconds
```

Open `puckquake.html` through any local server (for example
`npx serve .`) to watch it in real time; add `?t=7` to start at 7 seconds.
