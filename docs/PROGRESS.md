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

Tonight (2026-09-30, first puck drop 23:30 UTC: PIT at PHI, NYI at TOR,
then LAK at COL at 02:00 UTC). The worker runs on its own; these checks
work from logs and recordings afterwards:

1. `grep worker.tremor_latency logs/worker.log`: goal detection to broadcast
   should be under 2000 ms.
2. Watch for `tremor_reversed` / attribution changes in the worker log and
   that the map showed them.
3. After the last final: recap stored for 2026-09-30 (OpenAI key is set,
   model gpt-6.1-sol), night bundle written, `/night/2026-09-30` plays.
4. `uv run python ../scripts/make_live_fixtures.py` (from services/), then add
   live-engine tests on the recorded sequences.
5. Final PROGRESS summary, then tag v1.0.0.

Later (UI, from the impeccable critique in .impeccable/critique/): replace
the flagged body face and widen the type scale; redesign Leaders, Method,
and Status like the team page; smaller notes (ring meaning inline, pp and M
inline, mobile tap targets, magnitude color).

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

- Fixed 2026-09-30 21:15 UTC: live preseason odds were overconfident
  (Carolina 99.9 percent, Toronto 0.5 percent). The worker simulated future
  games with the stored, unshrunk pregame odds instead of the shrunk ratings
  the season backtest tuned, so a season of games compounded their
  confidence. After the fix: Carolina 95.4, Toronto 7.8, inside the range
  the backtest found calibrated on October 1 (1.5 to 96.5 percent across
  2021-22 to 2025-26). A grid over the start shrink and team noise scored
  on October 1 log loss confirmed the tuned values (0.5 and 0.1) are best
  on both tuning and test seasons.
