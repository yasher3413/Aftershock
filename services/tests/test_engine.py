"""The season engine end to end on a real game, with the stub simulator."""

from __future__ import annotations

import copy
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import numpy as np
import pytest

from aftershock.live.engine import SeasonEngine
from aftershock.live.source import ReplayGame
from aftershock.ml.strength import StrengthParams
from aftershock.ml.wp import WinProbModel
from aftershock.ml.xg import XgModel
from aftershock.nhl.parse import parse_play_by_play
from aftershock.sim.backend import StubBackend
from aftershock.sim.inputs import STATUS_FUTURE, SeasonSchedule, SimInputs
from aftershock.tremors.compute import MagnitudeScale

Fixture = Callable[[str], Any]


def season_for(game: dict[str, Any]) -> tuple[SimInputs, dict[str, str]]:
    """A 20-team toy season that contains the fixture game plus filler games."""
    home, away = game["homeTeam"]["abbrev"], game["awayTeam"]["abbrev"]
    others = [f"X{i:02d}" for i in range(18)]
    teams = sorted([home, away, *others])
    idx = {t: i for i, t in enumerate(teams)}
    rng = np.random.default_rng(1)
    pairs = [(idx[home], idx[away])]
    for _ in range(12):
        order = rng.permutation(len(teams))
        pairs += [(int(order[i]), int(order[i + 1])) for i in range(0, len(teams), 2)]
    n = len(pairs)
    start = datetime(2025, 10, 8, tzinfo=UTC)
    sch = SeasonSchedule(
        season=int(game["season"]),
        config="test",
        teams=teams,
        game_ids=np.array([int(game["id"]), *range(1, n)], dtype=np.int64),
        home=np.array([p[0] for p in pairs], dtype=np.uint16),
        away=np.array([p[1] for p in pairs], dtype=np.uint16),
        start_utc=[start + timedelta(hours=i) for i in range(n)],
    )
    probs = np.tile(np.array([0.39, 0.06, 0.04, 0.37, 0.08, 0.06], np.float32), (n, 1))
    inputs = SimInputs(
        schedule=sch,
        status=np.full(n, STATUS_FUTURE, np.uint8),
        home_goals=np.zeros(n, np.uint8),
        away_goals=np.zeros(n, np.uint8),
        end=np.zeros(n, np.uint8),
        live_home=np.zeros(n, np.uint8),
        live_away=np.zeros(n, np.uint8),
        probs=probs,
        lam=np.tile(np.array([3.0, 2.8], np.float32), (n, 1)),
        playoff_p=np.full((20, 20), 0.5, np.float32),
        tie_theta=1.5,
        focus=np.array([0], np.uint32),
    )
    conf = {t: ("E" if i < 10 else "W") for i, t in enumerate(teams)}
    return inputs, conf


@pytest.fixture(scope="module")
def models() -> tuple[WinProbModel, XgModel]:
    return WinProbModel.load(), XgModel.load()


def make_engine(raw: dict[str, Any], models: tuple[WinProbModel, XgModel]) -> SeasonEngine:
    inputs, conf = season_for(raw)
    return SeasonEngine(
        inputs=inputs,
        backend=StubBackend(conf),
        wp_model=models[0],
        xg_model=models[1],
        params=StrengthParams(tie_theta=1.5),
        n_sims=3000,
        magnitude=MagnitudeScale(0.5, 2.0),
        pregame_lambdas=lambda gid: (3.1, 2.9),
    )


def test_replay_produces_one_tremor_per_goal_and_a_final_run(
    fixture: Fixture, models: tuple[WinProbModel, XgModel]
) -> None:
    raw = fixture("pbp_regulation_en")
    engine = make_engine(raw, models)
    engine.full_run("nightly")
    tremors, finals, odds = [], [], []
    for _, doc in ReplayGame(raw).frames():
        eff = engine.handle(doc, parse_play_by_play(doc))
        tremors += eff.tremors
        finals += eff.finals
        odds += eff.odds
    goals = [p for p in raw["plays"] if p["typeDescKey"] == "goal"]
    assert len(tremors) == len(goals)
    assert finals == [raw["id"]] and len(odds) == 1
    for t in tremors:
        assert 0 <= t.calc.magnitude <= 10
        assert t.calc.ppa == pytest.approx(t.calc.deltas[t.team]["d_playoffs"])
        # A goal can only help the scoring team's chance to win the game.
        side = "home" if t.team == t.home else "away"
        before = sum(v for k, v in t.wp_before.items() if k.startswith(side))
        after = sum(v for k, v in t.wp_after.items() if k.startswith(side))
        assert after >= before - 1e-9
        assert t.score_after[side] == t.score_before[side] + 1
    # The final is recorded as a result in the season inputs.
    i = engine.inputs.schedule.index[raw["id"]]
    assert engine.inputs.status[i] == 2
    assert int(engine.inputs.home_goals[i]) == raw["homeTeam"]["score"]


def test_overturned_goal_reverses_its_tremor(
    fixture: Fixture, models: tuple[WinProbModel, XgModel]
) -> None:
    raw = fixture("pbp_regulation_en")
    game = ReplayGame(raw)
    goal_idx = next(i for i, p in enumerate(game.plays) if p["typeDescKey"] == "goal")
    engine = make_engine(raw, models)
    engine.full_run("nightly")
    with_goal = game.at_index(goal_idx + 4)
    eff = engine.handle(with_goal, parse_play_by_play(with_goal))
    assert len(eff.tremors) == 1
    removed = copy.deepcopy(with_goal)
    del removed["plays"][goal_idx]
    before = game.at_index(goal_idx)
    removed["homeTeam"]["score"] = before["homeTeam"]["score"]
    removed["awayTeam"]["score"] = before["awayTeam"]["score"]
    eff2 = engine.handle(removed, parse_play_by_play(removed))
    assert len(eff2.reversals) == 1
    rec, calc = eff2.reversals[0]
    assert rec.overturned
    scoring = rec.team
    # Undoing the goal moves the scorer's odds back down (or leaves them level).
    assert calc.deltas[scoring]["d_playoffs"] <= 1e-9
    state = engine.games[raw["id"]].tracker.state
    assert (state.home_score, state.away_score) == (
        before["homeTeam"]["score"],
        before["awayTeam"]["score"],
    )


def test_scorer_correction_updates_attribution(
    fixture: Fixture, models: tuple[WinProbModel, XgModel]
) -> None:
    raw = fixture("pbp_regulation_en")
    game = ReplayGame(raw)
    goal_idx = next(i for i, p in enumerate(game.plays) if p["typeDescKey"] == "goal")
    engine = make_engine(raw, models)
    doc = game.at_index(goal_idx + 1)
    engine.handle(doc, parse_play_by_play(doc))
    fixed = copy.deepcopy(doc)
    fixed["plays"][goal_idx]["details"]["scoringPlayerId"] = 42
    eff = engine.handle(fixed, parse_play_by_play(fixed))
    assert eff.corrections and eff.corrections[0][1] == {"scorer_id": 42}
    assert not eff.tremors and not eff.reversals
