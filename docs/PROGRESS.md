# Progress

Resume point for the Aftershock build. Read this, `docs/DECISIONS.md`, and
`git log --oneline -30` before doing anything after a restart.

## Current phase

Phase 0: bootstrap.

## Done

- Git safeguards: local commit-msg and pre-commit hooks installed and
  verified (attribution trailer stripped, em dash blocked).
- `scripts/check_no_em_dash.py` committed.

## Next

- Monorepo scaffolding (cargo workspace, uv project, Vite app).
- Makefile, Docker Compose, CI skeleton.

## Background jobs

None.

## Known issues

None yet.
