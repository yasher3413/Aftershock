# Progress

Resume point for the Aftershock build. Read this, `docs/DECISIONS.md`, and
`git log --oneline -30` before doing anything after a restart.

## Current phase

Phase 18 (hardening) and the Definition of Done, with every stretch goal
implemented. Waiting on: the history precompute (for demo mode, README media,
and magnitude calibration) and tonight's live games (first puck drop 23:30
UTC) to verify live mode end to end.

## Done

- Phases 0 to 3: scaffolding, CI, NHL client, parsers, fixtures, schema,
  backfill (every game since 2015-16), Rust rules engine with the nine-season
  gold test. Tag v0.1.0.
- Phases 4 to 6: xG, team strength, win probability (Skellam-boosted, state
  aware), OT and shootout math, model cards, sanity tests. Tag v0.2.0.
- Phases 7 and 8: Rust Monte Carlo (20k seasons in about 120 ms p95), PyO3
  and WASM builds, team-strength noise, season backtest with tuned shrink.
  Tag v0.3.0.
- Phase 9: I/O-free engine (tremors, reversals, corrections), worker (leader
  lock, drift reweighting, schedule refresh, standings reconciliation, night
  bundles, recap), engine tests on real games.
- Phases 10 and 11: history precompute and magnitude calibration; every REST
  endpoint, WebSocket with since replay, share images.
- Phases 12 to 17: map with shockwaves, seismograph, panels, demo mode,
  night replays, team, game, tremor, leaders, methodology, status pages,
  What-If Lab (WASM in a worker), recap.
- Phase 18: Docker images and Compose app profile, e2e tests in CI, docs
  (ARCHITECTURE, DATA, MODELS, SIMULATOR, API, DESIGN, DEPLOY, DECISIONS).
- Stretch goals 1 to 7: clinch and elimination status with magic numbers and
  tonight's scenarios; web push alerts; Discord webhook; embeddable gauge;
  on-ice PPA from shift charts; lottery watch; season energy comparison.

## Next

- After the precompute rerun: recheck the magnitude scale and the month
  profile, update the methodology copy with the measured numbers, capture
  README media, refresh e2e fixtures.
- Tonight: watch the worker on real games; record tremor latency; turn the
  recorded live sequences into live-engine test fixtures.
- Tag v1.0.0 after the live night (v0.4.0 to v0.6.0 are tagged).

## Background jobs

- **Live recorder**: `aftershock record-live --hours 96` (since 05:41 UTC).
  Log `logs/recorder.log`, output `data/recordings/`.
- **Worker**: `aftershock worker`, log `logs/worker.log`.
- **API**: uvicorn on :8000 (`logs/api.log`); **web dev** on :5173.
- **Precompute rerun**: `aftershock precompute --season 20252026 --season
  20242025` then `aftershock onice`, started 20:01 UTC, log
  `logs/precompute2.log`.

## Known issues

- 2026-09-30 19:40 UTC: the first history precompute simulated every night
  from empty standings. The season engine swaps in a new inputs object on
  each tremor, and the precompute kept its own stale reference, so no game
  was ever marked final. Every 2024-25 and 2025-26 tremor, odds point, and
  bundle was deleted and is being recomputed (fix in `cdfc54d`, guarded by
  `check_finals`). The live worker always reads `engine.inputs` and was not
  affected; neither were the model metrics or the season backtest.

- 2026-09-30 16:10 UTC: the disk filled during Docker builds and Docker
  Desktop's containerd now crashes on start. Postgres and Redis run from
  Homebrew instead (see DECISIONS). Start them with:
  `/opt/homebrew/opt/postgresql@16/bin/pg_ctl -D ~/.aftershock/pg16 -o "-p 55432" start`
  and `redis-server --port 6379 --daemonize yes --dir ~/.aftershock`.
  The database reload runs as `logs/reload.log`.

- Preseason odds for extreme teams (Carolina 99.9 percent after a Cup run)
  exceed anything in the backtest; ratings include playoff games and the
  strength tuning chose no season-to-season regression.
