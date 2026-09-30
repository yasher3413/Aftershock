# Progress

Resume point for the Aftershock build. Read this, `docs/DECISIONS.md`, and
`git log --oneline -30` before doing anything after a restart.

## Current phase

Phase 1: NHL client and ground truth (Phase 0 complete, CI green).

## Done

- Git safeguards: local commit-msg and pre-commit hooks installed and
  verified (attribution trailer stripped, em dash blocked).
- `scripts/check_no_em_dash.py` committed.

- Monorepo scaffolding: cargo workspace, uv project (`services/`), Vite app
  (`web/`), Makefile, Docker Compose (Postgres on host port 55432, Redis on
  6379), CI (style, rust, python, web).
- Typed async NHL client with rate limiting, retries, ETag, disk cache.

## Next

- Parsers for play-by-play, schedule, standings; fixtures; `docs/DATA.md`.
- Database schema and loader from the raw cache.

## Background jobs

- **Live recorder**: `aftershock record-live --hours 96`, started
  2026-09-30 05:41 UTC. Log: `logs/recorder.log`. Output:
  `data/recordings/{gameId}/`. Check with `tail logs/recorder.log`.
- **Raw fetch**: `aftershock fetch-raw --from-season 20152016`, started
  2026-09-30 05:42 UTC. Log: `logs/fetch-raw.log`. Resumable: rerun the same
  command to continue.

## Known issues

None yet.
