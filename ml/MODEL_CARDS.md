# Model cards

Every number below was measured by the training code in
`services/aftershock/ml/` and is stored in `ml/reports/*.json`. Plots are in
`ml/reports/*.svg` and shown on the site's methodology page. All splits are by
time: no model is ever trained on games after the ones it is evaluated on.

Retrain everything with `make train` (or `aftershock train all`).

## Expected goals (`xg-1.0.0`)

**What it predicts.** The probability that an unblocked shot attempt (shot on
goal, missed shot, or goal) becomes a goal.

**Data.** Every regular-season and playoff game from 2015-16 through 2025-26
in the NHL play-by-play feed. Rows exclude blocked shots (their coordinates
mark the block, not the shot), shootout attempts, and penalty shots. No
unblocked shot in the 2025-26 sample had null coordinates; rows that do are
dropped.

**Features.** Distance and angle to the net (from coordinates normalized so
the shooter attacks toward x = 89), shot type, rebound (any attempt by the
same team in the previous 3 seconds), rush (the previous event was in the
neutral or defensive zone within 4 seconds), seconds since and distance from
the previous event, previous event type, whether that event was by the same
team, manpower from the shooter's side, empty net against, score state capped
at plus or minus 3, period, and home or away. No shooter or goalie identity.

**Model.** LightGBM binary classifier. Baseline: logistic regression on
distance and angle.

**Split.** Train 2015-16 to 2023-24 (1,006,942 shots), validate 2024-25
(119,924, early stopping at 514 trees), test 2025-26 (119,319).

**Test results (2025-26).**

| Model | Log loss | Brier | AUC | ECE |
|---|---|---|---|---|
| LightGBM | 0.2283 | 0.0619 | 0.755 | 0.0134 |
| Distance and angle logistic | 0.2452 | 0.0650 | 0.688 | 0.0161 |

Goal rate in the test season: 7.18 percent. Plot: `xg_reliability.svg`.

**Penalty shots** use a constant rate measured on the training seasons:
127 goals on 412 attempts, 30.8 percent.

**Known limitations.** The highest-probability decile is somewhat
overpredicted in 2025-26 (about 0.33 predicted against 0.25 observed in the top
bin). There is no pre-shot movement or screen information, which the feed
does not provide. A backtest-only variant, `xg-bt-1.0.0`, trained on 2015-16
to 2019-20, is used wherever a later model is evaluated on 2021-22 onward, so
no evaluation uses xG fit on its own games.

## Team strength and pregame probabilities (`strength-1.0.0`)

**What it predicts.** The six-way outcome of a game (home or away, in
regulation, overtime, or a shootout), expected goals, and a regulation
scoreline table.

**Model.** Each team has offense and defense ratings on a log scale. Expected
regulation goals are league average times exp(offense + opponent defense),
times home ice for the home side, adjusted for back-to-backs. After every game,
both ratings move toward the observed performance (a blend of goals and xG per
60 minutes) with exponential decay by game. A new season starts from the
previous season's ratings, optionally shrunk toward the mean. Regulation goals
are Poisson with the diagonal inflated so the tie rate matches history.
Overtime winners come from a sigmoid of the strength ratio shrunk toward 0.5;
the share of overtimes reaching a shootout and the home shootout win rate are
measured.

**Tuning.** Coordinate descent on three-way log loss over the regular seasons
2016-17 to 2020-21 (2015-16 warms up the ratings), then the tie inflation is
set by bisection so the mean predicted regulation-tie rate equals the observed
22.7 percent.

Chosen parameters: goal and xG blend 0.5, half-life 22 games, season
regression 0.0, home ice 1.10, back-to-back penalty 0.04, overtime slope 1.5
with shrink 0.5, shootout share of overtimes 0.347, home shootout win rate
0.530, tie inflation 1.52.

**Backtest.** Every regular-season game 2021-22 to 2025-26 (6,560 games),
predicted with ratings as of that morning, using `xg-bt-1.0.0`.

| Model | 3-way log loss | 2-way log loss | Accuracy |
|---|---|---|---|
| Team strength | 1.0362 | 0.6628 | 59.4% |
| Season-to-date points percentage | 1.0551 | 0.6803 | 56.9% |
| Home ice only | 1.0667 | 0.6905 | 53.7% |

Calibration of P(home win): ECE 0.020 (`strength_reliability.svg`). The
weakest season was 2025-26 (54.8 percent accuracy).

**Known limitations.** The tuning chose no season-to-season regression and a
fairly strong home-ice factor; a wider grid moved the backtest log loss by
less than 0.001. Ratings ignore rosters, injuries, and goaltender starts. For
season simulations the ratings are shrunk further (see the simulator card).

## In-game win probability (`wp-1.0.0`)

**What it predicts.** The probability that, at the end of regulation, the home
team is ahead, the away team is ahead, or the game is tied, from any moment of
a game. Overtime and the shootout are added analytically.

**Training rows.** For each game, the state after every regulation event plus
a 30-second grid, weighted so each game counts equally: 5,046,450 training
rows, 614,990 validation, 604,698 test.

**Features.** Score differential, seconds left in regulation, period,
skater difference and manpower state, seconds left on the current power play
(from penalty events), both goalies in or out, the pregame probabilities from
the strength model as of that date, cumulative xG differential, and total
goals. The xG feature was kept because it lowered validation log loss (0.76172
with it, 0.76199 without).

**Model.** An ordinal pair of LightGBM binary classifiers, P(home does not
lose) and P(home wins), each constrained to increase with the score
differential, so win probability is monotonic in the score by construction.
Both start from an analytic baseline (boosting `init_score`): remaining goals
are Poisson for each side at scoring rates measured for the current manpower
and goalie state (applied for the power-play clock or at most two minutes,
then 5v5), so the final margin is a Skellam variable. The trees learn
corrections. Each classifier is Platt-scaled on the validation season.

**Overtime and shootout.** Regular-season overtime uses competing exponential
scoring clocks with the 3-on-3 goal rate implied by the measured shootout
share (0.339 of 2,438 overtimes, 2015-16 to 2023-24), split by team strength;
leftover probability goes to the shootout. The shootout is an exact dynamic
program over the remaining rounds with the measured conversion rate (1,869
goals on 5,980 attempts, 31.3 percent), including early clinches and sudden
death.

**Test results (2025-26), weighted log loss.**

| Minutes elapsed | Ordinal LightGBM | Multinomial logistic | Score and time table |
|---|---|---|---|
| 0 to 10 | 1.051 | 1.053 | 1.058 |
| 10 to 20 | 0.995 | 0.988 | 0.999 |
| 20 to 30 | 0.918 | 0.909 | 0.921 |
| 30 to 40 | 0.794 | 0.790 | 0.797 |
| 40 to 50 | 0.654 | 0.651 | 0.654 |
| 50 to 55 | 0.489 | 0.499 | 0.486 |
| 55 to 58 | 0.354 | 0.389 | 0.352 |
| 58 to 60 | 0.137 | 0.245 | 0.136 |
| **All** | **0.7976** | 0.8010 | 0.8002 |

Brier: 0.4719, 0.4739, 0.4737. Class ECE: home 0.032, away 0.018, tied 0.032.
Plots: `wp_reliability.svg`, `wp_logloss_by_time.svg`.

**Sanity properties** (unit tests in `services/tests/test_wp_sanity.py`, run
against this artifact): up 3 with 5:00 left gives P(home regulation win) above
0.98; tied with 0:01 left gives P(tied after regulation) above 0.97; up 1 with
the opponent's net empty for the final minute is below up 1 at even strength;
probabilities sum to 1; monotonic in score differential.

**Known limitations.** Gains over simple baselines are small; most of the
signal in hockey win probability is score and clock. The multinomial baseline
is slightly better in the middle of games. Penalties in overtime (4-on-3) are
not modeled. The class calibration errors of about 0.03 come mostly from the
pregame features in a season (2025-26) where the strength model was at its
weakest.

## Season simulator calibration (`sim-1.0.0`)

**What it controls.** How much team ratings are shrunk toward the mean when
predicting future games inside a season simulation. Current ratings are noisy
estimates, and a season simulation compounds any overconfidence across
dozens of games.

**Tuning.** Season backtests on 2016-17 to 2018-19, simulating as of October 1
(before the season) and the 1st of each month November to April, using only
results and ratings known that morning. Chosen: shrink 0.5 before the season,
easing to 0.7 once 15 percent of the season is played.

**Backtest (2021-22 to 2025-26, 4,000 simulations per checkpoint).**
P(playoffs) Brier across 7 checkpoints per season:

| Checkpoint | Simulator | Simulator without shrink | Points % baseline |
|---|---|---|---|
| October 1 | 0.192 | 0.212 | 0.277 |
| November 1 | 0.151 | 0.156 | 0.198 |
| December 1 | 0.119 | 0.124 | 0.143 |
| January 1 | 0.107 | 0.111 | 0.126 |
| February 1 | 0.090 | 0.090 | 0.117 |
| March 1 | 0.077 | 0.076 | 0.114 |
| April 1 | 0.032 | 0.032 | 0.098 |
| **All** | **0.110** | 0.114 | 0.153 |

The points-percentage baseline is a logistic regression on points
percentage to date (and its interaction with the month), fit on the tuning
seasons. Plot: `backtest_reliability.svg`. Before the season, odds only
modestly beat a coin flip (Brier 0.25), which is the honest state of preseason
forecasting.
