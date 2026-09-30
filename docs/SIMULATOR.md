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
  deterministic engine cannot reproduce; this has never been needed in the
  validated seasons.

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
| 2024-25 | nhl-2019 | 32 | 1312 | yes | yes | yes | yes | yes |
| 2025-26 | nhl-2019 | 32 | 1312 | yes | yes | yes | yes | yes |

Conference and league order also match in every season above.

Ties in points that the data exercises (all within the same grouping):

- 2025-26: TBL and MTL at 106 in the Atlantic (RW 40 to 34); PIT and PHI at
  98 in the Metropolitan (RW); DET and CBJ at 92 for the second Eastern wild
  card race order (RW); STL, NSH, and SJS at 86, a three-way wild-card tie
  settled by RW 33, 28, 27 even though SJS has the most ROW and total wins,
  which confirms RW is checked before ROW and W.
- 2024-25: BOS and PHI at 76 (RW 26 to 21); STL and CGY at 96 for the last
  Western wild card (RW 32 to 31), which decided a playoff spot.

## Monte Carlo

Added with the simulator.

## Common random numbers

Added with the simulator.

## Benchmarks

Added with the simulator.
