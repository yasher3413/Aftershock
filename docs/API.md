# API

Interactive docs: `/api/docs` (OpenAPI at `/api/openapi.json`). Every
probability is a float in [0, 1]; the web app formats them. Wire types are
defined once in `services/aftershock/api/schemas.py`; `make types` exports
their JSON Schema and regenerates `web/src/api/types.gen.ts`, and CI fails if
the generated file is stale.

## REST (`/api`)

| Route | Returns |
|---|---|
| `GET /health` | Last successful poll per source, worker lag, last simulation time and duration, mode |
| `GET /state` | Bootstrap: mode (`live` or `demo`) and replay info, teams, venues, standings, current odds and odds at the day's start, live games, tonight's games with pregame and live win probability and stakes, game of the night, last 50 tremors, server time |
| `GET /teams/{abbrev}` | Team info, odds, odds history (playoffs, division, Cup), points histogram, seed distribution, rooting guide, remaining schedule with win chances, biggest tremors for and against, player PPA |
| `GET /games?date=YYYY-MM-DD` | Games of a hockey night |
| `GET /games/{id}` | Game, win probability timeline, shots with xG and normalized coordinates, xG totals, tremors |
| `GET /tremors?season=&sort=magnitude|recent&team=&limit=&cursor=` | A page of tremors with an opaque keyset `next_cursor` |
| `GET /tremors/{id}` | One tremor with full per-team deltas |
| `GET /leaders/ppa?season=&kind=skater|assist|goalie|team_chaos` | Leaderboards |
| `GET /odds/history?team=&metric=&season=` | Every simulation's value of one metric for one team |
| `GET /replay/nights?season=` | Nights with a replay, with total energy, games, tremors |
| `GET /replay/{date}` | The night's replay bundle (gzip-encoded JSON, `ReplayBundleOut`). Served compacted (`api/replay.py`): odds and win chances rounded to four decimals, and each `odds_update` and `game_update` frame keeps only the fields that changed (plus `team` or `id`), which clients merge into what they have. About 3 MB raw instead of 23 MB for a full night. |
| `GET /whatif/bootstrap` | Everything the in-browser simulator needs: config, team order, every game (finals with results, the rest with six-way probabilities and expected goals), playoff win matrix, tie inflation, team noise, stakes |
| `GET /methodology` | Model reports from `ml/reports/*.json` and plot URLs |
| `GET /reports/{name}` | A report plot (SVG) |
| `GET /recaps/{date}` | Nightly recap |
| `GET /status` | Health, recent simulations, reconciliation events, job runs |
| `GET /og/tremor/{id}.png?size=og|card` | Share image: 1200 by 630, or the 1080 by 1350 card |
| `GET /og/team/{abbrev}.png`, `GET /og/night/{date}.png` | Share images, 1200 by 630 |
| `GET /push/key` | `{"key": ...}`: the web push public key, or `null` when alerts are not set up (the team page then hides them) |
| `POST /push/subscribe`, `POST /push/unsubscribe` | Store or delete a browser's alert subscription (team and minimum magnitude) |
| `GET /sitemap.xml` | Sitemap of the sections, every team, every night replayed this season, and every player who scored or assisted this season (served at `/sitemap.xml` on the site) |
| `GET /robots.txt` | Crawl rules and the sitemap location (served at `/robots.txt` on the site) |

Errors use FastAPI's `{"detail": "..."}` with a plain sentence. `503` from
`/state` or `/whatif/bootstrap` means the worker has not published yet.

## WebSocket (`/ws/live`)

Every message has `type`, `seq` (global and monotonic), and `ts` (server
time). Types:

| Type | Fields |
|---|---|
| `hello` | `mode`, `server_time`, `state_version` (sent first on connect, and when the mode changes) |
| `game_update` | `game` (a `GameSummary` with state, clock, score, shots, six-way `wp`, `stakes`) |
| `event` | `game_id`, `event_id`, `kind`, `period`, `t_period_s`, `team`, `x`, `y` |
| `tremor` | `tremor` (the full record, including origin coordinates) |
| `tremor_updated` | `tremor_id`, `changes`: corrected `scorer`, `assist1`, `assist2`, or `goalie`, each a player reference or null |
| `tremor_reversed` | `tremor_id`, `game_id`, `origin`, `deltas` (the original deltas, to undo) |
| `odds_update` | `sim_run_id`, `trigger`, `odds` (every metric except histograms) |
| `standings_update` | `standings` |
| `recap_ready` | `night_date` |
| `heartbeat` | every 15 seconds |

The server keeps the last 1,000 messages. Reconnect with `?since=<seq>` to
receive everything after that sequence number. If the gap is older than the
buffer, the server sends `{"type": "resync"}` and the client refetches
`/api/state`. The web client reconnects with backoff from 1 to 30 seconds.

## Pages (`/page/...`)

Page requests on the site are rewritten to `/page/<path>`, which returns the
built `index.html` with that page's title, description, and share image
filled in (`api/pages.py`), so link previews work without JavaScript. Unknown
addresses (a team, player, game, or goal that does not exist, an impossible
date) get the same shell with a `404` status; `/night/today` and `/embed/X`
are real pages. Responses are cached for a minute, then served stale for up
to two minutes while the CDN refetches.
