# Roster Lab: design

Status: agreed in conversation with the owner on 2026-10-24 and 2026-10-27,
pending the owner's read of this document. Answers that are my calls rather
than the owner's are marked "(my call)".

## Why

Fans argue about trades, injuries, and signings constantly: "if we got
Hughes we'd make it", "losing Matthews kills us". Puckquake already turns
any change in the season into playoff and Cup odds; the What-If Lab does it
for game results. The Roster Lab does it for rosters: move players between
teams, take a player out, or add one, and see how far it moves each team's
odds. The owner's reference is hockeystats.com's Roster Builder.

The moment it is for (owner): all three of a trade rumour, an injury, and
"what if my team signed X". The thing people should screenshot and post
(owner): both teams' odds before and after, and the impact each player
makes.

Success: a fan can try a rumoured trade on a phone in under a minute, get a
believable answer, and share it.

## Goals

- Pick a team (or two) and move players: trade between two teams, remove a
  player (injury), or sign a free agent. An injury has a length the fan
  chooses (owner's decision; see "Moves"). A player on another team can
  only be had by trading for him (owner's decision, 2026-10-27, after
  comparing hockeystats and PuckGM; not a sandbox).
- Rerun the rest of the season and show, for each team changed, playoff odds
  and Cup odds before and after, plus projected points, and the whole
  league's table before and after with the changed teams highlighted (owner's
  decision, following hockeystats' projections table).
- Show each moved player's worth ("about +X goals over the rest of the
  season" for his new team), so a result can be traced to who caused it.
- Share it like everything else: one share menu (Post on X, Share, Copy
  link), a card with both teams' before and after, and a link that opens
  that exact trade.

## Non-goals (first version)

- No line editing or ice-time sliders. Minutes are assigned automatically
  (my call, which the owner accepted: quicker on a phone and harder to game
  into fantasy numbers; line editing can come later if people ask).
- No salary cap, contracts, or cap legality (a separate data job).
- No combining a trade with What-If game picks in one scenario.
- No building a team from scratch (the owner chose "swap into a real team").
- No playoff-series simulation changes beyond what the season simulator
  already does.

## Anti-goals (failure even if it works)

- Unrealistic results (the owner's main worry): a depth trade swinging a
  team 20 points, a team reaching 99% by adding one star, or numbers that
  cannot be explained.
- A result that changes from one visit to the next for the same trade
  (randomness must be pinned, like the What-If Lab's seed).
- Slowing the live map or the worker on game nights.

## Moves

- **Trade:** players swap between two teams for the rest of the season.
- **Injury:** the fan picks how long he is out: 1 week, 2 weeks, 4 weeks,
  6 weeks, 8 weeks, or the rest of the season (owner's decision; the list of
  lengths is my call). Games inside that window use the team without him;
  games after it use the team with him back. Lengths are counted in calendar
  days from today, so "4 weeks" covers the team's games in the next 28 days.
- **Signing:** only free agents can be signed: players with NHL minutes since
  2024-25 who are on no NHL roster now (owner's decision). Players with no
  NHL minutes are left out, since the model has no value for them (my call).
  A player on another team can only be traded for, and that team gets
  players back (owner's decision).
- **The "before" roster** is who has been dressing lately: players in the
  team's lineup in its recent games (my call). A player already out of the
  lineup (injured, scratched) is not in it, and taking him out changes
  nothing; the team rating already reflects his absence, so counting it again
  would double it. Bringing such a player back is not in the first version.
- **Offseason:** the Roster Lab works during the regular season only; in the
  offseason the page says it returns when the season starts (my call).
  Projecting next season for summer signings is a separate later job.

## How player value works

Our forecast rates teams, not players: each team has an offense and a
defense rating on a log scale, with expected regulation goals
`league_avg * exp(off_home + def_away) * home_ice * fatigue`
(`services/aftershock/ml/strength.py`). Because that scale is goals, a
player's impact in goals per game converts to a rating change directly.

1. **Player impact, the same family of method hockeystats uses.** From
   every shot since 2024-25 (play-by-play with our xG model) and the NHL
   shift charts (cached in `data/raw/shiftcharts`, 2024-25 onward), find
   who was on the ice for each shot, then fit each skater's isolated
   impact on expected goals for and against per 60 minutes at even
   strength with a ridge regression over shifts (RAPM), using the last two
   seasons. Add finishing (goals above expected on his own shots) and, for
   goalies, goals saved above expected per shot. Shrink toward zero for
   players with few minutes.
2. **Minutes.** Each player's share of his team's ice time is his observed
   share over the last two seasons (even strength and power play). A player
   who moves keeps roughly his share on the new team; the players below him
   at his position lose minutes in order (a traded-in top-line forward
   pushes the team's lowest-minute forward out of the lineup). A removed
   player's minutes go to the next players at his position. Goalies: the
   starter is whoever has the larger share; a new goalie takes the starter's
   share only if his projected value is higher, otherwise the backup's.
3. **Team change.** The team's change in goals for and against per game is
   the sum over players of (impact x minutes) after the move, minus the
   same before. Convert: `d_off = ln(1 + dGF / league_avg)`,
   `d_def = ln(1 + dGA / league_avg)`. Only the change is applied, to the
   team's real current rating, so every team starts from the real forecast.
4. **Rest of the season.** Recompute pregame probabilities for that team's
   remaining games with the changed ratings (the existing strength model),
   game by game, so an injury's window uses one rating and the games after
   it another. The change is applied after the forecast's usual
   early-season shrinkage in `build_inputs`, and it also reaches the playoff
   series odds (`playoff_matrix`), so Cup odds move as well as playoff odds
   (my call). Then run the season simulator (now in the api image) on those
   games, 10,000 seasons with a fixed seed, before and after.

Realism checks the builder runs before launch and writes into the method
page:
- The sum of player impacts on each real roster should track real team
  goal rates (a correlation check, reported).
- Spot checks: trading a top-five player away and back, a fourth-liner for
  a fourth-liner (should be near zero), a starting goalie swap.
- Targets (my call, from public player-value models): a top-five skater is
  worth about 8 to 10 standings points over a full 82 games; a fourth-line
  swap under 1 point; an injury costs in proportion to the games he misses
  (a four-week injury to a top-five skater, about 13 games, costs about 1.5
  points). These are tests that must pass before launch.
- A cap on any single move's rating change, if the spot checks show
  outliers, documented with the reason.

## The page

- Its own tab in the site menu, "Roster Lab", at `/roster-lab`, next to the
  What-If Lab, which stays as it is (owner's decision, 2026-10-28: the two do
  different jobs, and mixing picks with trades would hide which one moved
  the odds). The phone menu already scrolls sideways; the new tab must fit
  that row cleanly.
- Team pages get "Try a trade" linking to the Roster Lab with that team
  loaded. The What-If Lab and the Roster Lab link to each other (my call).
- Flow: choose up to two teams; each shows its roster (forwards, defence,
  goalies) with each player's worth; tap a player to send him to the other
  team or remove him; "Sign a free agent" searches the free agents. Results
  update after each change: per team, playoff odds and Cup odds before and
  after, projected points, and a one-line "why" (the biggest contributors);
  below that, the league table before and after, changed teams highlighted.
- Phones: the same pattern as the What-If Lab (one column, sticky summary
  with the headline change, share as an icon).
- Roster shape stays normal: at most 14 forwards, 8 defence, and 3 goalies
  per team, and a team keeps at least 12, 6, and 2.

## Sharing

- The shared link encodes the moves (short ids like What-If scenarios,
  saved in the existing `scenarios` style or a sibling table).
- The card (server-drawn, 1200 by 630, like the game card): the teams, the
  players who moved, and each team's playoff odds before and after. It is
  also the link preview.
- A shared link reruns with current data when opened, like What-If links;
  the post text keeps the numbers from when it was shared (my call).
- Post text example: "TOR gets Hughes, VAN gets Knies: TOR 41% to 52%, VAN
  38% to 31% to make the playoffs. Try your own on Puckquake:".

## Constraints

- Python services and the api on the Oracle VM (1 CPU); the player model is
  fitted offline (a job, like ratings) and stored, never fitted per
  request. A trade request runs two simulations of 10,000 seasons (about
  0.4 s each on the VM) and is cached by its moves.
- The model refits nightly or weekly as the season goes on (builder's
  choice), on the worker, outside game hours.
- Code names use `aftershock`; visible text says Puckquake.
- Tests in the existing style (pytest, Vitest, Playwright); the realism
  checks above are tests where they can be.
- Repo commit rules apply.

## Left to the builder

- RAPM details: ridge penalty (chosen by cross-validation), stint
  construction, score and venue adjustments, power-play handling, and the
  minutes threshold for shrinkage.
- Storage shape for player values and saved trades.
- Whether the simulation runs on the server (likely, since only the
  server has the strength model) or in the browser with recomputed
  probabilities sent down.
- Exact layout, within the page notes above.
- Refit schedule.
