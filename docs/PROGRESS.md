# Progress

Resume point for the Aftershock build. Read this, `docs/DECISIONS.md`, and
`git log --oneline -30` before doing anything after a restart.

## Status: v1.0.0 (2026-10-01)

The Definition of Done is met and every stretch goal is built. Live mode ran
end to end on the first live night of 2026-27 (2026-09-30): three games, 22
goals, every goal stored and broadcast once, a validated model-written recap,
and a full replay of the night.

## What exists

- **Data:** NHL client (polite, cached), parsers, every game since 2015-16 in
  Postgres, a Rust rules engine that reproduces nine seasons of official
  standings exactly.
- **Models:** expected goals (test AUC 0.755), team strength (59.4 percent
  of winners, 2021-22 to 2025-26), in-game win probability (beats a
  score-and-time table on log loss), exact overtime and shootout math; model
  cards and reports in `ml/`.
- **Simulator:** Rust Monte Carlo (20,000 seasons in about 120 ms), PyO3 and
  WASM builds, season backtest (Brier 0.110 against 0.153), common random
  numbers so one goal's effect can be isolated.
- **Live engine:** worker with leader lock, goal tremors with reversals and
  attribution changes, magnitude, PPA and CPA, nightly upkeep (schedule,
  ratings, standings check, on-ice and discipline jobs, replay bundle, recap).
- **Site:** live map with shockwaves and a map key; seismograph; demo replay
  that opens on a goal; tonight, team (scoreboard ring plus season
  seismogram), player cards (headshot, every goal, discipline and defense),
  game, tremor, leaders (four groups), every night (season calendar),
  What-If Lab (pick sheet, WASM), methodology (pipeline rail), status, embed;
  team logos and headshots from the NHL's asset server with a trademark
  notice; Overpass and Big Shoulders type.
- **Extras:** clinch status and magic numbers, web push, Discord webhook,
  share images, lottery watch, season energy, on-ice PPA, plus/minus and
  discipline stats validated against NHL totals.
- **Quality:** 138 Python tests, 80 Rust tests, 39 web unit tests, 38
  Playwright tests (including axe accessibility in both color schemes),
  live-engine tests replaying the first live night's recordings; CI runs
  style, Rust, Python, web, e2e, and Docker image builds.

## How to run

See the README quickstart. On this machine Docker Desktop is broken (see
Known issues), so the stack runs from Homebrew Postgres 16 (port 55432) and
Redis 7, with:

- API: `cd services && DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib .venv/bin/uvicorn aftershock.api.app:create_app --factory --port 8000`
- Worker: `cd services && DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib .venv/bin/aftershock worker`
- Web: `cd web && pnpm dev` (http://localhost:5173)

`uv run` drops `DYLD_*` variables on macOS, so start from `.venv/bin` when
share images (Cairo) are needed.

## The first live night (2026-09-30)

PIT 7-0 PHI, NYI 1-2 TOR, LAK 4-8 COL. 22 goals, 22 tremors. Detection to
broadcast after the latency fix: 0.29 to 1.0 s (budget 2 s); the first goal
took 2.6 s before it. Bugs found and fixed during the night, each with a test
built from the recording:

1. Leaderboards were refreshed before the broadcast (2.6 s): now in the
   background after it.
2. A goal the feed first posts as a shot was skipped by the engine (TOR at
   20:00 ET, PIT at 22:10 ET) and crashed the play save: the engine takes the
   shot back and applies the goal; play rows are deduplicated; a save error
   no longer drops a snapshot's goals. Both goals recovered.
3. A worker restart re-broadcast earlier goals and skipped finished games:
   stored goals are remembered at boot and finished games are polled once.
4. The home page fell back to an old replay between games, and the next-game
   countdown skipped a late start: fixed.
5. Restarts lost the night's replay frames: frames and starting odds now
   live in Redis, a night is wrapped up once, and `SeasonPrecompute(...,
   relink=True).run(only=..., force=True)` rebuilds a recorded night's replay
   without rewriting its tremors (used for 2026-09-30).

## Known issues and limitations

- Docker Desktop on this machine crashes on start since the disk filled on
  2026-09-30, so `make up` has not been run locally; CI builds all three
  images. Start Postgres and Redis with
  `/opt/homebrew/opt/postgresql@16/bin/pg_ctl -D ~/.aftershock/pg16 -o "-p 55432" start`
  and `redis-server --port 6379 --daemonize yes --dir ~/.aftershock`.
- Ratings know nothing about trades, injuries, or starting goalies; early
  season odds rest on last season.
- The NHL publishes no shift charts for 2024-25 games 2024021235 to
  2024021312, so that season's on-ice PPA and plus/minus miss about 5
  percent of goals (flagged on the pages). The NHL's HTML time-on-ice
  reports could fill it.
- Plus/minus matches the NHL exactly for 94 percent of players (99 within
  one); penalty minutes for 99.6 percent (a few 10-minute misconducts).
- Share images render in system fonts on macOS (CoreText ignores the bundled
  fonts); the Linux images are correct.
- Logos and headshots are loaded from the NHL unlicensed, with a trademark
  notice (see DECISIONS); removing `TeamLogo` and `Headshot` restores the
  code-and-color look.

## Since v1.0.0 (2026-10-01)

- Home replays last night between nights (falls back to last season's most
  dramatic night only in the offseason); see DECISIONS.
- Three `/impeccable critique` runs: 26, 29, 30 out of 40; every listed
  issue fixed (season-chart label clusters, player cards open on the current
  season with a last-season pointer, captions capped near 70 characters,
  dated replay panel, logos on the What-If sheet, game page scoreboard
  header with its biggest tremor, first-visit note on phones only, captions
  hidden on empty charts). Snapshots in `.impeccable/` (gitignored).
- Launch walkthrough fixes: link previews are now server-side (`/page/...`
  route in `api/pages.py`, nginx sends page requests through it) because
  preview bots run no JavaScript; tremor pages collapse unmoved teams and
  explain a zero PPA; What-If list scrolls with the page on phones.
- Free deployment built (not yet deployed): Vercel for the website plus one
  Oracle Cloud Always Free ARM VM for api, worker, Postgres, Redis, and
  Caddy (`infra/docker-compose.oracle.yml`, `infra/Caddyfile`,
  `vercel.template.json` + `scripts/set_api_host.sh`,
  `scripts/deploy/oracle_bootstrap.sh`, `scripts/deploy/push_data.sh`,
  `VITE_WS_URL` for the live socket, `INDEX_HTML` for previews). CI builds
  the api and worker images on ARM too, all green. Koyeb, Neon, and Upstash
  free tiers were ruled out (Koyeb closed to new users and sleeps; the
  database is 3.3 GB against Neon's 0.5 GB).

- Nights now leads with the latest replay, real scoreboards and a ranked
  list of biggest nights before the season calendar. Night pages put the
  map and playback controls before the recap, switch between games,
  tremors and standings, and add Restart / Next goal. The layout adapts
  to phones without hiding the playback controls below the game list.
  Verified: 138 Python tests, 37 web unit tests, TypeScript, lint, and 25
  Playwright tests (nine optional media captures skipped). Real-data browser
  checks covered desktop and phones in both themes, with no serious
  accessibility violations or horizontal overflow. The browser suite passed
  with two workers after a four-worker run timed out waiting for the home
  map to initialize. Rapid night changes and phone playback control order
  were checked separately.

- The four main routes received a fan-focused pass: Tonight's personal
  context and current games come first; Leaders is searchable with saved
  season/view URLs and progressive lists; What If has nearby phone feedback,
  visible win types, filter-aware randomization and undo; How It Works opens
  with a fan primer before complete, expandable model evidence. API failures
  have recovery actions, phone panels support keyboard navigation, and
  crowded timeline goals remain individually reachable through a chooser.
  Loaded maps and replays survive background refresh failures.
  Verified: 138 Python tests, 39 web unit tests, TypeScript/build, lint,
  formatting and 37 Playwright tests (nine optional media captures skipped).
  Desktop and narrow-phone checks covered both themes, with the actual
  live data and selected-team/scenario states. Touch-target findings were
  corrected; model metric expressions and validation charts were preserved.
  The browser suite passed with one worker after concurrent screenshot jobs
  caused a map-initialization timeout.

- Tonight's map is more compact on phones (38vh, minimum 260px), with
  a wider desktop game panel (440px). The map-first flow is retained.
  Displayed nodes stay inside the map bounds. Verified all 32 team targets
  at phone, short-phone, desktop-breakpoint and desktop sizes in both themes;
  138 Python, 39 unit and 38 browser tests passed, plus build/typecheck,
  lint, formatting and the em-dash scan (nine optional media tests skipped).

- The bottom timeline now leads with its impact trace, explains the signal,
  shows current/replay time, and keeps goal markers in a separate lane.
  Magnitude values remain in goal details instead of crowding the curve;
  phone playback controls leave the full plot width available. Verified live
  and replay layouts on desktop and phones in both themes, with no serious
  accessibility violations or overflow. Required checks passed: 138 Python,
  39 unit and 38 browser tests, build/typecheck, lint and formatting (nine
  optional media captures skipped).

## Next

1. Owner creates the Oracle VM (Ubuntu 24.04, VM.Standard.A1.Flex, 4 OCPU,
   24 GB, ingress TCP 80 and 443) and sends its public IP.
2. Run `scripts/set_api_host.sh <IP>.sslip.io`, commit and push `vercel.json`.
3. Owner imports the repo in Vercel (root = repo root, framework Other) with
   `VITE_WS_URL=wss://<IP>.sslip.io/ws/live`, and sends the site address.
4. Owner runs the bootstrap on the VM with the site address, then
   `scripts/deploy/push_data.sh ubuntu@<IP>` from the laptop.
5. Verify: `https://<IP>.sslip.io/api/health`, the site and live socket,
   `/status`, and link previews in an Open Graph checker. The full stack has
   never run together in Docker; expect to fix small startup issues.
6. Later: buy a domain (DEPLOY.md "A domain"); fill the 2024-25 shift-chart
   gap from NHL HTML reports; goalie "PPA saved".

## Background jobs (this machine)

- Recorder: `aftershock record-live --hours 96`, output `data/recordings/`.
- Worker, API (:8000), and web dev server (:5173), logs in `logs/`.
