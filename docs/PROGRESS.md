# Progress

Resume point for the Aftershock build. Read this, `docs/DECISIONS.md`, and
`git log --oneline -30` before doing anything after a restart.

## Current phase

Phases 10 to 14: history precompute running; API done; frontend home and
replay working with real data; building the remaining pages. Tags pushed:
v0.1.0 (data layer), v0.2.0 (models), v0.3.0 (simulator).

## Done

- Phases 0 to 3: scaffolding, CI, NHL client, parsers, fixtures, schema,
  backfill (all games 2015-16 to now in Postgres), Rust rules engine with the
  nine-season gold test.
- Phases 4 to 6: xG, team strength, win probability, OT and shootout math,
  model cards (`ml/MODEL_CARDS.md`), sanity tests.
- Phases 7 and 8: Rust Monte Carlo (20k seasons in ~120 ms p95), PyO3 and
  WASM builds, team-strength noise, season backtest with tuned shrink.
- Phase 9 core: I/O-free season engine, persistence, worker (leader lock,
  drift reweighting, nightly upkeep), publisher and WebSocket hub.
- Phase 11: every REST endpoint except share images; generated TS types.
- Phase 12 and 13: design plan, tokens, map (Pixi shockwaves, reversals,
  shake, reduced motion), seismograph, panels, demo mode, night replay page.
- Recap generator (LLM with validation, template fallback).

## Next

- Pages: game, tremor, leaders, methodology, status, What-If Lab.
- Share images (cairosvg), Docker images, e2e tests, README media.
- Run the worker through tonight's real games (first puck drop 23:30 UTC).

## Background jobs

- **Live recorder**: `aftershock record-live --hours 96` (since 05:41 UTC).
  Log `logs/recorder.log`, output `data/recordings/`.
- **Worker**: `aftershock worker`, log `logs/worker.log`.
- **API**: uvicorn on :8000 (`logs/api.log`); **web dev** on :5173.
- **Precompute**: `aftershock precompute --season 20252026 --season
  20242025`, started 15:07 UTC, log `logs/precompute.log`, then calibrates
  magnitude and rewrites bundles.

## Known issues

- 2026-09-30 16:10 UTC: the disk filled during Docker builds and Docker
  Desktop's containerd now crashes on start. Postgres and Redis run from
  Homebrew instead (see DECISIONS). Start them with:
  `/opt/homebrew/opt/postgresql@16/bin/pg_ctl -D ~/.aftershock/pg16 -o "-p 55432" start`
  and `redis-server --port 6379 --daemonize yes --dir ~/.aftershock`.
  The database reload runs as `logs/reload.log`.

- Preseason odds for extreme teams (Carolina 99.9 percent after a Cup run)
  exceed anything in the backtest; ratings include playoff games and the
  strength tuning chose no season-to-season regression.
