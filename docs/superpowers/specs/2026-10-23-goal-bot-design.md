# Puckquake goal bot for X: design

Status: agreed in conversation on 2026-10-23, pending the owner's read of
this document.

## Why

Hockey fans scroll X during games. Puckquake already measures, seconds after
every NHL goal, how far that goal moved every team's playoff odds, and draws
it as a share card. The bot puts that measurement in the feed where fans
already are: one post per goal, with the story and the card, so a fan sees
the impact without visiting the site. The owner's hope is that big goals
occasionally travel on their own and bring people to the site and the
account.

Success: every goal of the night is posted within seconds, reads correctly,
and costs about what was budgeted. Growth is a bonus, not a requirement.

## Goals

- One post for every goal in NHL regular-season games, as soon as
  Puckquake measures it. Playoff games come in a follow-up (see Playoffs,
  later).
- Each post explains the goal in plain words and shows its playoff effect
  without the reader clicking anything.
- Mistakes are fixed visibly and cheaply: overturned goals are deleted,
  changed credit gets a one-line reply.
- Cost stays predictable, with a hard cap.

## Non-goals

- No links in posts (see Cost).
- No replies to other users, no likes, follows, or engagement automation.
- No AI-written text. Every phrase comes from fixed rules over the goal's
  data, so nothing can be invented.
- No win-probability lines. The post is about the playoff race, which is
  what makes Puckquake different.
- No preseason or playoff goals in this version.
- No posting history backfill. The bot starts from the first goal after it
  is switched on.

## Anti-goals (failure even if it technically works)

- A burst of stale posts after an outage, a restart, or a catch-up run.
- A post that states something false (wrong scorer that is never corrected,
  wrong odds direction, a goal that was overturned still standing).
- A surprise bill.
- The bot delaying the live map or the worker in any way.
- Looking like an official NHL account.

## The account

- Name: **Puckquake**. Handle: **@puckquake**, matching the domain
  puckquake.com (not yet bought; the site is still on
  aftershock-fawn.vercel.app). If @puckquake is taken, the owner picks a
  fallback when creating the account.
- A new account, separate from the owner's personal one, labelled as
  automated on X and linked to the owner's personal account as its manager.
- Bio (my call, owner can edit): "Every NHL goal is an earthquake. A post
  for each one, showing how far it moved the playoff race. Automated · Not
  affiliated with the NHL · puckquake.com" (until the domain exists, the
  Vercel address).
- The owner creates the account, applies for X developer access, buys the
  first credits, and puts the keys in the VM's `.env`. The builder writes
  those steps into `docs/DEPLOY.md`.

## A post

Text, exactly this shape (agreed with the owner on a mockup):

```
🚨 Troy Stecher breaks a 4-4 tie with 28 seconds left
NYR 4, TOR 5 · 3rd period
Magnitude 6.0, the biggest goal of the night

Playoff odds
Leafs: 41.2% → 42.7%
Rangers: 38.0% → 31.8%

Assists: Rielly, Duhaime
#LeafsForever #NYR
```

Line by line:

1. 🚨, the scorer's full name, and the moment phrase (below).
2. Score after the goal, away team first as on the card, then the period:
   "1st period", "2nd period", "3rd period", "OT", or "SO" for a shootout
   winner. For a shootout winner the score line shows the game's final score
   (the winner gets the extra goal, as the NHL reports it); the builder
   checks what the stored `score_after` holds and adjusts.
3. "Magnitude X.X", plus a context clause only when it is true (below).
4. Blank line, then "Playoff odds", then one line for the scoring team and
   one for the team scored on: "Nickname: before% → after%", one decimal.
   Before is `p_playoffs_after - d_playoffs` from the goal's deltas.
5. Blank line, then "Assists: " with last names, comma separated; the line
   is left off for unassisted goals.
6. Both teams' hashtags, scoring team first.

Team names in text use nicknames (Leafs, Rangers, Canadiens, Golden
Knights...). The score line keeps abbreviations to match the card. Nicknames
and hashtags come from one table of all 32 teams, using each team's own
official hashtag (for example #LeafsForever, #NYR). My call; the builder
fills the table and checks each tag against the team's own X account.

The post must stay within 280 characters. If a long name pushes it over,
drop in this order: the context clause, then the assists line.

Picture: the goal's existing share card, `/api/og/tremor/{id}.png` (1200 ×
630), uploaded as the post's image. The card was resized on 2026-10-23 at
the owner's choice (smaller magnitude, larger scorer and odds) and already
carries the Puckquake wordmark; the bot uses it as is. Alt text: a one-line
description, for example "Magnitude 6.0 goal by Troy Stecher. Rangers
playoff odds −6.2 points, Leafs +1.5."

### The moment phrase

Rules over the goal's own data (score before and after, period, clock,
period type, shootout flag), first match wins. Shown to and accepted by the
owner:

| Situation | Phrase |
|---|---|
| Shootout winner | "wins it in the shootout" |
| Overtime goal | "wins it in overtime" |
| Breaks a tie in the last 5 minutes of the 3rd | "breaks a 4-4 tie with 28 seconds left" (or "with 3:12 left") |
| Ties the game | "ties it 2-2" |
| First goal of the game | "opens the scoring" |
| Breaks a tie earlier | "puts the Leafs ahead 3-2" |
| Extends a lead | "makes it 4-1" |
| Cuts a deficit | "cuts it to 3-2" |

Seconds left = 20:00 minus the goal's period clock (`t_period_s` counts up).
An empty-net goal adds "into the empty net" when the data shows no goalie
in net; the builder confirms what signal the stored goal has (the goal's
`goalie` field being empty is the likely one) and leaves the phrase off if
there is no reliable signal.

### The context clause

Appended to the magnitude line only when true, checked at posting time:

- "the biggest goal of the night" when no earlier goal tonight has a higher
  magnitude and at least 3 goals have been scored tonight (so the first goal
  of the night is not automatically "biggest").
- "the Nth-biggest goal of the season" when it ranks in the season's top 3
  by magnitude; this takes priority over the night clause.

## When it posts, and fixes

- **Trigger:** the live worker already publishes a `tremor` message for
  every measured goal and calls `_notify` (web push and Discord) when it is
  not catching up. The bot is a third background task in that same hook
  (`services/aftershock/live/worker.py`, `_notify`), next to
  `discord_tremor` in `services/aftershock/live/notify.py` or a sibling
  module. It must never block or slow the worker.
- **Shootout winners are posted.** The live engine creates a goal record
  only for the attempt that decides a shootout (`shootout=True`), never for
  the others, and that goal settles the extra point, so it counts like any
  goal. My call, after the builder check showed my first draft had this
  wrong. It counts toward "biggest goal of the night" like any other.
- **Skips:** any game that is not regular season (`game_type` 2, looked up
  from `Game`; the `Tremor` schema has no game type), goals already
  overturned, and goals more than 15 minutes old by the time the bot would
  post (catch-up protection).
- **Overturned goal** (`tremor_reversed`): delete the post.
- **Changed credit** (`tremor_updated` with scorer or assist changes): one
  reply under the original post, one line, for example "Correction: goal now
  credited to Morgan Rielly (from Troy Stecher)." For assist-only changes,
  "Correction: assists now Rielly, Duhaime." No new image.
- **Magnitude revisions** (the season re-calibration rewrites magnitudes
  after the fact): ignored. My call.
- **Exactly once:** every goal maps to at most one post. The post id is
  stored against the tremor id (new table or column; builder's choice) so
  restarts, retries, and duplicate messages never double-post, and so
  deletes and replies can find the post.
- **Order:** posts go out in the order goals happen. If X is slow or
  failing, retry with backoff for up to a few minutes, then give up on that
  goal and log it. Never a backlog dump.

## Cost

X API is pay-per-use (checked 2026-10-23 on docs.x.com): $0.015 per post,
$0.20 per post containing a link, $0.005 per media upload, deletes free.
No free tier; new accounts get about $20 in credit. Credits are bought in
advance in the X developer console. Prices changed twice in 2026, so the
builder rechecks before launch.

A regular season is about 1,300 games and 8,000 goals: roughly 1,200 posts a
month, about $25 a month with images, plus a few corrections. Links would
cost about 13 times more, so posts carry none; the site link lives in the
bio.

Safety rails (my calls):

- **Monthly cap:** a setting (default $40) the bot tracks from its own post
  and upload count; at the cap it stops posting and logs loudly until the
  next month.
- **Off switch:** a setting or Redis flag the owner can flip without a
  redeploy; posting is off by default until keys exist and the switch is on.
- **Dry run:** a mode that builds the post and logs it (and optionally saves
  the text and card locally) without calling X, used for a full live night
  before the first real post.

## Constraints

- Lives in the existing Python services (`services/aftershock`), runs in the
  existing worker container on the Oracle VM. No new service.
- Secrets in the VM's `.env`, read through `Settings` like
  `discord_webhook_url`.
- Code, package, and database names stay `aftershock` (the site was renamed
  to Puckquake for users only).
- Tests follow the existing style (`services/tests`, pytest), with X calls
  mocked. The moment phrase, context clause, character budget, skip rules,
  and exactly-once behaviour each get tests.
- Commit and push rules for this repo apply (short imperative subjects, no
  attribution, one change per commit).

## Playoffs, later

Agreed with the owner: launch for the regular season, then build the
playoff version as its own project before the April playoffs. In playoff
games the system measures goals by Stanley Cup odds (`compute_tremor` with
`playoffs=True`: shift from `d_cup`, `ppa` 0), so this version's "Playoff
odds" lines and the share card would show 100% → 100% and +0.0 pp. The
follow-up covers, in order:

1. Confirm the season simulator honours playoff series already in progress
   (a 3-1 lead), using last spring's playoff replays. If it does not, Cup
   odds are wrong site-wide and that is fixed first.
2. Store each team's Cup odds after the goal in the deltas (only playoff
   odds after are stored today).
3. A playoff post: "Cup odds" lines, playoff moments ("wins it in double
   overtime", "forces Game 7").
4. A series line ("Leafs lead the series 3-2"), which needs series scores
   from the NHL API.
5. A playoff share card showing Cup odds changes.
6. "Biggest goal" ranks among playoff goals only.

Until then the bot skips playoff games entirely.

## Left to the builder

- Which X client or HTTP library, and which auth flow, as long as it posts
  as the bot account with an image.
- The storage shape for post ids and the monthly counter.
- Exact backoff numbers.
- The 32-team nickname and hashtag table, checked against each team.
- Log event names and where dry-run output goes.
