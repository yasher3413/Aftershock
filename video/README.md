# Launch film

A 45 second film for Puckquake, written as code. Every frame is a pure
function of time: a three.js scene (the ice, the continent, the shockwaves)
under a 2D canvas layer (type, labels, and the product UI), averaged over
jittered subframes for motion blur and anti-aliasing, then piped to ffmpeg.
The soundtrack is synthesized from sine waves and noise in `audio.py`, on the
same 120 BPM grid.

The brief follows two prompts from
[awesome-opus5-5-videos](https://github.com/yihui-dev/awesome-opus5-5-videos):
@daniel_haida's product film (one idea per shot, object-driven transitions,
the real product as the hero, render and critique before shipping) and
@verbove's motion rules (one draw function, no state between frames,
critically damped springs, contact sheets before the full render).

## Storyboard

| Time | Shot | How it connects |
|---|---|---|
| 0.0 | Ice level. A seismograph trace under the score: NSH 2, MTL 1, 0:20 left. | The pen sits on the Bell Centre. |
| 2.0 | Cole Caufield ties it. The trace spikes, the lamp blooms, Montreal's win chance goes from 3.9% to 51.9%. | Impact on the beat. |
| 3.5 | The camera cranes up: the trace was lying on a sheet of ice. The continent etches in and the 32 arenas light up. | Same object, new dimension. |
| 5.5 | The quake: a ripple through the ice from Montreal, the camera tracking it west. Each team's light column moves as the wave passes. | The app's shockwave, made physical. |
| 9.0 | Wide. "Every team felt it." | A breath. |
| 11.0 | The columns lift off their arenas into a ranking of every team's change. | Columns become bars. |
| 14.0 | The columns sink home, the camera rises overhead, and the map becomes the app, replaying the night's late rush with real scores and odds. | The map was the product. |
| 20.6 | Caufield's row in the rail's tremor feed lifts out and becomes his share card. | Shared element: the magnitude and the name. |
| 24.6 | His name becomes the heading of his player page: 57 goals, PPA, every goal of the season by magnitude. | Shared element: the name. |
| 28.6 | Montreal's team page: the odds ring, and who to root for this week. | The panel morphs. |
| 32.1 | The What-If Lab: the cursor picks Montreal to win its next three, and the odds climb 56.0% to 67.5%. | Each pick reruns the season. |
| 36.1 | The season's calendar of nights, and the camera dives into October 16. | The square fills the frame. |
| 39.1 | Back on the ice. The last shockwave crosses it and engraves the name; "Every goal in the NHL is an earthquake." and puckquake.com. | The first image, the ice, closes the film. |

Every number is real. `prepare.mjs` reads the basemap, team list, and the API
responses captured as end-to-end fixtures (`web/e2e/fixtures`): Caufield's
goal and its effect on all 32 teams, and the full replay of October 16, 2025
(11 games, 67 tremors, the odds after every goal), plus the player, team,
nights and What-If fixtures. The What-If numbers come from the What-If Lab's
own simulator, run natively by `whatif.py` with the page's settings (10,000
seasons, seed 1). The measured claims come from the main README.

## Render

Needs Node 20+, Playwright with Chromium, Python 3 with numpy, and ffmpeg.

```sh
cd video
npm install
cargo build --release --manifest-path whatif/Cargo.toml
python3 whatif.py                              # whatif-results.json
node prepare.mjs                               # data.js from the repo's data
python3 audio.py                               # out/puckquake.wav
node render.mjs --sheet                        # out/sheet.png, one frame per beat
node render.mjs --sheet --from 10 --to 16 --every 0.25 --sheetName strip.png
node render.mjs --at 2.7,10.4 --sub 1          # full-size stills
node render.mjs --sub 4 --workers 3            # out/puckquake-1920x1080.mp4
```

Open `film.html` through any local server (for example `npx serve .`) to load
the scene; `window.renderFrame(t)` draws the frame at `t` seconds.

Sources: `src/timeline.js` (cue times, camera path, per-team state),
`src/world.js` (the 3D scene and its shaders), `src/scenes.js` (cold open,
labels, ranking, finale type), `src/ui.js` (the app's home page),
`src/features.js` (the product pages), `src/trace.js` (the seismograph),
`src/main.js` (compositing).
