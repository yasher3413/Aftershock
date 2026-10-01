# Data

Aftershock reads the NHL's public web API at `https://api-web.nhle.com/v1`.
The API is unofficial and undocumented. Everything below was observed by
hitting the real endpoints in September 2026 (2026-27 opening week) and by
scanning the cached play-by-play of every game since 2015-16 with
`scripts/analyze_pbp.py`. Trimmed samples live in `tests/fixtures/nhl/`.

## Legal and attribution

- NHL data belongs to the NHL. The API is not an officially supported
  product, and Aftershock is not affiliated with or endorsed by the NHL.
- Every page footer carries the source and a trademark notice: "Data from
  NHL.com. NHL and team logos and marks, and player photos, are the property
  of the NHL and its teams. Aftershock is not affiliated with, endorsed by,
  or sponsored by the NHL or any team."
- Team logos and player headshots are loaded by the browser from the NHL's
  public asset server (`assets.nhle.com`) and never copied into this
  repository or its fixtures. Each falls back to the team code or the
  player's initials. (This replaced an earlier codes-and-colors-only rule on
  2026-09-30; see DECISIONS.)
- Penalty, giveaway, and takeaway players come from the raw play-by-play in
  the local cache; the stored plays do not keep them.
- The NHL's shift charts are empty for 2024-25 games 2024021235 to 2024021312,
  so on-ice stats and plus/minus for that season leave those games out.
- Raw data dumps are never redistributed. The raw cache (`data/raw/`) is
  gitignored. Test fixtures are small, trimmed samples.

## Client behavior

`services/aftershock/nhl/client.py`:

- User-Agent `aftershock/<version> (+https://github.com/yasher3413/Aftershock)`.
- At most 4 concurrent requests and 8 request starts per second, globally.
- 10 second timeouts. Exponential backoff with jitter on timeouts, transport
  errors, 429, and 5xx, honoring `Retry-After`, up to 6 tries. 404 raises
  immediately.
- Conditional requests: responses carry a weak `ETag` (for example
  `W/"6abca074--gzip"`) and `cache-control: max-age=19` from Cloudflare. The
  client sends `If-None-Match` on repeat requests and reuses the previous
  body on 304.
- Raw responses are cached gzipped under `data/raw/{endpoint}/{key}.json.gz`
  only when immutable: finished games (`OFF` or `FINAL`), past-season club
  schedules, and past-season final standings.
- `/score/now`, `/schedule/now`, `/standings/now`, and `/roster/{team}/current`
  answer with **307 redirects** to a dated URL. The client follows redirects.
  `/score/now` keeps pointing at the previous hockey night until early morning
  Eastern, so the live loop also checks the Eastern calendar date.

## Endpoints used

| Endpoint | Used for |
|---|---|
| `/score/{date}` | Game states, scores, clock for a night |
| `/schedule/{date}` | A week of games, plus season dates (`regularSeasonStartDate`, `regularSeasonEndDate`, `playoffEndDate`) |
| `/club-schedule-season/{TEAM}/{season}` | Full season schedule; all 32 fetched and deduped by game id |
| `/gamecenter/{id}/play-by-play` | The event log (core feed) |
| `/gamecenter/{id}/landing`, `/boxscore` | Game summary; not needed by the core pipeline |
| `/standings/{date}` | Standings on a date, with division and conference per team |
| `/standings-season` | Per season: `standingsStart`, `standingsEnd`, and rule flags (`regulationWinsInUse`, `rowInUse`, `wildcardInUse`, `pointForOTlossInUse`, `tiesInUse`) |
| `/roster/{TEAM}/{season}` | Positions and handedness |
| `api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId={id}` | Shifts (stretch goal only) |

## Season facts verified for 2026-27

- `/schedule` reports `regularSeasonStartDate` 2026-09-29,
  `regularSeasonEndDate` 2027-04-10, `playoffEndDate` 2027-06-10.
- 1,344 regular-season games; every club schedule has **84** regular-season
  games (for example Toronto: 84 type-2 games plus 4 preseason).
- 32 teams. NHL numeric ids and arenas are in `config/teams.json`.
- Seven neutral-site games, detected by `neutralSite: true` on club schedule
  games: Heritage Classic (Princess Auto Stadium, Winnipeg, Oct 25), Global
  Series in Helsinki (Veikkaus Arena, Nov 12 and 14), Global Series in
  Dusseldorf (PSD Bank Dome, Dec 18 and 20), and two stadium games (Rice-Eccles
  Stadium, Salt Lake City, Dec 31; AT&T Stadium, Arlington, Feb 20).
  Coordinates are in `config/venues.json`. An unknown venue name falls back to
  the home arena and logs a warning.

## Game ids and states

- Id format `SSSSTTNNNN`: season start year, 2-digit game type (`01`
  preseason, `02` regular season, `03` playoffs), 4-digit game number.
- `gameState` values observed: `FUT`, `PRE`, `LIVE`, `CRIT`, `FINAL`, `OFF`.
  Finished games move `FINAL` then `OFF`. `gameScheduleState` is `OK` for
  normal games; postponed or suspended games use other values (`PPD`, `SUSP`).
  Unknown states are logged and treated as not live.

## Play-by-play

Top level: `id`, `season`, `gameType`, `gameDate`, `startTimeUTC`,
`easternUTCOffset`, `venueUTCOffset`, `venue.default`, `venueLocation.default`,
`gameState`, `gameScheduleState`, `periodDescriptor` (`number`, `periodType`,
`maxRegulationPeriods`), `clock` (`timeRemaining`, `secondsRemaining`,
`running`, `inIntermission`), `awayTeam` / `homeTeam` (`id`, `abbrev`,
`score`, `sog`), `shootoutInUse`, `otInUse`, `regPeriods`, `gameOutcome`
(`lastPeriodType` of `REG`, `OT`, or `SO`, and `otPeriods`), `rosterSpots`
(top level, not inside the team objects: `teamId`, `playerId`, names,
`sweaterNumber`, `positionCode`), and `plays`.

Each play: `eventId`, `sortOrder`, `periodDescriptor`, `timeInPeriod`,
`timeRemaining` (`MM:SS`), `situationCode`, `homeTeamDefendingSide`
(`left` or `right`, missing in older seasons), `typeCode`, `typeDescKey`, and
`details`.

`typeDescKey` values seen in 2025-26 (649-game sample): `faceoff`,
`shot-on-goal`, `stoppage`, `hit`, `blocked-shot`, `giveaway`, `missed-shot`,
`takeaway`, `penalty`, `goal`, `period-start`, `period-end`,
`delayed-penalty`, `game-end`, `shootout-complete`, `failed-shot-attempt`.
`eventId` is **not** chronological; `sortOrder` is.

`details` fields: `xCoord`, `yCoord`, `zoneCode` (relative to the event
owner: `O`, `D`, `N`), `shotType`, `eventOwnerTeamId`, `shootingPlayerId`
(shots), `scoringPlayerId`, `assist1PlayerId`, `assist2PlayerId`,
`goalieInNetId` (absent when the net is empty), `awayScore`, `homeScore`
(goals only), penalty `typeCode` (`MIN`, `MAJ`, ...), `descKey`, `duration`,
`committedByPlayerId`, `drawnByPlayerId`, and stoppage `reason` and
`secondaryReason`. Goals also carry highlight clip URLs, which are dropped.

### situationCode

Four digits: away goalie in net (1/0), away skaters, home skaters, home
goalie in net. Verified:

- `1551` is 5v5 and is by far the most common code (168k of 262k events).
- Every one of the 243 goals with no `goalieInNetId` in the 2025-26 sample
  has a situation code showing the defending team's goalie out.
- Penalty shots use `1010` (home shooter alone against the away goalie) or
  `0101`, outside the shootout. That is how penalty shots are identified.
- Shootout attempts have `periodType` `SO`.

### Coordinates

Rink coordinates in feet: x from -100 to 100, y from -42.5 to 42.5, nets at
(plus or minus 89, 0). The feed does not tell you which way a team shoots
except through `homeTeamDefendingSide`: `left` means the home team defends
the -x end and attacks +x in that period.

Normalization (`nhl/parse.py`): rotate each located event by 180 degrees when
needed so the event owner attacks toward +x. The direction per period comes
from a majority vote of unblocked shots taken in the shooter's offensive zone
with |x| > 25, falling back to `homeTeamDefendingSide` when the vote is close
(see the per-season checks for why).

Checks:

- Inference versus the explicit field: 2,115 of 2,115 periods agree in the
  2025-26 sample.
- After normalization, 97.0 percent of goals have x above 25, with a median x
  of 74 and median |y| of 7.
- Null coordinates on unblocked shots: 0 of 55,385 in the 2025-26 sample.
  Per-season rates are listed under "Per-season checks"; rows with null coordinates
  are dropped from xG training.

### Blocked shots

For `blocked-shot` events, `eventOwnerTeamId` is the **blocking** team and
`zoneCode` is from the blocker's perspective (nearly always `D`). The one
exception is `reason: teammate-blocked`, where the owner is the shooting
team (zone `O`). `shootingPlayerId` and `blockingPlayerId` are both present.
xG rebound detection uses the shooting team (`ml/xg_features.attempt_team`).

### Corrections and overturned goals

In a finished game, an overturned goal simply is not a goal: the event shows
up as a `shot-on-goal` at the same time, followed by a `stoppage` whose
`reason` starts with `chlg-` (for example `chlg-hm-goal-interference`).
Unsuccessful challenges leave the goal in place and add a
`delaying-game-unsuccessful-challenge` penalty. The live recordings in
`tests/fixtures/nhl/live/` show how this looks while a game is in progress.

## Standings

`/standings/{date}` rows include `teamAbbrev.default`, `conferenceName`,
`divisionName`, `gamesPlayed`, `wins`, `losses`, `otLosses`, `points`,
`regulationWins`, `regulationPlusOtWins`, `goalFor`, `goalAgainst`,
`shootoutWins`, `shootoutLosses`, `leagueSequence`, `conferenceSequence`,
`divisionSequence`, `wildcardSequence`, and `clinchIndicator`. Checked on
2025-26 final standings: `points = 2W + OTL`, `GP = W + L + OTL`, and
`RW <= ROW <= W` hold for all 32 teams.

## Per-season checks

Every cached game, regular season and playoffs. "Direction inference agrees"
compares the zone-code inference with `homeTeamDefendingSide` period by
period, where the field exists.

| Season | Games | Unblocked shots | Null coordinates | Games with defending side | Direction inference agrees |
|---|---|---|---|---|---|
| 2015-16 | 1,321 | 109,522 | 1 (0.00%) | 0 | n/a (field absent) |
| 2016-17 | 1,317 | 110,999 | 4 (0.00%) | 0 | n/a (field absent) |
| 2017-18 | 1,355 | 119,770 | 3 (0.00%) | 0 | n/a (field absent) |
| 2018-19 | 1,358 | 117,802 | 4 (0.00%) | 0 | n/a (field absent) |
| 2019-20 | 1,212 | 104,404 | 0 (0.00%) | 1,212 | 3,893 of 3,923 |
| 2020-21 | 952 | 78,671 | 0 (0.00%) | 952 | 3,073 of 3,084 |
| 2021-22 | 1,401 | 121,603 | 0 (0.00%) | 1,401 | 4,508 of 4,508 |
| 2022-23 | 1,400 | 122,066 | 0 (0.00%) | 1,400 | 4,531 of 4,531 |
| 2023-24 | 1,400 | 122,529 | 0 (0.00%) | 1,400 | 4,492 of 4,492 |
| 2024-25 | 1,398 | 119,954 | 0 (0.00%) | 1,398 | 4,489 of 4,489 |
| 2025-26 | 1,394 | 119,357 | 0 (0.00%) | 1,394 | 4,534 of 4,534 |
| 2026-27 | 5 | 371 | 0 (0.00%) | 5 | 17 of 17 |

Notes:

- Null coordinates are essentially absent: 12 unblocked shots in eleven
  seasons. They are dropped from xG training.
- `homeTeamDefendingSide` first appears in 2019-20. Inference agrees with it
  in every period from 2021-22 on. In 2019-20 (30 of 3,923 periods) and
  2020-21 (11 of 3,084) the two disagree. In all 45 of those periods
  (counted over regular season and playoffs), the shooters' offensive-zone
  shots sit at the end the inference picks, so the field is the one that is
  wrong. The parser therefore prefers a decisive shot vote (margin of three or
  more) and falls back to the field only when the vote is close. The models
  were trained before this change; it affects 45 periods of about 7,000 in
  those two seasons.
