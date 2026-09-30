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

## 2026-09-30: Tied subgroups restart the tiebreak chain

- **Decision:** when a tiebreak step separates some but not all clubs in a
  tied group, each still-tied subgroup goes back to step 1 with only its own
  members. In practice this only changes the head-to-head step: a three-way
  tie reduced to two clubs is settled by those two clubs' games against each
  other.
- **Alternatives:** continue down the chain from the next step with the
  remaining clubs.
- **Reason:** the official NHL text (NHL.com tie-breaking procedure) is
  silent on this. Restarting is what leagues that spell it out do (MLB, the
  NFL) and keeps "points earned in games against each other among the tied
  clubs" literal. No validated season has a case that distinguishes the
  two readings, so the gold test cannot arbitrate.

## 2026-09-30: Each standings grouping is tiebroken on its own

- **Decision:** division order, wild-card order (clubs outside the division
  top three), conference order, and league order are each sorted
  separately, with head-to-head computed among the clubs tied inside that
  grouping.
- **Alternatives:** sort the conference once and derive division and
  wild-card order by filtering it.
- **Reason:** the rule compares "games among the tied clubs", and which
  clubs are tied depends on the grouping. Every validated season matches
  the official division, wild-card, conference, and league order this way.

## 2026-09-30: The `nhl-2010` chain has four steps

- **Decision:** the pre-2019-20 chain is points percentage, ROW,
  head-to-head, goal differential, with no total-wins or goals-for step.
- **Alternatives:** the 2019 chain minus the RW step (which would keep
  total wins and goals for).
- **Reason:** that is the official text served with the NHL.com standings
  in April 2018 (archived on the Wayback Machine, cited in
  `docs/SIMULATOR.md`).

## 2026-09-30: Deterministic fallbacks where the official procedure ends

- **Decision:** if every step of the chain is equal, clubs keep config
  order. In a multi-club head-to-head, a club with no counted games against
  the others counts as 50 percent.
- **Alternatives:** a seeded coin flip; treating no games as 0 percent.
- **Reason:** the official procedure ends in a draw or a tiebreak game,
  which a deterministic engine cannot reproduce. Both cases are
  vanishingly rare and never occur in the validated seasons; a fixed rule
  keeps results reproducible and independent of feed order.

## 2026-09-30: Odd games are fixed from the schedule

- **Decision:** `Schedule::new` marks each pair's odd game once, from the
  schedule order: if a pair meets an odd number of times, the first game
  hosted by the club with more home meetings is excluded from head-to-head.
  The gold test orders games by date, then game id. Pairs with an even
  number of meetings keep every game.
- **Alternatives:** determine the odd game from results as they arrive.
- **Reason:** the whole schedule is known before the season, so a
  precomputed flag keeps `apply` branch-light and makes standings
  independent of the order in which results are fed. The pre-2019 wording
  ("not played an equal number of home games") and the current wording
  ("not played an even number of games") agree whenever the meeting count
  is odd, and in the validated seasons every pair with unequal hosting met
  an odd number of times.

## 2026-09-30: Division winner seeding uses the conference standings

- **Decision:** the division winner placed higher in the conference
  standings meets WC2. Home ice in each series still uses the pairwise
  `better_record` comparison.
- **Alternatives:** use `better_record` between the two division winners.
- **Reason:** the two agree except in a points tie involving a third club,
  where the standings are the reference the NHL publishes. Matches all
  validated first rounds.

## 2026-09-30: League configs are embedded in the core crate

- **Decision:** `LeagueConfig::builtin(name)` returns configs embedded with
  `include_str!` from `config/leagues/`; tests also read the files from disk.
- **Alternatives:** read files at runtime only.
- **Reason:** the wasm32 build has no filesystem, and embedding keeps one
  source of truth.

## 2026-09-30: Pulled-goalie overtime losses are a separate end type

- **Decision:** `EndType::OvertimeForfeit` records an overtime loss by a
  club that had pulled its goalkeeper: the loser gets a regulation loss (L,
  0 points), the winner an overtime win (ROW, not RW). The gold test lists
  the one such game in the validated seasons (2023021166, VGK at MIN,
  2024-03-30) by game id, because the feed reports it as plain `OT`.
- **Alternatives:** a per-team point adjustment in the gold test; a boolean
  on every `GameResult`.
- **Reason:** the official 2023-24 standings charge MIN 34 L and 9 OTL (87
  points), which only this rule explains. An end type keeps `GameResult`
  small, keeps W/L/OTL/RW/ROW and head-to-head points consistent, and lets
  live ingestion pass the case through once it detects it from
  play-by-play. The adjustment names a game, not a team.

## 2026-09-30: Scorelines are sampled only when goals can matter

- **Decision:** each simulation samples every game's outcome, but samples
  scorelines (GF and GA) only when two clubs are level in points and in
  every non-head-to-head chain step before the first goals step. Otherwise
  goals cannot reach any standings or home-ice comparison.
- **Alternatives:** always sample scorelines; skip goals entirely.
- **Reason:** scoreline tables are most of the per-game cost and only
  about 4 percent of simulated seasons reach a goals tiebreak. The
  scoreline uniform is keyed by game, so sampling later gives exactly the
  same goals; a unit test proves lazy and eager runs are identical.
  Single-thread cost fell from 57 to about 25 microseconds per season.

## 2026-09-30: `tie_theta` applies to cells ending in a regulation tie

- **Decision:** for future games `tie_theta` multiplies the diagonal; for
  live games it multiplies the added-goal cells whose final regulation
  score is level. The engine documents that `tie_theta` does not change
  sampled results today, because the outcome class comes from the 6-way
  probabilities and `tie_theta` scales a whole class uniformly.
- **Alternatives:** drop the parameter; use it to re-derive class
  probabilities.
- **Reason:** the brief specifies the table construction and the 6-way
  probabilities as the source of the class. Keeping the parameter makes
  the tables match the scoreline model if they are later used for class
  probabilities.

## 2026-09-30: Playoff series RNG slots

- **Decision:** series slots per simulation are round 1 `0..8` (bracket
  order, four per conference), round 2 `8..12`, conference finals
  `12..14`, final `14`, each keyed as `(seed, sim, slot, Stream::Playoff)`.
- **Alternatives:** key by the two team indices.
- **Reason:** a slot is fixed by bracket position, so the same series
  position uses the same random numbers across before/after runs even when
  different teams reach it, which keeps playoff noise low in comparisons.

## 2026-09-30: Binding details beyond the brief

- **Decision:** the Python crate keeps the Rust lib name `aftershock_py`
  and names the Python module `aftershock_core` in `#[pymodule]`; PyO3's
  `extension-module` feature is enabled only by maturin (via
  `pyproject.toml`). `SimResult` also exposes the per-simulation records
  (`focus_outcomes`, `playoff_mask`, `division_mask`, `cup_winner`),
  `prob(name)`, and a `config_teams(config)` helper. The WASM JSON input
  also accepts `"status": "live"` with `"score": [h, a]` and the end code
  `"OTF"` (pulled-goalie overtime forfeit); the output adds `n_sims` and a
  trimmed `points_hist` per team.
- **Alternatives:** exactly the listed API only.
- **Reason:** a lib named `aftershock_core` would collide with the core
  crate's output file; `cargo test --workspace` cannot link test binaries
  with `extension-module` on. The extras cost nothing and let callers
  compute their own conditional views and handle live games in the lab.
