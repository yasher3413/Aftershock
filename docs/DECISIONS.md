# Decisions

Each entry: date, decision, alternatives considered, reason.

## 2026-09-30: No open-source license

- **Decision:** the repository has no LICENSE file and stays all rights
  reserved by default.
- **Alternatives:** MIT, Apache-2.0.
- **Reason:** the owner has not chosen a license, and the project displays
  data owned by the NHL. Adding a license is a decision for the owner.

## 2026-09-30: Git hooks live only in `.git/hooks`

- **Decision:** the commit-msg and pre-commit hooks are installed locally and
  not committed; the em dash check script they call is committed and CI runs
  it with `--all`.
- **Alternatives:** a committed `.githooks/` directory with
  `core.hooksPath`, or the pre-commit framework.
- **Reason:** keeps the repo free of tooling that only matters to one
  machine, while CI enforces the same rule for every clone.

## 2026-09-30: Compose Postgres on host port 55432

- **Decision:** the Compose Postgres publishes on host port 55432.
- **Alternatives:** 5432 (default), 5433.
- **Reason:** both 5432 and 5433 were already taken on the development
  machine by other local databases. 55432 is unlikely to collide anywhere.

## 2026-09-30: Raw play JSON only for the live season

- **Decision:** `plays.raw` is nullable and filled only for games of the
  current season. Historical plays keep every parsed column and a content
  hash. Model training reads play-by-play straight from the gzipped raw
  cache instead of Postgres.
- **Alternatives:** store full JSON for every play (about 4.6 million rows).
- **Reason:** the full JSON would cost several gigabytes for a decade of
  games with no reader. Live diffing and corrections need the raw JSON, and
  those only happen in the current season.

## 2026-09-30: Commit compact gold standings fixtures

- **Decision:** `tests/fixtures/gold/{season}.json.gz` holds each validated
  season's results (teams, final score, how it ended), alignment, official
  final standings, and first-round matchups, about 15 KB each.
- **Alternatives:** have the gold test fetch from the API at test time, or
  read the gitignored raw cache.
- **Reason:** CI must run the gold test without network access or a
  backfill. These are compact facts, not raw API dumps.

## 2026-09-30: Backtest-only xG variant

- **Decision:** besides the production xG model (trained 2015-16 to
  2023-24), train `xg-bt-1.0.0` on 2015-16 to 2019-20 only, and use it for
  the team-strength backtest (2021-22 to 2025-26).
- **Alternatives:** use the production xG model everywhere.
- **Reason:** the production model was fit on shots from 2021-22 to 2023-24,
  so ratings built from its xG would carry information from the games being
  predicted. The variant keeps the backtest strictly out of sample.

## 2026-09-30: Ordinal win-probability model

- **Decision:** model regulation outcomes as a cumulative pair of binary
  LightGBM classifiers (P(home does not lose), P(home wins)) with a
  monotone constraint on score differential, each Platt-calibrated.
- **Alternatives:** one LightGBM multiclass model with temperature scaling.
- **Reason:** LightGBM does not support monotone constraints for
  multiclass, and the brief requires win probability to be monotonic in the
  score. The outcomes are naturally ordered (away win, tie, home win), so a
  cumulative model is both principled and guarantees the property.
