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

## 2026-09-30: Per-simulation team strength noise

- **Decision:** a new input `team_sigma` draws one normal log-odds shift
  per team per simulation, `delta[t] = team_sigma * Phi^-1(u)`, with `u`
  from a new counter-RNG stream `TeamStrength` keyed by `(seed, sim,
  team)`. Future games are tilted by `delta[home] - delta[away]` on the
  home-win log odds, with the three home and three away outcomes rescaled
  proportionally; playoff games are tilted the same way. Live and final
  games are not tilted. `team_sigma = 0` skips the feature entirely.
  Acklam's inverse normal CDF in `f64` (relative error below 1.2e-9) with
  `u` kept strictly inside (0, 1).
- **Alternatives:** widen each game's probabilities independently (does
  not correlate a team's games, so it barely changes season totals); draw
  shifts from the Outcome stream or key them by game (would change
  existing draws or break per-game independence); Wichura AS241 (more
  accurate than needed at higher cost).
- **Reason:** season-long uncertainty comes from not knowing each team's
  true strength, which moves all of its games together. A new stream
  keeps every existing draw unchanged, so `team_sigma = 0` is bit
  identical to before (checked against a fingerprint recorded before the
  change), and keying by team keeps every common-random-numbers property.
  Live games already reflect the game state, so they keep their given
  probabilities, which also keeps live-game reweighting exact. The tilt is
  computed as a ratio of odds (`p r / (p r + 1 - p)` with `r = exp(delta
  difference)`), which needs no `exp` per game; cost at `team_sigma =
  0.15` is about 9 percent single threaded.

## 2026-09-30: Win probability boosts from an analytic baseline

- **Decision:** both win-probability classifiers start from the logit of a
  Skellam model of remaining goals (scoring rates measured per manpower and
  goalie state, applied for the power-play clock or at most two minutes).
- **Alternatives:** trees alone; a plain score-and-clock Skellam baseline.
- **Reason:** trees alone could not reach the near-certain probabilities of
  decided games and lost to a lookup table. A state-blind baseline could not
  express the pulled-goalie effect the brief's sanity test requires.

## 2026-09-30: Rating shrink and team noise for season simulations

- **Decision:** future games inside a season simulation use ratings shrunk
  toward the mean (0.5 before the season, 0.85 after 15 percent is played)
  and per-simulation team strength noise (sigma 0.1), tuned on 2016-17 to
  2018-19 season backtests.
- **Alternatives:** raw ratings (overconfident: a strong team at 99.9 percent
  in October); a hand-picked cap.
- **Reason:** current ratings are noisy estimates and a season simulation
  compounds overconfidence across dozens of games. Tuning on held-out
  seasons keeps the choice measured rather than guessed.

## 2026-09-30: Leaderboards use the season's team, not the current one

- **Decision:** a player's team on a leaderboard is the team he scored most
  of that season's goals for.
- **Alternatives:** `players.current_team`.
- **Reason:** players move; a 2025-26 board should not show 2026-27 teams.

## 2026-09-30: E2E tests run on recorded API responses

- **Decision:** Playwright tests serve real responses captured from a
  running API (`web/e2e/fixtures`, refreshed with
  `scripts/capture_e2e_fixtures.py`) through network routing.
- **Alternatives:** stand up Postgres, Redis, the worker, and a precompute
  inside CI.
- **Reason:** keeps CI fast and deterministic while every byte the page sees
  is real data. The full stack is exercised by `make up` and the live runs.

## 2026-09-30: Share-image fonts are bundled

- **Decision:** Big Shoulders Display and Overpass TTFs (SIL Open Font
  License, license texts included) ship in `services/aftershock/share/fonts`
  and are installed into the api and worker images.
- **Alternatives:** system fonts.
- **Reason:** share images must match the site. On macOS, Cairo resolves
  fonts through CoreText, so local renders fall back to system fonts unless
  the fonts are installed; the Linux images are correct.

## 2026-09-30: Replay bundle paths are relative to the data directory

- **Decision:** `replay_bundles.path` stores a path relative to `DATA_DIR`.
- **Alternatives:** absolute paths.
- **Reason:** the same database must work on the host and inside containers
  where the data directory is mounted elsewhere.

## 2026-09-30: Fall back to Homebrew Postgres and Redis after a disk-full crash

- **Decision:** after Docker image builds filled the development disk,
  Docker Desktop's containerd crashed on every start (a corrupted metadata
  database). Development continued on Homebrew Postgres 16 (data directory
  `~/.aftershock/pg16`, port 55432) and Redis 7 (port 6379), the same ports
  as Compose, and the database was reloaded from the raw cache.
- **Alternatives:** delete Docker's containerd metadata to recover (risking
  the database volume), or reset Docker Desktop (losing it).
- **Reason:** the brief names this fallback, the raw cache makes a full
  reload about an hour, and the Docker volume stays untouched for recovery.
  The Docker images and `make up` are unchanged; they need a working Docker
  and about 15 GB free to build.

## 2026-09-30: Overpass replaces Instrument Sans as the text face

- **Decision:** the text face is Overpass (static 400 and 600 instances cut
  from the variable font for share images). Panel titles in the home rail
  move to the display face at 24 px, and group labels to 15 px, so adjacent
  roles step by 1.25 or more.
- **Alternatives:** keep Instrument Sans; Archivo; Barlow.
- **Reason:** the design critique's detector flagged Instrument Sans as a
  common AI-default face (99 percent of the team page's text), and the home
  rail's 12, 13, and 15 px roles were too close to read as a hierarchy.
  Overpass comes from Highway Gothic, the signage lettering of the same
  buildings Big Shoulders evokes, and has tabular figures.

## 2026-09-30: Show team logos and player headshots

- **Decision:** at the owner's request, the site shows NHL team logos (map
  nodes, team header, standings, tonight's games, leaderboards) and player
  headshots (player cards, leaderboards, tremor pages), loaded from the NHL's
  public asset server (`assets.nhle.com`) and never copied into the repo.
  The footer carries a trademark notice. Each image falls back to the team
  code or the player's initials if it cannot load. This replaces the build
  brief's "no logos" rule.
- **Alternatives:** keep team codes and color ticks only (the brief's rule);
  bundle the images.
- **Reason:** fans recognize logos and faces faster than codes. Comparable
  unaffiliated analytics sites (for example hockeystats.com) do the same
  with a trademark notice. The risk is a takedown request, which the
  fallbacks make cheap to honor: removing two components restores the
  previous look.

## 2026-10-01: Between nights, replay last night

- **Decision:** when no game is live, the home page replays the most recent
  completed night of the last three days; only when there is none (the
  offseason, a long break) does it fall back to the brief's choice, the most
  dramatic night of the previous season's final three weeks.
- **Alternatives:** always replay last season's most dramatic night (the
  brief's rule).
- **Reason:** on the morning after the first live night of 2026-27 the
  "Tonight" page showed April 5, 2026, which read as stale. Last night's
  goals are what a visitor wants before tonight's games, and the replay
  banner still says plainly that it is a replay.

## 2026-10-01: Give the night archive a replay-first layout

- **Decision:** Nights leads with the latest completed night, its recap
  headline, actual game scores and team logos, followed by the biggest
  nights ranked by seismic energy. The season calendar remains below with
  an intensity key. A night opens on a generously sized replay map with
  switchable games, tremors and standings, followed by the full recap.
  Restart and Next goal skip quiet stretches without changing playback
  speed; both leave playback paused. Phone controls sit directly below
  the map. Each date owns its replay state so changing nights cannot show
  the previous night's ready state while the new bundle loads.
- **Alternatives:** enlarge the calendar alone; leave the full recap above
  the map; stack all three replay panels in the sidebar.
- **Reason:** a sparse early-season calendar gave little reason to open a
  replay, and a full recap above the map compressed the experience visitors
  came to watch. Existing rink colors, fonts, components and replay data
  express the change without another visual system or dependency.

## 2026-10-01: Put fan questions before technical detail

- **Decision:** Tonight keeps the map first, with the team choice and live
  context above it, current games before the old recap, a durable phone
  map key, and labels separating game win chances from playoff odds.
  Leaders starts in the current season, stores season and metric in the
  URL, searches the returned board, preserves ranks and reveals long lists
  in groups of 20. Failures have explicit retry actions instead of looking
  like empty results. Lottery and energy label their distinct season scope.
- **Decision:** What If reads picks from the URL, exposes each selected
  winner's regulation/overtime/shootout choice, and keeps scenario feedback
  and a results link near the picks on phones. Randomize fills only the
  upcoming games shown by the filters; Reset picks and Clear filters are
  separate actions. Reset and randomize can be undone. Forecast changes
  stay based on the same simulation seed, and projected brackets remain
  available below the odds.
- **Decision:** How It Works begins with reading the map, percentage points
  and cumulative PPA, using a clearly hypothetical example. Complete model
  evidence lives in labelled native disclosures, with all measured values,
  charts, season windows and limitations preserved. Phone readers retain a
  contents menu and can retry missing evidence without losing the prose.
- **Decision:** Crowded timeline goals share an accessible chooser with
  scorer, team, time and magnitude, while every goal keeps its original
  data and detail link. Map nodes have separated hit areas without changing
  arena origins or shockwave behavior. A background snapshot failure keeps
  an already loaded map and replay usable; it no longer hides them or stops
  replay before replacement data arrives.
- **Alternatives:** styling-only changes; always show every row and model
  chart; keep hidden win-type cycling as the only choice; larger overlapping
  hit areas on the timeline.
- **Reason:** casual fans need an immediate answer for their team, while
  experienced readers need the original evidence and controls. Truthful
  loading/error states, visible scenario feedback, clear statistical
  language and usable phone targets address actual browser findings.

## 2026-10-01: Give Tonight's game information more space

- **Decision:** Tonight's phone map uses 38vh with a 260px minimum, down
  from 45vh and 280px. The desktop game panel is 440px wide instead of
  380px. The map, timeline and panel order stay the same.
- **Reason:** the owner found the map too dominant. These small proportion
  changes bring the game information closer on phones and make it easier
  to scan on desktop while retaining a usable geographic view. Rendered
  checks caught a marker slightly outside the smaller viewport; displayed
  nodes now stay inside its bounds while their arena origins are preserved.

## 2026-10-01: Make the timeline's pulse readable

- **Decision:** the dark impact trace is the primary reading. Persistent
  magnitude numbers are removed from the plot; the original magnitude,
  scorer and time remain in goal controls and details. Small single-goal
  markers and grouped-goal counts occupy a separate lane below the curve.
  The heading explains the signal and shows the current or replay time.
  Phone replay controls sit above the full-width plot.
- **Reason:** the owner found the bottom graph distracting. The trace,
  magnitude values and goal counts competed in a shallow strip, and count
  badges obscured parts of the line. Separating the readings keeps actual
  peaks and all goal links without inventing a decorative waveform or
  changing the underlying energy calculation.

## 2026-10-02: Refetch the page shell after a minute

- **Decision:** the api caches the site's `app.html` for 60 seconds instead
  of for the life of the process, and keeps serving the last copy if a
  refetch fails.
- **Alternatives:** restart the api after every site deploy; a deploy hook
  that clears the cache.
- **Reason:** every Vercel deploy renames the hashed scripts and styles, and
  the production domain only serves the current deploy's files, so a shell
  cached from an earlier deploy would load a blank page. A short expiry
  needs no coordination between the two hosts.
