# Roster Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Roster Lab tab where a fan trades players between two teams,
takes a player out for a chosen length, or signs a free agent, and sees each
team's playoff and Cup odds and the league table before and after.

**Architecture:** An offline job turns shift charts, play-by-play and shot xG
into a per-player value (even-strength RAPM plus finishing, goalie GSAx) and
each team's current lineup with minutes, stored in Postgres. A request applies
the moves as rating deltas to the worker's published What-If bootstrap
(scoring rates are multiplicative in the ratings, so a delta is a factor on
each game's rates), recomputes the six-way probabilities and the playoff
matrix, and runs the Rust simulator before and after on the api, cached by the
canonical moves. The web page is a new route beside the What-If Lab.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy async, Alembic, numpy,
scipy.sparse, scikit-learn Ridge, aftershock_core (Rust), cairosvg; React 19,
TanStack Query, Tailwind v4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-24-roster-lab-design.md`

## Global Constraints

- Code names use `aftershock`; visible text says Puckquake. The tab is "Roster Lab" at `/roster-lab`.
- Moves: trade between two teams, injury of 1, 2, 4, 6, 8 weeks or rest of season (calendar days from today), sign a free agent. No sandbox: a player on a team only moves by trade.
- Free agent: NHL minutes since 2024-25 and on no current NHL roster.
- "Before" roster: players dressing lately; players already out cannot be moved or removed in v1.
- Roster shape: per team at most 14 F, 8 D, 3 G and at least 12 F, 6 D, 2 G.
- Change applied after `build_inputs` shrinkage (that is, to the published bootstrap's rates) and to `playoff_p`.
- `d_off = ln(1 + dGF / league_avg)`, `d_def = ln(1 + dGA / league_avg)`.
- 10,000 seasons, seed 1, before and after; results identical for identical moves.
- Regular season only; offseason shows a "returns when the season starts" note.
- Shared links rerun with current data; post text keeps the numbers from when it was shared.
- Never fit the player model per request; one simulation at a time on the VM (1 CPU).
- Realism targets: top-five skater 8 to 10 standings points over 82 games; fourth-line swap under 1 point; injury cost proportional to games missed.
- Commits: short imperative subject under 72 chars, no prefixes, no emoji, no attribution trailers, no em dashes. Stage explicit paths only (never `docs/THOUGHTS.md`, never `.codex/`). Push after every commit on main.

## Review Focus

1. A player traded mid-season who dressed only for his old team: he must count on his current team's lineup, not vanish (test in Task 3).
2. Moves that break roster shape (trading away the second goalie, 15th forward): the api must refuse with a plain message, not simulate (test in Task 6).
3. An injury window that ends after the regular season or covers no remaining games: no crash, no change (test in Task 4).
4. Two requests for the same moves in a different order: same cache key, same numbers (test in Task 6).
5. The bootstrap not yet published (worker just restarted) or the offseason: 503 with a readable message, page shows a note (tests in Tasks 6 and 8).

---

### Task 1: Stints and minutes from shift charts

**Files:**
- Create: `services/aftershock/ml/stints.py`
- Test: `services/tests/ml/test_stints.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) class Stint: game_id: int; dur_s: int; home: tuple[int, ...]; away: tuple[int, ...]; home_xg: float; away_xg: float; home_goals: int; away_goals: int`
  - `build_stints(game_id: int, shifts: list[dict], plays: list[PlayRow], xg: dict[int, float], home: str, goalies: set[int]) -> list[Stint]` with `PlayRow = (event_id, period, t_period_s, type, owner_team, situation_code, home_team: str)`; only 5v5 stints (five skaters a side, both goalies in) are returned.
  - `toi(shifts: list[dict], goalies: set[int]) -> dict[int, PlayerToi]`, `PlayerToi(team: str, ev_s: int, pp_s: int, total_s: int)`; even strength or power play is read from the on-ice skater counts at each second.

Shift rows use the same fields as `jobs/onice.py` (`typeCode == 517`, `period`, `startTime`, `endTime`, `playerId`, `teamAbbrev`). A shot at `t` belongs to the stint with `start < t <= end`, matching `on_ice`.

- [ ] **Step 1: Write the failing tests**

```python
def test_stints_split_on_changes_and_carry_xg():
    # 10 skaters + 2 goalies on from 0:00 to 1:00 in period 1; home C swaps at 0:30.
    st = build_stints(1, shifts, plays, {7: 0.12}, "TOR", {30, 31})
    assert [s.dur_s for s in st] == [30, 30]
    assert st[0].home_xg == pytest.approx(0.12)  # shot event 7 at 0:20 by TOR
    assert st[1].home != st[0].home

def test_power_play_time_is_not_a_stint_and_counts_as_pp():
    st = build_stints(1, shifts_5v4, plays, {}, "TOR", {30, 31})
    assert st == []
    assert toi(shifts_5v4, {30, 31})[11].pp_s == 60

def test_goalie_pulled_is_not_5v5():
    assert build_stints(1, shifts_pulled, plays, {}, "TOR", {30, 31}) == []
```

- [ ] **Step 2: Run** `cd services && uv run pytest tests/ml/test_stints.py -q`. Expected: FAIL, `ModuleNotFoundError: aftershock.ml.stints`.
- [ ] **Step 3: Implement** `build_stints` and `toi`. Walk each period's change points (all shift starts and ends), take the on-ice sets between them, keep segments with 5 skaters per side and both goalies, merge adjacent identical segments.
- [ ] **Step 4: Run** the same command. Expected: 3 passed.
- [ ] **Step 5: Commit** `git add services/aftershock/ml/stints.py services/tests/ml/test_stints.py && git commit -m "Build 5v5 stints and ice time from shift charts" && git push`

### Task 2: Player value model

**Files:**
- Create: `services/aftershock/ml/player_value.py`
- Test: `services/tests/ml/test_player_value.py`

**Interfaces:**
- Consumes: `Stint` (Task 1).
- Produces:
  - `fit_rapm(stints: list[Stint], alpha: float) -> dict[int, tuple[float, float]]`: per skater `(off, def)` in xG per 60 at 5v5; `def` positive means more xG against (matches the team rating sign). Two rows per stint (each side attacking), columns `off_p` for attackers and `def_p` for defenders, target xG per 60, weight `dur_s`, an intercept, `sklearn.linear_model.Ridge` on a `scipy.sparse.csr_matrix`.
  - `choose_alpha(stints, alphas=(100, 300, 1000, 3000, 10000), folds=5) -> float`: grouped by game.
  - `finishing(shots: list[tuple[int, float, bool]], prior_shots: float = 200.0) -> dict[int, float]`: (shooter, xg, goal) to goals above expected per shot, shrunk by `n / (n + prior_shots)`.
  - `goalie_gsax(shots_against: list[tuple[int, float, bool]], prior_shots: float = 1500.0) -> dict[int, float]`: per shot faced, same shrinkage.
  - `@dataclass class PlayerValue: player_id: int; position: str; off60: float; def60: float; finish_per_shot: float; shots_per60: float; gsax_per_shot: float; ev_toi_pg: float; pp_toi_pg: float; games: int`
  - `MODEL_VERSION = "roster-1.0.0"`

- [ ] **Step 1: Write the failing tests**

```python
def test_rapm_recovers_a_planted_player():
    # 400 synthetic games: player 99 adds +0.6 xGF/60 to his team when on.
    vals = fit_rapm(synthetic_stints(seed=3, star=99, boost=0.6), alpha=300)
    assert 0.3 < vals[99][0] < 0.8
    assert abs(vals[99][1]) < 0.2
    others = [v[0] for k, v in vals.items() if k != 99]
    assert max(others) < vals[99][0]

def test_rapm_shrinks_a_player_with_few_minutes():
    vals = fit_rapm(synthetic_stints(seed=3, star=98, boost=0.6, star_games=2), alpha=300)
    assert abs(vals[98][0]) < 0.2

def test_finishing_and_gsax_shrink_small_samples():
    assert finishing([(1, 0.1, True)])[1] == pytest.approx(0.9 * 1 / 201)
    assert goalie_gsax([(5, 0.1, False)] * 100)[5] == pytest.approx(0.1 * 100 / 1600)
```

- [ ] **Step 2: Run** `uv run pytest tests/ml/test_player_value.py -q`. Expected: FAIL on import.
- [ ] **Step 3: Implement** the four functions and the dataclass; `synthetic_stints` lives in `services/tests/ml/roster_fixtures.py` (test-only).
- [ ] **Step 4: Run** the same command. Expected: 3 passed.
- [ ] **Step 5: Commit** both files plus `roster_fixtures.py`: "Fit player values with RAPM, finishing, and goalie GSAx".

### Task 3: Player values job, lineups, and free agents

**Files:**
- Create: `services/migrations/versions/0010_player_values.py`, `services/aftershock/jobs/player_values.py`
- Modify: `services/aftershock/db/models.py` (two models), `services/aftershock/cli.py` (`player-values` command), `services/aftershock/live/worker.py` (daily run)
- Test: `services/tests/jobs/test_player_values.py`

**Interfaces:**
- Consumes: Tasks 1 and 2; `NhlClient.shiftcharts`, `NhlClient.roster`; `Play`, `ShotXg`, `Game`, `Player` tables.
- Produces:
  - Table `player_values` (PK `player_id`): the `PlayerValue` fields plus `model_version`, `computed_at`.
  - Table `roster_spots` (PK `team, player_id`): `position` (`F`, `D`, `G`), `in_lineup: bool`, `ev_toi_pg`, `pp_toi_pg`, `toi_share` (goalies: share of the team's last 10 games' minutes), `computed_at`.
  - `lineup(team_games: list[int], dressed: dict[int, set[int]], last_game: dict[int, int], roster: set[int]) -> set[int]`: a roster player is in the lineup if he dressed in any of the team's last 10 games, or his most recent game for any team is later than the team's 10th-last game (a fresh trade).
  - `free_agents(values: dict[int, PlayerValue], rostered: set[int]) -> set[int]`.
  - `async run_player_values(seasons: list[int]) -> dict[str, int]`; CLI `aftershock player-values --season 20242025 --season 20252026 --season 20262027`.
  - Worker runs it once a day at 10:00 UTC (outside game hours) in a thread; `ROSTER_SEASONS` are the current season and the two before.
  - Report `ml/reports/roster.json`: alpha, players, and the realism checks from Task 5.

- [ ] **Step 1: Write the failing tests**

```python
def test_fresh_trade_counts_in_new_lineup():
    games = list(range(1, 11))
    dressed = {g: {1, 2} for g in games}            # 3 dressed only for his old team
    assert lineup(games, dressed, last_game={1: 10, 2: 10, 3: 11, 4: 2}, roster={1, 2, 3, 4}) == {1, 2, 3}

def test_injured_roster_player_is_not_in_lineup():
    assert 4 not in lineup(list(range(1, 11)), {g: {1} for g in range(1, 11)}, {1: 10, 4: 0}, {1, 4})

def test_free_agents_exclude_rostered():
    assert free_agents({1: v(1), 2: v(2)}, rostered={1}) == {2}
```

- [ ] **Step 2: Run** `uv run pytest tests/jobs/test_player_values.py -q`. Expected: FAIL on import.
- [ ] **Step 3: Implement** the migration, models, `lineup`, `free_agents`, `run_player_values` (fetch missing shift charts through the client cache, build stints, choose alpha, fit, upsert both tables, write the report), the CLI command, and the worker schedule.
- [ ] **Step 4: Run** the tests, then `uv run alembic upgrade head` and `uv run aftershock player-values --season 20242025 --season 20252026 --season 20262027` against local Postgres. Expected: tests pass; the command prints counts with more than 900 players and 32 teams with 18 to 20 lineup skaters each.
- [ ] **Step 5: Commit** the migration, job, models, CLI, worker, test, and `ml/reports/roster.json`: "Compute player values and lineups nightly".

### Task 4: Team change from a set of moves

**Files:**
- Create: `services/aftershock/sim/roster.py`
- Test: `services/tests/sim/test_roster.py`

**Interfaces:**
- Consumes: `PlayerValue`, roster spots (Task 3).
- Produces:
  - `Move = Trade(player_id, to) | Injury(player_id, weeks: int | None) | Sign(player_id, to)`; `None` weeks means rest of season; `WEEKS = (1, 2, 4, 6, 8)`.
  - `parse_moves(encoded: str) -> list[Move]` and `encode_moves(moves) -> str`, canonical (sorted) form: parts joined by `_`, `t{pid}-{TEAM}`, `i{pid}-{weeks or 0}`, `s{pid}-{TEAM}`. Raises `ValueError` on bad input or more than 20 moves.
  - `assign_minutes(players: list[Spot]) -> dict[int, float]`: per position group, players ranked by their own `ev_toi_pg`; the team's slot minutes (its current lineup's sorted minutes) go to the ranks; F keeps 12 slots, D 6; goalies by `toi_share`, a newcomer takes the starter's share only if his `gsax_per_shot` is higher, else the backup's.
  - `team_goals(spots, values, minutes) -> tuple[float, float]`: GF and GA per game from `off60 * min/60`, finishing `finish_per_shot * shots_per60 * min/60`, and goalie `-gsax_per_shot * shots_against_pg * share`.
  - `team_deltas(moves, rosters, values, league_avg, today: date) -> list[Window]`, `Window(team, start: date, end: date | None, d_off, d_def)`: one window per distinct roster state; an injury of `w` weeks gives a window `[today, today + 7w)` without him and nothing after.
  - `check_shape(rosters_after) -> str | None`: the plain message for the first broken limit.

- [ ] **Step 1: Write the failing tests**

```python
def test_fourth_liner_swap_is_near_zero():
    w = team_deltas([Trade(F12_TOR, "MTL"), Trade(F12_MTL, "TOR")], rosters, values, 2.95, TODAY)
    assert all(abs(x.d_off) < 0.005 and abs(x.d_def) < 0.005 for x in w)

def test_star_out_lowers_offense_and_returns_after_window():
    w = team_deltas([Injury(STAR_TOR, 4)], rosters, values, 2.95, TODAY)
    assert w == [Window("TOR", TODAY, TODAY + timedelta(days=28), pytest.approx(-0.04, abs=0.03), pytest.approx(0, abs=0.01))]

def test_injury_after_season_end_is_harmless():
    assert team_deltas([Injury(STAR_TOR, 8)], rosters, values, 2.95, LAST_DAY + timedelta(days=1))[0].end is not None

def test_shape_limits():
    assert check_shape(after_trading_both_tor_goalies) == "TOR would have 1 goalie; a team needs at least 2."

def test_encoding_is_canonical():
    assert encode_moves(parse_moves("t5-MTL_i9-4")) == encode_moves(parse_moves("i9-4_t5-MTL"))
```

- [ ] **Step 2: Run** `uv run pytest tests/sim/test_roster.py -q`. Expected: FAIL on import.
- [ ] **Step 3: Implement** with the Global Constraints' conversion formulas.
- [ ] **Step 4: Run** the same command. Expected: 5 passed.
- [ ] **Step 5: Commit**: "Turn roster moves into team rating changes".

### Task 5: Roster Lab simulation and the realism gate

**Files:**
- Create: `services/aftershock/sim/roster_lab.py`
- Modify: `services/aftershock/sim/whatif.py` (add `ratings`, `league_avg`, `params` to the payload), `services/aftershock/jobs/player_values.py` (realism report)
- Test: `services/tests/sim/test_roster_lab.py`

**Interfaces:**
- Consumes: the bootstrap (`whatif_payload`), `Window` (Task 4), `six_way`, `StrengthParams`.
- Produces:
  - Payload additions: `"ratings": {team: [off, def]}` from the shrunk simulation engine, `"league_avg": float`, `"params": StrengthParams.to_dict()`. The What-If Lab ignores them.
  - `apply_windows(boot: dict, windows: list[Window]) -> dict`: for each future game on a date inside a team's window, `lam_home *= exp(d_off_home + d_def_away)` and `lam_away *= exp(d_off_away + d_def_home)`, then `probs = six_way(...)`; `playoff_p` rebuilt from `ratings` plus each team's rest-of-season delta (its last window).
  - `run_roster_lab(boot, windows) -> RosterResult` with `teams: list[TeamLine(team, playoffs_before, playoffs_after, cup_before, cup_after, points_before, points_after)]`, all 32 teams, `N_SIMS = 10_000`, `SEED = 1`, reusing `scenario_card._run`'s simulator call (refactor it to accept `probs`, `lam`, `playoff_p`).
  - Realism report keys in `ml/reports/roster.json`: `corr_team_goals`, `top5_full_season_points` (list of five), `fourth_line_swap_points`, `injury_4w_points`.

- [ ] **Step 1: Write the failing tests**

```python
def test_no_moves_changes_nothing(boot):
    r = run_roster_lab(boot, [])
    assert all(t.playoffs_before == t.playoffs_after for t in r.teams)

def test_window_only_touches_games_inside_it(boot):
    out = apply_windows(boot, [Window("TOR", D1, D1 + timedelta(days=7), 0.1, 0.0)])
    inside, outside = tor_games(out, D1, 7), tor_games(out, D1 + timedelta(days=7), 60)
    assert all(g["lam"] != g0["lam"] for g, g0 in inside) and all(g["lam"] == g0["lam"] for g, g0 in outside)

def test_stronger_team_gains(boot):
    r = run_roster_lab(boot, [Window("TOR", D1, None, 0.08, -0.08)])
    tor = next(t for t in r.teams if t.team == "TOR")
    assert tor.playoffs_after > tor.playoffs_before and tor.points_after > tor.points_before

def test_same_input_same_numbers(boot):
    w = [Window("TOR", D1, None, 0.05, 0.0)]
    assert run_roster_lab(boot, w) == run_roster_lab(boot, w)
```

Tests marked `@pytest.mark.native` (they need `aftershock_core`), as the existing scenario card tests are.

- [ ] **Step 2: Run** `uv run pytest tests/sim/test_roster_lab.py -q`. Expected: FAIL on import.
- [ ] **Step 3: Implement** the payload fields, `apply_windows`, `run_roster_lab`, and the report.
- [ ] **Step 4: Run** the tests, then the realism gate on real data: `uv run aftershock player-values --season 20242025 --season 20252026 --season 20262027 --report`, which exits non-zero if a target fails. Expected: tests pass; report shows every `top5_full_season_points` within 8 to 10 (a value from 7 to 11 passes with a cap), `fourth_line_swap_points < 1`, and `injury_4w_points` within 30% of a full-season loss scaled by games missed. If the top five are outside 7 to 11, set a single documented `VALUE_SCALE` in `sim/roster.py` so the median of the top five lands at 9, record why in `docs/DECISIONS.md`, and rerun.
- [ ] **Step 5: Commit**: "Simulate roster moves before and after".

### Task 6: Roster Lab api, saved moves, and the card

**Files:**
- Modify: `services/aftershock/api/app.py`, `services/aftershock/api/schemas.py`, `services/aftershock/api/pages.py`, `services/aftershock/share/cards.py`, `services/aftershock/db/models.py`
- Create: `services/migrations/versions/0011_roster_moves.py`
- Test: `services/tests/api/test_roster_lab.py`

**Interfaces:**
- Consumes: Tasks 3 to 5; `WHATIF_KEY`; the `scenarios` save pattern (`SC.new_id`, `SC.client_ip`, rate limit).
- Produces:
  - `GET /api/roster-lab/teams/{abbrev}`: `{team, players: [{id, name, position, in_lineup, worth_goals}]}` where `worth_goals` is his goals over the rest of the season for his team.
  - `GET /api/roster-lab/free-agents?q=`: up to 20 matches by name, `{id, name, position, worth_goals}`.
  - `POST /api/roster-lab/run {encoded}`: `{encoded, teams: [TeamLine...], changed: [team], why: {team: [{player_id, name, goals}]}, computed_at}`. Canonicalizes, validates (players exist, moves legal: trades only between the lineups of at most two teams, signings only free agents, `check_shape`), caches in Redis `aftershock:roster-run:{encoded}:{bootstrap hash}` for 6 hours, runs under the same `asyncio.Lock` as the scenario card in a thread. 422 with the plain message on invalid moves; 503 "The forecast is not ready yet." without a bootstrap; 409 "The Roster Lab returns when the regular season starts." when no regular-season games remain.
  - `POST /api/roster-moves {encoded}` and `GET /api/roster-moves/{id}`: like scenarios, table `roster_moves` (id, encoded, digest unique, created_at), same rate limit.
  - `GET /api/og/roster/{id}.png`: `roster_og(teams_changed, moved: list[str], lines)` at 1200 by 630, the changed teams' playoff odds before and after and the moved players' names.
  - Page meta for `/roster-lab?id=`: title from the moves ("TOR gets Hughes, VAN gets Knies"), image the card.

- [ ] **Step 1: Write the failing tests**

```python
async def test_invalid_shape_is_refused(client):
    r = await client.post("/api/roster-lab/run", json={"encoded": "t30-MTL_t31-MTL"})
    assert r.status_code == 422 and "goalie" in r.json()["detail"]

async def test_order_does_not_matter(client):
    a = (await client.post("/api/roster-lab/run", json={"encoded": "t5-MTL_t6-TOR"})).json()
    b = (await client.post("/api/roster-lab/run", json={"encoded": "t6-TOR_t5-MTL"})).json()
    assert a == b

async def test_signing_a_rostered_player_is_refused(client):
    r = await client.post("/api/roster-lab/run", json={"encoded": "s5-MTL"})
    assert r.status_code == 422

async def test_no_bootstrap_is_503(client_without_bootstrap):
    assert (await client_without_bootstrap.post("/api/roster-lab/run", json={"encoded": "i5-4"})).status_code == 503

async def test_saved_moves_round_trip(client):
    sid = (await client.post("/api/roster-moves", json={"encoded": "i5-4"})).json()["id"]
    assert (await client.get(f"/api/roster-moves/{sid}")).json()["encoded"] == "i5-4"
```

- [ ] **Step 2: Run** `uv run pytest tests/api/test_roster_lab.py -q`. Expected: FAIL (404s).
- [ ] **Step 3: Implement** the migration, model, endpoints, schemas, card, and page meta.
- [ ] **Step 4: Run** the tests and the whole suite: `uv run pytest -q && uv run ruff check . && uv run mypy aftershock`. Expected: all pass, no lint or type errors.
- [ ] **Step 5: Commit**: "Serve Roster Lab runs, saved moves, and a share card". Regenerate the web api types (`aftershock export-schema` then the web codegen the repo uses) in the same commit.

### Task 7: Roster Lab page

**Files:**
- Create: `web/src/pages/RosterLab.tsx`, `web/src/roster/moves.ts`, `web/src/roster/moves.test.ts`, `web/src/roster/share.ts`
- Modify: `web/src/routes.tsx`, `web/src/components/Shell.tsx` (NAV), `web/src/components/Footer.tsx`, `web/src/pages/WhatIf.tsx`, `web/src/pages/Team.tsx`
- Test: `web/e2e/roster-lab.spec.ts`, fixtures in `web/e2e/fixtures/`

**Interfaces:**
- Consumes: the Task 6 endpoints; `ShareMenu`/`ShareSpec`; `useMedia`.
- Produces:
  - `moves.ts`: `encodeMoves`, `parseMoves`, `describeMoves(moves, names) -> string` ("TOR gets Hughes, VAN gets Knies"), matching the server's canonical form.
  - Route `/roster-lab` with `?team=TOR`, `?teams=TOR,VAN`, `?m=<encoded>`, `?id=<saved id>`. URL updates use `preventScrollReset: true`.
  - NAV order: Tonight, Nights, Leaders, Standings, What if, Roster Lab, How it works.
  - Layout: up to two team columns (one on phones, with team tabs as in the What-If phone tabs), each a roster grouped F, D, G with each player's worth; a player's menu: "Trade to {other team}", "Out for..." (1, 2, 4, 6, 8 weeks, Rest of season), and "Sign a free agent" search per team. Out-of-lineup players shown muted with "Not playing lately" and no menu. A sticky summary with each changed team's playoff odds before and after and the share icon; results below: per team playoff and Cup odds and projected points before and after, the "why" line, then the league table before and after with changed teams highlighted. Results show "Updating" while a run is in flight and keep the previous numbers in place (constant height, as the What-If bar).
  - Share spec: label "Share trade", tweet from `describeMoves` plus each changed team's "41% to 52%", link `/roster-lab?id=`, X image `/api/og/roster/{id}.png`.
  - Cross-links: What-If Lab "Try a trade in the Roster Lab", Roster Lab "Pick game results in the What-If Lab", Team page "Try a trade" to `/roster-lab?team={abbrev}`.

- [ ] **Step 1: Write the failing tests**

```ts
// moves.test.ts
it("encodes canonically", () => {
  expect(encodeMoves(parseMoves("i9-4_t5-MTL"))).toBe("i9-4_t5-MTL".split("_").sort().join("_"));
});
it("describes a trade", () => {
  expect(describeMoves(parseMoves("t5-VAN_t6-TOR"), names)).toBe("TOR gets Knies, VAN gets Hughes");
});
```

```ts
// roster-lab.spec.ts (api mocked with page.route, fixtures from Task 6 responses)
test("trade a player and see both teams move", async ({ page }) => {
  await page.goto("/roster-lab?teams=TOR,VAN");
  await page.getByRole("button", { name: "Quinn Hughes" }).click();
  await page.getByRole("menuitem", { name: "Trade to TOR" }).click();
  await expect(page.getByTestId("result-TOR")).toContainText("41% to 52%");
  await expect(page).toHaveURL(/m=t\d+-TOR/);
});
test("offseason shows the note", ...);          // run returns 409
test("phone: one column with team tabs, no sideways scroll", ...); // iPhone 13 viewport
```

- [ ] **Step 2: Run** `cd web && pnpm vitest run src/roster && pnpm playwright test e2e/roster-lab.spec.ts`. Expected: FAIL (module and route missing).
- [ ] **Step 3: Implement** the page, helpers, nav, cross-links, and fixtures.
- [ ] **Step 4: Run** `pnpm lint && pnpm typecheck && pnpm vitest run && pnpm playwright test`. Expected: all pass (the tour spec may flake under parallel load; if it fails, rerun it alone with `--workers=1` and report both runs). Then look at the page in a real browser at 1440 and 390 wide against the local api with real data.
- [ ] **Step 5: Commit** in two commits: "Add the Roster Lab page" (page, helpers, route, nav, tests) and "Link the Roster Lab from the What-If Lab and team pages".

### Task 8: Docs and deploy

**Files:**
- Modify: `docs/DESIGN.md` (Roster Lab section), `docs/API.md` (endpoints), `docs/MODELS.md` and `ml/MODEL_CARDS.md` (player value model, realism results), `docs/DEPLOY.md` (run `alembic upgrade`, the first `aftershock player-values`, the daily schedule), `docs/PROGRESS.md`, `web/src/pages/Method.tsx` (a short Roster Lab section reading `roster.json` through `/api/methodology`)
- Test: `web/e2e/method.spec.ts` (the section renders)

- [ ] **Step 1:** Add the method page assertion; run `pnpm playwright test e2e/method.spec.ts`. Expected: FAIL.
- [ ] **Step 2:** Add `roster` to the methodology report names in `api/app.py`, write the section and the docs.
- [ ] **Step 3:** Run the method spec and `uv run pytest -q`. Expected: pass.
- [ ] **Step 4: Commit**: "Document the Roster Lab".
- [ ] **Step 5: Deploy** (ask the owner before touching the VM): pull, rebuild, `alembic upgrade head`, run `aftershock player-values` once in the worker container, then check `https://www.puckquake.com/roster-lab` on a phone-sized browser, a real trade, and the share card.
