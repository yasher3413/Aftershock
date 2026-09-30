# Progress

Resume point for the Aftershock build. Read this, `docs/DECISIONS.md`, and
`git log --oneline -30` before doing anything after a restart.

## Current phase

Phases 1 to 6 in progress in parallel (client, data, rules engine, models).
Phase 3 (Rust rules engine) is being built by a subagent in a separate clone
and will be rebased onto main.

## Done

- Phase 0: git safeguards (local commit-msg and pre-commit hooks, verified),
  monorepo scaffolding, Makefile, Compose (Postgres on host port 55432,
  Redis 6379), CI (style, rust, python with Postgres, web, stale types).
- Phase 1: typed NHL client (rate limit, retries, ETag, disk cache),
  parsers, trimmed real fixtures, `docs/DATA.md`, live recorder running.
- Phase 2: schema and migrations, loader, resumable backfill. Raw cache
  holds every game 2015-16 to now (14,513 games, 179 MB).
- Models: xG features and trainer, games table, team strength with tuning
  and backtest, win-probability tracker and ordinal model, OT and shootout
  math. All coded and unit tested; training running (see below).
- Live engine foundations: differ and event sources (live and replay).
- Web foundation: design plan (`docs/DESIGN.md`), tokens, formatters, live
  reducer and store, socket client, timeline player, shell and routes.
- API wire types in pydantic with generated TypeScript types.

## Next

- Integrate the rules engine branch; then the Monte Carlo simulator
  (Phase 7), PyO3 and WASM bindings.
- Tremor pipeline, worker, API endpoints, map.

## Background jobs

- **Live recorder**: `aftershock record-live --hours 96`, started
  2026-09-30 05:41 UTC. Log: `logs/recorder.log`. Output:
  `data/recordings/{gameId}/`.
- **Training**: `aftershock train all`, started 06:16 UTC. Log:
  `logs/train-all.log`. Writes `ml/artifacts/` and `ml/reports/`.
- **DB backfill**: `aftershock backfill --from-season 20152016`, started
  06:16 UTC. Log: `logs/backfill.log`. Resumable: rerun the same command.

## Known issues

None yet.
