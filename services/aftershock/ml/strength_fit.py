"""Tune, backtest, and export the team-strength model.

- Tuning window: regular seasons 2016-17 to 2020-21 (2015-16 warms up the
  ratings). Parameters are tuned by coordinate descent on three-way log loss.
- Backtest window: regular seasons 2021-22 to 2025-26, predicted with as-of
  ratings only (every game is predicted before its result updates anything),
  using the pre-backtest xG variant.
- Baselines: home ice only, and season-to-date points percentage.
"""

from __future__ import annotations

import json
import time
from collections import defaultdict
from dataclasses import replace
from typing import Any

import numpy as np
from numpy.typing import NDArray
from sklearn.linear_model import LogisticRegression

from aftershock.config import Settings, get_settings
from aftershock.ml import metrics
from aftershock.ml.games_table import load_games_table
from aftershock.ml.strength import (
    GameRecord,
    StrengthParams,
    records_from_table,
    run_history,
)
from aftershock.ml.xg import BACKTEST_VERSION
from aftershock.ml.xg import MODEL_VERSION as XG_VERSION

MODEL_VERSION = "strength-1.0.0"
WARMUP_SEASON = 20152016
TUNE_SEASONS = (20162017, 20172018, 20182019, 20192020, 20202021)
TEST_SEASONS = (20212022, 20222023, 20232024, 20242025, 20252026)

GRID: dict[str, list[float]] = {
    "blend_w": [0.2, 0.35, 0.5, 0.65, 0.8],
    "half_life": [8, 12, 15, 18, 22, 25, 35, 50],
    "regress": [0.0, 0.05, 0.1, 0.15, 0.25, 0.35, 0.45],
    "home_ice": [1.0, 1.02, 1.04, 1.06, 1.08, 1.1, 1.12, 1.15],
    "fatigue": [0.0, 0.02, 0.04, 0.06, 0.08, 0.1],
    "ot_k": [0.5, 1.0, 1.5, 2.5],
    "ot_shrink": [0.0, 0.25, 0.5, 0.75, 1.0],
}


def three_way(p: tuple[float, ...]) -> NDArray[np.float64]:
    """(home regulation, away regulation, beyond regulation)."""
    return np.array([p[0], p[3], p[1] + p[2] + p[4] + p[5]])


def outcome3(idx: int) -> int:
    return 0 if idx == 0 else 1 if idx == 3 else 2


def home_won(idx: int) -> int:
    return int(idx in (0, 1, 2))


def empirical_rates(games: list[GameRecord], seasons: tuple[int, ...]) -> dict[str, float]:
    reg = [g for g in games if g.season in seasons and g.game_type == 2]
    beyond = [g for g in reg if (g.last_period_type or "REG") != "REG"]
    so = [g for g in beyond if g.last_period_type == "SO"]
    return {
        "n_games": len(reg),
        "p_beyond_reg": len(beyond) / len(reg),
        "p_so_given_ot": len(so) / max(len(beyond), 1),
        "p_home_so": sum(g.so_home for g in so) / max(len(so), 1),
        "p_home_ot_given_ot_decided": sum(
            1 for g in beyond if g.last_period_type == "OT" and g.home_goals > g.away_goals
        )
        / max(sum(1 for g in beyond if g.last_period_type == "OT"), 1),
        "goals_per_team_reg": float(
            np.mean([(g.home_reg_goals + g.away_reg_goals) / 2 for g in reg])
        ),
    }


def evaluate(
    games: list[GameRecord], params: StrengthParams, seasons: tuple[int, ...]
) -> dict[str, Any]:
    y3, p3, y2, p2 = [], [], [], []
    for pred, _ in run_history(games, params):
        g = pred.game
        if g.season not in seasons or g.game_type != 2:
            continue
        idx = g.outcome_index
        y3.append(outcome3(idx))
        p3.append(three_way(pred.pregame.p))
        y2.append(home_won(idx))
        p2.append(pred.pregame.p_home_win)
    return _scores(np.array(y3), np.array(p3), np.array(y2, dtype=float), np.array(p2))


def _scores(
    y3: NDArray[Any], p3: NDArray[np.float64], y2: NDArray[np.float64], p2: NDArray[np.float64]
) -> dict[str, Any]:
    onehot = np.eye(3)[y3]
    return {
        "n": len(y2),
        "log_loss_3way": metrics.log_loss(onehot, p3),
        "log_loss_2way": metrics.log_loss(y2, p2),
        "brier_2way": metrics.brier(y2, p2),
        "accuracy": float(np.mean((p2 >= 0.5) == (y2 == 1))),
        "mean_p_beyond_reg": float(p3[:, 2].mean()),
        "actual_beyond_reg": float(onehot[:, 2].mean()),
        "reliability_home_win": metrics.reliability(y2, p2, bins=10),
    }


def tune(games: list[GameRecord], start: StrengthParams, rounds: int = 2) -> StrengthParams:
    best = start
    best_ll = evaluate(games, best, TUNE_SEASONS)["log_loss_3way"]
    for _ in range(rounds):
        for name, values in GRID.items():
            for v in values:
                cand = replace(best, **{name: float(v)})
                ll = evaluate(games, cand, TUNE_SEASONS)["log_loss_3way"]
                if ll < best_ll - 1e-6:
                    best, best_ll = cand, ll
    return best


def calibrate_tie(games: list[GameRecord], params: StrengthParams, target: float) -> StrengthParams:
    """Bisection on the diagonal inflation so the mean P(tie) matches history."""
    lo, hi = 0.8, 2.0
    for _ in range(30):
        mid = (lo + hi) / 2
        mean_tie = evaluate(games, replace(params, tie_theta=mid), TUNE_SEASONS)[
            "mean_p_beyond_reg"
        ]
        if mean_tie < target:
            lo = mid
        else:
            hi = mid
    return replace(params, tie_theta=(lo + hi) / 2)


# ----------------------------------------------------------------------
# Baselines


def _points_pct_features(games: list[GameRecord]) -> dict[int, float]:
    """Season-to-date points percentage difference (home minus away) before each game."""
    pts: dict[tuple[int, str], list[int]] = defaultdict(lambda: [0, 0])
    out: dict[int, float] = {}
    for g in games:
        if g.game_type != 2:
            continue
        h, a = pts[(g.season, g.home)], pts[(g.season, g.away)]
        hp = h[0] / (2 * h[1]) if h[1] else 0.5
        ap = a[0] / (2 * a[1]) if a[1] else 0.5
        out[g.game_id] = hp - ap
        idx = g.outcome_index
        home_pts = 2 if idx in (0, 1, 2) else (1 if idx in (4, 5) else 0)
        away_pts = 2 if idx in (3, 4, 5) else (1 if idx in (1, 2) else 0)
        h[0] += home_pts
        h[1] += 1
        a[0] += away_pts
        a[1] += 1
    return out


def baselines(games: list[GameRecord]) -> dict[str, Any]:
    reg = [g for g in games if g.game_type == 2]
    train = [g for g in reg if g.season in (WARMUP_SEASON, *TUNE_SEASONS)]
    test = [g for g in reg if g.season in TEST_SEASONS]
    y3_tr = np.array([outcome3(g.outcome_index) for g in train])
    y3_te = np.array([outcome3(g.outcome_index) for g in test])
    y2_te = np.array([home_won(g.outcome_index) for g in test], dtype=float)
    freq = np.bincount(y3_tr, minlength=3) / len(y3_tr)
    p_home = float(np.mean([home_won(g.outcome_index) for g in train]))
    home_only = _scores(y3_te, np.tile(freq, (len(test), 1)), y2_te, np.full(len(test), p_home))

    diff = _points_pct_features(reg)
    x_tr = np.array([[diff[g.game_id]] for g in train])
    x_te = np.array([[diff[g.game_id]] for g in test])
    m3 = LogisticRegression(max_iter=1000).fit(x_tr, y3_tr)
    m2 = LogisticRegression(max_iter=1000).fit(
        x_tr, np.array([home_won(g.outcome_index) for g in train])
    )
    pts_pct = _scores(y3_te, m3.predict_proba(x_te), y2_te, m2.predict_proba(x_te)[:, 1])
    return {
        "home_ice_only": home_only,
        "points_pct_to_date": pts_pct,
        "home_ice_freq_3way": freq.tolist(),
    }


# ----------------------------------------------------------------------
# Entry point


def fit(settings: Settings | None = None) -> dict[str, Any]:
    s = settings or get_settings()
    started = time.monotonic()
    bt_games = records_from_table(load_games_table(BACKTEST_VERSION, s).iter_rows(named=True))
    rates = empirical_rates(bt_games, (WARMUP_SEASON, *TUNE_SEASONS))
    start = StrengthParams(
        p_so_given_ot=rates["p_so_given_ot"],
        p_home_so=rates["p_home_so"],
        league_goals=rates["goals_per_team_reg"],
    )
    tuned = tune(bt_games, start)
    tuned = calibrate_tie(bt_games, tuned, rates["p_beyond_reg"])
    # A second pass with the calibrated tie rate, then recalibrate.
    tuned = tune(bt_games, tuned, rounds=1)
    tuned = calibrate_tie(bt_games, tuned, rates["p_beyond_reg"])

    test = evaluate(bt_games, tuned, TEST_SEASONS)
    base = baselines(bt_games)
    per_season = {
        str(season): {
            k: v
            for k, v in evaluate(bt_games, tuned, (season,)).items()
            if k != "reliability_home_win"
        }
        for season in TEST_SEASONS
    }
    report = {
        "model_version": MODEL_VERSION,
        "xg_version_backtest": BACKTEST_VERSION,
        "tune_seasons": list(TUNE_SEASONS),
        "test_seasons": list(TEST_SEASONS),
        "empirical_rates_tuning_window": rates,
        "params": tuned.to_dict(),
        "test": {"strength": test, **base},
        "test_by_season": per_season,
        "seconds": round(time.monotonic() - started, 1),
    }
    reports = s.ml_dir / "reports"
    metrics.write_json(reports / "strength.json", report)
    metrics.reliability_plot(
        reports / "strength_reliability.svg",
        {
            "Team strength": test["reliability_home_win"],
            "Points % to date": base["points_pct_to_date"]["reliability_home_win"],
        },
        "P(home win) reliability, 2021-22 to 2025-26",
        max_p=1.0,
    )
    metrics.write_json(
        s.ml_dir / "artifacts" / f"{MODEL_VERSION}.json",
        {"model_version": MODEL_VERSION, "xg_version": XG_VERSION, "params": tuned.to_dict()},
    )
    return report


def load_params(settings: Settings | None = None) -> StrengthParams:
    s = settings or get_settings()
    data = json.loads((s.ml_dir / "artifacts" / f"{MODEL_VERSION}.json").read_text())
    return StrengthParams(**data["params"])


def asof_pregame(
    xg_version: str, params: StrengthParams | None = None, settings: Settings | None = None
) -> dict[int, tuple[float, float, float]]:
    """As-of pregame (home reg win, away reg win, tie) for every game in the table."""
    s = settings or get_settings()
    p = params or load_params(s)
    games = records_from_table(load_games_table(xg_version, s).iter_rows(named=True))
    return {
        pred.game.game_id: (pred.pregame.p[0], pred.pregame.p[3], pred.pregame.p_reg_tie)
        for pred, _ in run_history(games, p)
    }
