# Simulator

The rules engine and season simulator live in `crates/aftershock-core`. This
document covers how league rules are expressed as data, the exact standings
and tiebreak procedure the engine implements, and how the engine is
validated against official NHL standings.

## League rules as data

Each season is one TOML file in `config/leagues/`:

| File | Teams | Games per team | Tiebreak chain |
| --- | --- | --- | --- |
| `nhl-2015-16.toml`, `nhl-2016-17.toml` | 30 | 82 | `nhl-2010` |
| `nhl-2017-18.toml`, `nhl-2018-19.toml` | 31 | 82 | `nhl-2010` |
| `nhl-2021-22.toml` through `nhl-2025-26.toml` | 32 | 82 | `nhl-2019` |
| `nhl-2026-27.toml` | 32 | 84 | `nhl-2019` |

2019-20 and 2020-21 used non-standard formats and have no config. The
historical files were generated once from the gold fixtures' `teams` lists;
2026-27 uses the published alignment (Atlantic, Metropolitan in the East;
Central, Pacific in the West).

Every file defines:

- `name`, `season`, `games_per_team`, `teams` (abbreviations; the position
  in this list is the team index used everywhere in the engine).
- `tiebreak`: the name of a tiebreak chain (`nhl-2019` or `nhl-2010`).
- `[points]`: `win = 2`, `otl = 1`, `loss = 0`.
- `[overtime]`: `ot_minutes = 5`, `ot_skaters = 3`, `shootout = true`.
- `[playoffs]`: `format = "division-wildcard"`, `division_top = 3`,
  `wildcards_per_conference = 2`, `series_length = 7`,
  `home_pattern = "HHAAHAH"` (H means the club with home ice hosts).
- `[[conferences]]` with the names of their divisions, and `[[divisions]]`
  with their member teams.

`LeagueConfig::from_toml_str` parses and validates a file (every team in
exactly one division, every division in exactly one conference, a known
tiebreak chain, a home pattern matching the series length, and a bracket
shape the format supports). `LeagueConfig::builtin("nhl-2026-27")` loads a
copy embedded at compile time, which is how the wasm build gets its rules.
Realignment or expansion is a config edit; no code names a team or a
division.

Tiebreak chains are the one piece of the rules kept in code: each named
chain is a fixed, reviewable list of `TiebreakStep` values in
`src/tiebreak.rs`, and the config only selects one by name. A future rule
change becomes a new chain name (for example `nhl-2027`), leaving old
seasons reproducible.

## Standings and tiebreakers

### Sources

- Current procedure (2019-20 onward): NHL.com, "Tie-Breaking Procedure",
  <https://www.nhl.com/info/standings-info/tie-breaking-procedure>
  (retrieved 2026-09-30).
- Pre-2019-20 procedure: the tie-breaking legend served with the NHL.com
  standings page in April 2018, archived at
  <http://web.archive.org/web/20180402014848/https://www.nhl.com/standings>
  (field `standingsTieBreakingProcedureDesc`), corroborated by
  <https://www.si.com/nhl/2018/04/06/nhl-playoff-picture-tiebreaker-game-scenario-flyers-panthers>.

### Points and records

A win is worth 2 points, an overtime or shootout loss 1, a regulation loss
0. The engine tracks, per team: GP, W, L, OTL, points, RW (regulation wins),
ROW (regulation plus overtime wins, i.e. all wins except shootout wins), GF,
and GA. A shootout winner is credited with one goal for and the loser with
one goal against; the input scores already include that goal. Standings
are ordered by points; the tiebreak chain runs only among clubs tied in
points.

One exception to the overtime-loss point: a club that pulls its goalkeeper
for an extra attacker in overtime and loses forfeits that point, and the
NHL records a regulation loss (L, 0 points) for it while the winner keeps
an overtime win. The engine models this as `EndType::OvertimeForfeit`. See
the 2023-24 note under the gold test results.

### Chain `nhl-2019` (2019-20 onward)

Official text, in order:

1. The fewer number of games played (i.e., superior points percentage).
2. The greater number of games won, excluding games won in Overtime or by
   Shootout (i.e., "Regulation Wins", RW).
3. The greater number of games won, excluding games won by Shootout (ROW).
4. The greater number of games won by the Club in any manner (total wins).
5. The greater number of points earned in games against each other among
   two or more tied clubs. For two or more clubs that have not played an
   even number of games with one or more of the other tied clubs, the first
   game played in the city that has the extra game (the "odd game") is not
   included. When more than two clubs are tied, the percentage of available
   points earned in games among each other (not including any odd games) is
   used.
6. The greater differential between goals for and against for the entire
   regular season (including goals scored in overtime or awarded for
   prevailing in shootouts).
7. The greater number of goals scored for the entire regular season (same
   overtime and shootout rule).

### Chain `nhl-2010` (2010-11 through 2018-19)

Official text, in order:

1. The fewer number of games played (i.e., superior points percentage).
2. The greater number of games won, excluding games won in the Shootout
   (ROW).
3. The greater number of points earned in games between the tied clubs. If
   two clubs are tied and have not played an equal number of home games
   against each other, points earned in the first game played in the city
   that had the extra game are not included. If more than two clubs are
   tied, the higher percentage of available points earned in games among
   those clubs, not including any odd games, is used.
4. The greater differential between goals for and against for the entire
   regular season (a shootout win counts as one goal for, a shootout loss
   as one goal against).

There is no regulation-wins, total-wins, or goals-for step in this chain.

### How the engine applies a chain

- **Grouping.** Division order, wild-card order, conference order, and
  league order are each computed by sorting that grouping on its own, so the
  head-to-head step always involves exactly the clubs tied within that
  grouping. The wild-card grouping of a conference is every club outside
  the top three of its division.
- **Step by step.** For a group tied in points, the steps are tried in
  order. A step on which every club in the group is equal is passed over.
- **Restart after a split.** The official text does not say what happens
  when a step separates some, but not all, of the tied clubs. The engine
  orders the group by that step and sends every subgroup that is still tied
  back to step 1 with only its own members. Steps other than head-to-head
  depend only on the club itself, so the restart only matters at the
  head-to-head step: a three-way tie that head-to-head reduces to two clubs
  is settled by those two clubs' games against each other, not by jumping
  to goal differential. This is the convention used by other leagues that
  do spell it out (for example MLB and the NFL) and the reading that keeps
  "games against each other among the tied clubs" literal. See
  `docs/DECISIONS.md`.
- **Head-to-head as a percentage.** The engine always compares
  points earned divided by points available (2 per counted game) among the
  tied clubs. For two clubs the counted games are the same for both, so this
  is identical to comparing points, as the text says. A club with no
  counted games against the rest of the group is treated as 50 percent.
- **Odd games.** The full schedule is known in advance, so `Schedule::new`
  marks each pair's odd game once: when two clubs meet an odd number of
  times, the first game (in schedule order) hosted by the club that hosts
  more of the meetings is excluded from head-to-head. The multi-club rule
  excludes the odd game of every pair in the group.
- **Exhausted chain.** If every step is equal, clubs keep config order. The
  official procedure would go to a draw or a tiebreak game, which a
  deterministic engine cannot reproduce. No tie in the division, wild-card,
  or conference standings of the validated seasons reaches this point.

### Playoff qualification, bracket, and home ice

- The top three clubs of each division qualify, plus the two best remaining
  clubs of each conference (wild cards WC1 and WC2, in wild-card order).
- In each conference, the division winner placed higher in the conference
  standings meets WC2 and the other division winner meets WC1. The second-
  and third-place clubs of each division meet. A wild card joins the bracket
  side of the division winner it plays.
- Round 2 pairs the two series on each division side, then the conference
  final, then the Stanley Cup Final.
- Series are best of seven with a 2-2-1-1-1 format. Home ice in every
  series goes to the club with the better regular-season record
  (`better_record`: more points, then the same tiebreak chain applied to the
  two clubs), not to the higher seed. A wild card with more points than the
  division winner it meets has home ice.

### Engine API (hot path)

- `Schedule::new(n_teams, &[(home, away)])`: chronological schedule with
  precomputed odd games.
- `SeasonAccumulator`: struct-of-arrays counters plus an n by n
  head-to-head points and games matrix. `apply(&game, &result)` is a few
  integer adds; `reset()` and `copy_from(&snapshot)` reuse the buffers.
- `rank_league(&acc, &cfg, &mut StandingsScratch) -> &Ranking`: sorts by
  points and runs the chain only on runs of tied clubs. All buffers live in
  the scratch value, so a call does no heap allocation.
- `playoff_bracket(&ranking, &acc, &cfg, &mut PlayoffBracket)` and
  `home_ice(&acc, &cfg, a, b)`.

## Gold test results

`crates/aftershock-core/tests/gold.rs` replays every regular-season result
of each validated season (from `tests/fixtures/gold/{season}.json.gz`, in
date then game-id order) and requires an exact match with the official NHL
final standings: every team's W, L, OTL, points, RW, ROW, GF, and GA; the
order within each division; the wild-card order in each conference; the
full conference and league order; the 16 playoff clubs; and the eight
first-round matchups including which club had home ice.

| Season | Chain | Teams | Results fed | Records match | Division order match | Wild-card order match | Playoff teams match | Round-1 matchups match |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2015-16 | nhl-2010 | 30 | 1230 | yes | yes | yes | yes | yes |
| 2016-17 | nhl-2010 | 30 | 1230 | yes | yes | yes | yes | yes |
| 2017-18 | nhl-2010 | 31 | 1271 | yes | yes | yes | yes | yes |
| 2018-19 | nhl-2010 | 31 | 1271 | yes | yes | yes | yes | yes |
| 2021-22 | nhl-2019 | 32 | 1312 | yes | yes | yes | yes | yes |
| 2022-23 | nhl-2019 | 32 | 1312 | yes | yes | yes | yes | yes |
| 2023-24 | nhl-2019 | 32 | 1312 | yes (1 adjustment) | yes | yes | yes | yes |
| 2024-25 | nhl-2019 | 32 | 1312 | yes | yes | yes | yes | yes |
| 2025-26 | nhl-2019 | 32 | 1312 | yes | yes | yes | yes | yes |

Full conference order and league order also match in all nine seasons.

### Surprise: the pulled-goalie overtime forfeit (2023-24)

The first run matched everything except Minnesota in 2023-24: the engine
had 88 points, 33 L, 10 OTL; the official line is 87 points, 34 L, 9 OTL.
On 2024-03-30 (game 2023021166) Minnesota lost 2-1 in overtime to Vegas
after pulling its goalkeeper for an extra attacker, and Jonathan
Marchessault scored into the empty net. Under the NHL regular-season
overtime rule, a club that pulls its goalkeeper in overtime and loses
forfeits the point it earned by reaching overtime, and the NHL records the
game as a regulation loss for it (Vegas keeps an overtime win: ROW, not
RW). The feed reports the game as plain `OT`, so nothing in the fixture
could reveal it. The engine models this as `EndType::OvertimeForfeit`, and
the gold test lists the game by id with sources
([Star Tribune](https://www.startribune.com/minnesota-wild-vegas-golden-knights-overtime-empty-net-nhl-filip-gustavsson/600355226),
[The Hockey News](https://thehockeynews.com/nhl/minnesota-wild/game-day/wild-fall-2-1-to-vegas-in-overtime-forfeit-point-for-pulling-goalie)).
It is the only such game in the validated seasons. The standings did not
change otherwise (MIN finished outside the playoffs either way), but the
league order between MIN and PIT did. Live ingestion should detect this
case from play-by-play (an overtime goal against a team with no goalkeeper
on the ice) and pass the forfeit end type.

### Ties the data exercises

Every tie in points within a division, a wild-card race, or a conference in
the nine seasons, and the step that settles it:

- **Regulation wins (nhl-2019):** 2021-22 NYR over TBL at 110 (RW 44 to 39
  although TBL has more ROW); 2022-23 PIT over BUF at 91, DET over WSH at
  80, EDM over COL at 109; 2023-24 WSH over DET at 91 for the last Eastern
  wild card (RW 32 to 27 although DET has more ROW and wins), NSH over LAK
  at 99, CGY over SEA at 81; 2024-25 BOS over PHI at 76, STL over CGY at 96
  for the last Western wild card; 2025-26 TBL over MTL at 106, PIT over PHI
  at 98, DET over CBJ at 92, UTA over ANA at 92, and a three-way wild-card
  tie at 86 settled STL, NSH, SJS by RW 33, 28, 27 although SJS has the
  most ROW and total wins.
- **ROW (nhl-2010):** 2015-16 CHI over ANA at 103 and ARI over WPG at 78;
  2016-17 BOS over TOR, NYI over TBL (although TBL has more wins), CGY over
  NSH (although NSH has more RW); 2017-18 WSH over TOR, MIN over ANA;
  2018-19 TOR over PIT, WPG over STL, DAL over VGK; 2015-16 DET over BOS at
  93 in the Atlantic (ROW 39 to 38 although BOS has more RW and wins).
- **Head-to-head (nhl-2010):** 2016-17 STL over SJS at 99 in the Western
  conference order: equal ROW (44), and STL won the season series although
  SJS had the better goal differential (+20 to +17). Removing the
  head-to-head step breaks this season in the gold test.
- **No RW step before 2019-20:** 2017-18 CBJ over NJD at 97 in the
  Metropolitan and the Eastern wild-card race, with equal ROW (39) although
  NJD has more RW (33 to 30). An RW step would reverse them.

No tie in the nine seasons involves three or more clubs reaching the
head-to-head step. The one head-to-head decision (STL and SJS met three
times; the first game in San Jose is the odd game) comes out the same with
or without the exclusion, because STL won all three meetings; the gold test
also passes with the exclusion disabled. So the restart rule and the
odd-game rule are pinned down by unit tests only.

## Monte Carlo

`aftershock_core::sim` (`crates/aftershock-core/src/sim/`).

### Inputs

A `Simulator` is built once from a `LeagueConfig` and the full-season
`Schedule` (every game in chronological order, home and away team index).
Each run takes a `SimInput`:

- `status[g]` for every game: `Final(GameResult)`,
  `Live { home_score, away_score, probs, lam_home_rem, lam_away_rem }`, or
  `Future { probs, lam_home, lam_away }`. Outcome order everywhere is
  `[home_reg, home_ot, home_so, away_reg, away_ot, away_so]`. `lam_*` are
  expected regulation goals (future) or expected remaining regulation goals
  (live).
- `tie_theta`: multiplier on the regulation-tie cells of the scoreline
  tables.
- `playoff_p` (`n x n`): `playoff_p[i][j]` is the probability that team `i`
  beats team `j` in a playoff game hosted by `i`.
- `focus_games`: schedule indices whose outcome is recorded per simulation
  (live games plus the next seven days).
- `n_sims`, `seed`.
- `team_sigma`: per-simulation team strength noise (see below); 0
  disables it.

### Preparation (once per run)

- Final games are applied once to a base `SeasonAccumulator`. Games played
  and head-to-head game counts of the remaining games do not depend on
  outcomes, so they are added to the base too.
- Each remaining game gets an `OutcomeCdf`: five `f32` boundaries over the
  fixed 6-outcome order, built from the normalized probabilities. The last
  outcome with positive mass ends at exactly 1.0, so a zero-probability
  outcome can never be drawn.
- Each remaining game gets a `ScoreTable`: Poisson(`lam_home`) x
  Poisson(`lam_away`) over 0..=10 goals per side, regulation-tie cells
  multiplied by `tie_theta`, split into three classes (home ahead, away
  ahead, tied) with a conditional `f32` CDF inside each class.

### One simulation

1. For every remaining game, one uniform from stream `Outcome` picks the
   outcome by inverse CDF (the number of boundaries at or below it). The
   outcome is applied branch free: each outcome is a fixed delta vector
   `[w, l, otl, rw, row, points]` per team plus head-to-head points, added
   into a 32-team scratch and flushed into the accumulator once.
2. Scorelines (GF and GA) are sampled only if some tie could reach a goals
   step of the tiebreak chain: two clubs level in points and in every
   earlier non-head-to-head step (for `nhl-2019`: GP, RW, ROW, W). If no
   such pair exists, no standings comparison and no home-ice comparison can
   look at goals, so skipping them cannot change any output. Because the
   scoreline uniform is keyed by game, sampling them later gives exactly
   the same goals as sampling them up front; a unit test checks lazy and
   eager runs are identical. On the synthetic 2026-27 benchmark about 4
   percent of seasons need the goals pass.
3. `rank_league`, `playoff_bracket`, then the playoffs (below).
4. Tallies: per-team integer counts for each metric, a 1-point histogram
   of final points, the six-slot seed distribution, and the per-simulation
   records.

Work is split into chunks of 64 simulations. With the `parallel` feature
(native) chunks run on rayon, each worker thread owning its scratch
(accumulator, `StandingsScratch`, bracket, outcome buffer), so the hot loop
allocates nothing. Tallies are integers merged by addition, so the result
does not depend on how chunks are scheduled. Without the feature (wasm) the
same chunk code runs serially.

### Team strength uncertainty

With fixed per-game probabilities, the only randomness in a simulated
season is the bounce of individual games. Over 84 games those bounces
mostly cancel out, so a team the model rates as clearly strong makes the
playoffs in nearly every simulation and preseason odds come out extreme
(99.9 percent). That overstates what we know: the model's rating of a team
is itself uncertain, and if a team is really better or worse than rated,
that error shows up in every one of its games at once, not independently
game by game.

`team_sigma` adds that uncertainty. In each simulation, every team draws
one strength shift `delta[t] = team_sigma * Phi^-1(u)`, a normal draw on
the log-odds scale, where `u` comes from the counter RNG keyed by `(seed,
sim, team, Stream::TeamStrength)`. That stream is new, so no existing
outcome, scoreline, live-goal, or playoff draw changes. The inverse normal
CDF is Acklam's algorithm in `f64` (relative error below 1.2e-9), with `u`
kept strictly inside (0, 1).

Within that simulation, every future game (not final, not live) is tilted
by the two teams' shifts. With `ph = p0 + p1 + p2` the home win total, the
new home win total is `ph' = sigmoid(logit(ph) + delta[home] -
delta[away])`. The three home outcomes are scaled by `ph' / ph` and the
three away outcomes by `(1 - ph') / (1 - ph)`, so the split between
regulation, overtime, and shootout within each side is kept. The same
`Outcome` uniform is then inverted against the tilted boundaries.
Scorelines are still sampled inside the sampled class. Playoff games use
`p' = sigmoid(logit(playoff_p[i][j]) + delta[i] - delta[j])`. Live games
are not tilted: their probabilities already reflect the game in progress.

In one simulation a team might play like a 0.2 log-odds better team all
season, in another like a 0.2 worse one, which is what spreads out
season-long results. In the unit test with sharpened game probabilities
and `team_sigma = 0.35`, the strongest team's playoff odds fall from
100.00 to 99.15 percent and the weakest team's rise from 0.00 to 0.20
percent, and the spread of every team's odds around one half shrinks.

Properties kept:

- `team_sigma = 0` takes the original code path. A fingerprint of a fixed
  mixed final, live, and future scenario (every count, histogram bin, and
  per-simulation record), recorded before the feature existed, still
  matches (`tests/sim_fingerprint.rs`).
- With noise on, results are identical for any thread count, and changing
  one game's probabilities still never changes any other game's sampled
  outcome, because the shifts are keyed by team, not by any game's inputs.
  A property test recomputes every tilted outcome independently from the
  uniforms.
- Reweighting and conditional tables are unchanged. Reweighting stays
  exact for live games, which are never tilted. For a future focus game
  with noise on, the recorded "old" probabilities are the untilted ones,
  so reweighting it is an approximation.

Cost: the shifts are computed once per simulation per team (32 `exp`
calls), and each tilted game adds one division and a few multiplies. On
the benchmark below, `team_sigma = 0.15` adds about 9 percent single
threaded (28.2 to 30.7 microseconds per season) and about 14 percent on 8
threads (median 132 to 150 ms, p95 161 to 184 ms for 20,000 seasons,
measured under a load average near 10).

### Scorelines and live conditioning

After the outcome class is known, the regulation scoreline is drawn inside
that class from the game's `ScoreTable` with a second uniform (stream
`Scoreline`). An overtime win is the tied regulation score plus one goal
for the winner; a shootout win is the tied score plus one goal for the
winner in GF (the standings rule), with `EndType::Shootout`.

For a live game the table is over goals still to be scored, 0..=10 per
side from `lam_*_rem`, and each cell is classified by the final regulation
result (current score plus added goals). Tie cells (those ending level) get
`tie_theta`. The added goals are drawn inside the sampled class with a
uniform from stream `LiveGoals`. If the sampled class has no mass in the
table (for example a 4-0 game with no time left and a sampled away win),
the smallest-goal cell consistent with the class is used: the trailing side
scores just enough to tie or lead.

`tie_theta` scales every tied cell equally, so it changes class masses but
never the conditional shape inside a class. Because the class itself comes
from the 6-way probabilities, `tie_theta` currently has no effect on the
sampled results; it is accepted so the tables match the scoreline model if
they are later used to derive class probabilities.

### Playoff simulation

After each regular season: rank, build the bracket with `playoff_bracket`
(division winner with the better conference standing meets WC2), then play
every series game by game. Series slots per simulation are round 1
`0..8` (four per conference in bracket order), round 2 `8..12`, conference
finals `12..14`, and the final `14`. Each series uses a `KeyedRng` keyed by
`(seed, sim, slot, Stream::Playoff)`, so playoff randomness is independent
of regular-season game indices. Home ice goes to the better regular-season
record (`home_ice`), the config's 2-2-1-1-1 pattern (`HHAAHAH`) picks the
host of each game, and the host wins with probability
`playoff_p[host][guest]`. First to four wins.

### Outputs per team

`p_playoffs`, `p_division` (first in division), `p_top3_div`,
`p_wildcard`, `p_presidents` (first in the league), `p_conf_first`,
`p_round2` (won round 1), `p_conf_final` (won round 2), `p_final` (won the
conference final), `p_cup`, `p_last` (last in the league), `exp_points`, a
points histogram (1-point bins, counts), and a seed distribution over
`div1, div2, div3, wc1, wc2, out`.

### Per-simulation records

For every simulation the result keeps the outcome class (0..5) of every
focus game, a `u32` playoff bitmask, a `u32` division-winner bitmask, and
the Cup winner index. Focus games that are already final are recorded with
their actual outcome and one-hot probabilities.

### Conditional tables

`SimRecords::conditional()` counts, for every focus game `f` and outcome
`k`: the simulations with that outcome, and per team how many of those made
the playoffs and won the Cup. Counts are exposed (so callers can compute
binomial standard errors, `sqrt(p (1 - p) / n_fk)`) together with helper
probabilities.

### Importance reweighting

`SimRecords::reweight(games, new_probs)` weights every simulation by the
product over the given focus games of `P_new(k) / P_old(k)` for its sampled
outcome `k`, where `P_old` is what the game was sampled with. It returns
reweighted `p_playoffs`, `p_division`, and `p_cup` plus the effective
sample size `(sum w)^2 / sum w^2`. This updates odds for a changed live win
probability without re-running; when the effective sample size falls too
low, re-run instead.

### Bindings

Python (`crates/aftershock-py`, module `aftershock_core`, built with
`cd services && uv run maturin develop --release -m ../crates/aftershock-py/Cargo.toml`):

- `Simulator(config: str, home: uint16[n], away: uint16[n])`; `.teams`,
  `.n_games`.
- `Simulator.run(status uint8[n] (0 future, 1 live, 2 final), home_goals
  uint8[n], away_goals uint8[n], end uint8[n] (0 REG, 1 OT, 2 SO, 3 OT
  forfeit), live_home uint8[n], live_away uint8[n], probs float32[n, 6],
  lam float32[n, 2], playoff_p float32[t, t], tie_theta float, n_sims int,
  seed int, focus uint32[f], team_sigma: float = 0.0) -> SimResult`
  (`team_sigma` is keyword with default 0.0). The GIL is released while
  simulating.
- `SimResult`: `metrics` (dict name -> float64[t]), `points_hist`
  (int64[t, max_points + 1]), `seed_dist` (float64[t, 6]), `seed_slots`,
  `duration_ms`, `n_sims`, `focus_outcomes` (uint8[n_sims, f]),
  `playoff_mask`, `division_mask`, `cup_winner`, `prob(name)`,
  `conditional()` -> dict (`outcome_counts` int64[f, 6], `playoffs_counts`
  int64[f, 6, t], `cup_counts` int64[f, 6, t]), `reweight(games uint32[k],
  new_probs float32[k, 6])` -> dict (`p_playoffs`, `p_division`, `p_cup`
  float64[t], `ess` float).
- `standings(config, home, away, home_goals, away_goals, end)` -> dict of
  arrays (`w, l, otl, points, rw, row, gf, ga, league_rank,
  conference_rank, division_rank, wildcard_rank, qualified`, plus `teams`).
- `config_teams(config)`, `METRICS`.

WASM (`crates/aftershock-wasm`, `wasm-pack build crates/aftershock-wasm
--release --target web`): `simulate(json_state: string, n_sims: number,
seed: bigint) -> string`. Input and output JSON are documented at the top
of `crates/aftershock-wasm/src/lib.rs`. The optional input field
`"team_sigma"` (default 0) turns on team strength noise. Each output team has every metric
above, `seed_dist` as an object keyed by slot, and `points_hist` (counts
indexed by points, trailing zeros trimmed). Single threaded. For the same
input and seed, the native and wasm outputs were checked to be
byte-identical JSON.

## Common random numbers

Every random number in a run is a pure function of `(seed, sim, game,
stream)`: a hash of those four numbers, not the next value of a generator
that walks through the season. Simulation 7's draw for game 500 is the same
number no matter which thread runs it, whether games 1 to 499 were final or
future, or what their probabilities were.

That is what makes before/after comparisons nearly noise free. When a game
ends or a probability moves, the new run reuses the same seed, so every
other game in every simulation plays out exactly as before. The only
simulations that change are the ones where the changed game now lands on a
different outcome, which are exactly those whose uniform falls between the
old and new CDF boundary. A 0.02 change in one game's home-win probability
flips about 2 percent of simulations for that game and leaves the other 98
percent identical, so the odds delta reflects that game's effect instead of
two independent samples of Monte Carlo noise.

The property tests (`crates/aftershock-core/tests/sim_props.rs`) check:

1. The result is identical (every count and every per-simulation record)
   for 1, 2, 3, and 8 rayon threads and the serial path, and across repeated
   runs; the same tests pass with the `parallel` feature off.
2. Changing one game's probabilities to arbitrary new values never changes
   the sampled outcome of any other focus game in any simulation.
3. Moving probability mass between two adjacent outcomes of one game flips
   exactly the simulations whose uniform (recomputed independently from the
   RNG) lies between the old and new boundary, in the expected direction,
   and each sampled outcome equals the inverse CDF of its uniform.

A unit test also checks that the fast season path (branch-free deltas, lazy
goals) produces the same accumulator as applying each sampled result
through the plain `SeasonAccumulator::apply`.

## Benchmarks

Machine: Apple M1, 8 cores (4 performance, 4 efficiency), 8 GB, macOS 26.2.
Measured 2026-09-30 while other workloads were running on the machine (load
average 6 to 11 from parallel backfill jobs), so these numbers are
conservative. Workload: a synthetic balanced 2026-27 schedule (32 teams,
84 games each, 1,344 games), every game future from opening night, plus
full playoffs, 112 focus games.

| Target | Threads | Sims | Games simulated | Median | p95 | Per sim | Harness |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Native (rayon) | 8 | 20,000 | 1,344 | 105 ms | 123 ms | 5.3 us | `examples/sim_timing.rs`, 50 runs |
| Native (serial) | 1 | 2,000 | 1,344 | 50 ms | 54 ms | 25 us | same, `RAYON_NUM_THREADS=1` |
| Native (rayon), `team_sigma = 0` rerun | 8 | 20,000 | 1,344 | 132 ms | 161 ms | 6.6 us | `sim_timing -- 20000 40 0`, load near 10 |
| Native (rayon), `team_sigma = 0.15` | 8 | 20,000 | 1,344 | 150 ms | 184 ms | 7.5 us | `sim_timing -- 20000 40 0.15`, same session |
| Native (serial), `team_sigma = 0.15` | 1 | 2,000 | 1,344 | 61 ms | 70 ms | 30.7 us | same session (28.2 us with 0) |
| WASM (node, proxy) | 1 | 10,000 | 1,344 | 275 ms | 306 ms | 27.5 us | `bench/node_bench.mjs`, 20 runs |
| WASM (node, proxy) | 1 | 10,000 | 672 (mid-season) | 146 ms | 151 ms | 14.6 us | same |

Targets: native 20,000 full seasons under 250 ms at p95 (met, 123 ms);
WASM 10,000 remaining-season simulations under 2 s (met, 306 ms from
opening night). Criterion (`cargo bench -p aftershock-core --bench sim`)
reports 106 ms for the 20,000-simulation run and 22.9 ms for 1,000 serial
simulations.

The WASM figure comes from the wasm-pack `--target nodejs` build run in
Node 25 (V8), a proxy for desktop Chrome, which uses the same engine and
the same single-threaded wasm code; browser timings will differ somewhat
with the browser and its JIT tiering. The run includes JSON parsing, table
building, and output serialization.

Reproduce:

```
cargo run --release -p aftershock-core --example sim_timing -- 20000 50
wasm-pack build crates/aftershock-wasm --release --target nodejs --out-dir pkg-node
node crates/aftershock-wasm/bench/node_bench.mjs 10000 20
```
