"""Expected-goals model: training, evaluation, and inference.

Split (strictly by time): train 2015-16 to 2023-24, validate 2024-25 (early
stopping), test 2025-26. A logistic regression on distance and angle is the
baseline. Penalty shots are modeled separately as a constant rate measured on
the training seasons.
"""

from __future__ import annotations

import gzip
import json
import math
import time
from collections.abc import Iterable, Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import lightgbm as lgb
import numpy as np
import polars as pl
import structlog
from numpy.typing import NDArray
from sklearn.linear_model import LogisticRegression

from aftershock.config import Settings, get_settings
from aftershock.ml import metrics
from aftershock.ml.xg_features import (
    CATEGORICAL,
    FEATURES,
    MANPOWER_LEVELS,
    PREV_TYPE_LEVELS,
    SHOT_TYPE_LEVELS,
    xg_rows,
)
from aftershock.nhl.parse import ParsedGame, parse_play_by_play

log = structlog.get_logger(__name__)

MODEL_VERSION = "xg-1.0.0"
# Trained only on seasons before the 2021-22 to 2025-26 backtest window, so
# the strength and win-probability backtests never see xG fit on their games.
BACKTEST_VERSION = "xg-bt-1.0.0"
BACKTEST_TRAIN = tuple(range(2015, 2020))
BACKTEST_VAL = 2020
TRAIN_SEASONS = tuple(range(2015, 2024))
VAL_SEASON = 2024
TEST_SEASON = 2025
LEVELS: dict[str, tuple[str, ...]] = {
    "shot_type": SHOT_TYPE_LEVELS,
    "prev_type": PREV_TYPE_LEVELS,
    "manpower": MANPOWER_LEVELS,
}
PARAMS: dict[str, Any] = {
    "objective": "binary",
    "learning_rate": 0.03,
    "num_leaves": 31,
    "min_data_in_leaf": 200,
    "feature_fraction": 0.9,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "lambda_l2": 1.0,
    "verbose": -1,
    "seed": 7,
}


def season_id(start_year: int) -> int:
    return start_year * 10000 + start_year + 1


# ----------------------------------------------------------------------
# Feature tables


def _season_games(raw_dir: Path, start_year: int) -> list[Path]:
    return sorted((raw_dir / "play-by-play").glob(f"{start_year}0[23]*.json.gz"))


def _rows_for_file(path: str) -> list[dict[str, Any]]:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        game = parse_play_by_play(json.load(fh))
    if game.meta.state not in {"OFF", "FINAL"}:
        return []
    return xg_rows(game, include_penalty_shots=True)


def build_season_features(
    start_year: int, settings: Settings | None = None, workers: int = 6
) -> Path:
    s = settings or get_settings()
    out = s.data_dir / "features" / "xg" / f"{start_year}.parquet"
    files = [str(p) for p in _season_games(s.raw_cache_dir, start_year)]
    rows: list[dict[str, Any]] = []
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for chunk in pool.map(_rows_for_file, files, chunksize=16):
            rows.extend(chunk)
    out.parent.mkdir(parents=True, exist_ok=True)
    pl.DataFrame(rows, infer_schema_length=None).write_parquet(out)
    log.info("xg.features", season=start_year, games=len(files), rows=len(rows))
    return out


def load_features(years: Iterable[int], settings: Settings | None = None) -> pl.DataFrame:
    s = settings or get_settings()
    frames = [pl.read_parquet(s.data_dir / "features" / "xg" / f"{y}.parquet") for y in years]
    return pl.concat(frames, how="diagonal_relaxed")


def encode(df: pl.DataFrame) -> NDArray[np.float64]:
    """Feature matrix with categoricals as fixed integer codes."""
    cols = []
    for name in FEATURES:
        if name in CATEGORICAL:
            levels = {v: float(i) for i, v in enumerate(LEVELS[name])}
            cols.append(
                df[name]
                .replace_strict(levels, default=float(len(levels) - 1), return_dtype=pl.Float64)
                .to_numpy()
            )
        else:
            cols.append(df[name].cast(pl.Float64).fill_null(math.nan).to_numpy())
    return np.column_stack(cols)


def encode_rows(rows: Sequence[dict[str, Any]]) -> NDArray[np.float64]:
    out = np.empty((len(rows), len(FEATURES)), dtype=np.float64)
    maps = {n: {v: i for i, v in enumerate(LEVELS[n])} for n in CATEGORICAL}
    for i, r in enumerate(rows):
        for j, name in enumerate(FEATURES):
            v = r[name]
            if name in maps:
                out[i, j] = maps[name].get(v, len(maps[name]) - 1)
            else:
                out[i, j] = math.nan if v is None else float(v)
    return out


def _baseline_matrix(df: pl.DataFrame) -> NDArray[np.float64]:
    d = df["distance"].to_numpy()
    a = df["angle"].to_numpy()
    return np.column_stack([d, a, np.log1p(d), d * a / 100.0])


# ----------------------------------------------------------------------
# Training


def train(settings: Settings | None = None) -> dict[str, Any]:
    s = settings or get_settings()
    started = time.monotonic()
    all_df = load_features([*TRAIN_SEASONS, VAL_SEASON, TEST_SEASON], s)
    ps = all_df.filter(pl.col("penalty_shot") == 1)
    df = all_df.filter(pl.col("penalty_shot") == 0)
    start_year = pl.col("season") // 10000
    train_df = df.filter(start_year.is_in(list(TRAIN_SEASONS)))
    val_df = df.filter(start_year == VAL_SEASON)
    test_df = df.filter(start_year == TEST_SEASON)
    ps_train = ps.filter(start_year.is_in(list(TRAIN_SEASONS)))
    ps_rate = (
        float(ps_train["is_goal"].cast(pl.Float64).to_numpy().mean()) if len(ps_train) else 0.0
    )

    y_tr = train_df["is_goal"].to_numpy().astype(float)
    y_va = val_df["is_goal"].to_numpy().astype(float)
    y_te = test_df["is_goal"].to_numpy().astype(float)

    base = LogisticRegression(max_iter=1000)
    base.fit(_baseline_matrix(train_df), y_tr)
    p_base = base.predict_proba(_baseline_matrix(test_df))[:, 1]

    X_tr, X_va, X_te = encode(train_df), encode(val_df), encode(test_df)
    cat_idx = [FEATURES.index(c) for c in CATEGORICAL]
    dtrain = lgb.Dataset(X_tr, y_tr, feature_name=list(FEATURES), categorical_feature=cat_idx)
    dval = lgb.Dataset(X_va, y_va, reference=dtrain)
    booster = lgb.train(
        PARAMS,
        dtrain,
        num_boost_round=4000,
        valid_sets=[dval],
        callbacks=[lgb.early_stopping(150, verbose=False), lgb.log_evaluation(0)],
    )
    p_val = np.asarray(booster.predict(X_va, num_iteration=booster.best_iteration), dtype=float)
    p_test = np.asarray(booster.predict(X_te, num_iteration=booster.best_iteration), dtype=float)

    report: dict[str, Any] = {
        "model_version": MODEL_VERSION,
        "split": {
            "train": [season_id(y) for y in TRAIN_SEASONS],
            "validate": season_id(VAL_SEASON),
            "test": season_id(TEST_SEASON),
        },
        "rows": {"train": len(train_df), "validate": len(val_df), "test": len(test_df)},
        "best_iteration": booster.best_iteration,
        "validate": {"lightgbm": _strip(metrics.binary_report(y_va, p_val))},
        "test": {
            "lightgbm": metrics.binary_report(y_te, p_test),
            "baseline_logistic_distance_angle": metrics.binary_report(y_te, p_base),
        },
        "penalty_shot": {
            "train_attempts": len(ps_train),
            "train_goals": int(ps_train["is_goal"].sum()),
            "rate": ps_rate,
        },
        "feature_importance_gain": dict(
            sorted(
                zip(FEATURES, (float(g) for g in booster.feature_importance("gain")), strict=True),
                key=lambda kv: -kv[1],
            )
        ),
        "features": list(FEATURES),
        "seconds": round(time.monotonic() - started, 1),
    }

    art = s.ml_dir / "artifacts"
    art.mkdir(parents=True, exist_ok=True)
    booster.save_model(str(art / f"{MODEL_VERSION}.txt"), num_iteration=booster.best_iteration)
    meta = {
        "model_version": MODEL_VERSION,
        "features": list(FEATURES),
        "categorical": list(CATEGORICAL),
        "levels": {k: list(v) for k, v in LEVELS.items()},
        "penalty_shot_rate": ps_rate,
        "trained_on": report["split"],
    }
    metrics.write_json(art / f"{MODEL_VERSION}.json", meta)
    reports = s.ml_dir / "reports"
    metrics.write_json(reports / "xg.json", report)
    metrics.reliability_plot(
        reports / "xg_reliability.svg",
        {
            "LightGBM": report["test"]["lightgbm"]["reliability"],
            "Distance + angle logistic": report["test"]["baseline_logistic_distance_angle"][
                "reliability"
            ],
        },
        "xG reliability, 2025-26 test season",
    )
    log.info(
        "xg.trained", **{k: v for k, v in report["test"]["lightgbm"].items() if k != "reliability"}
    )
    return report


def train_backtest_variant(settings: Settings | None = None) -> None:
    """Fit the xG variant used for backtests (train 2015-16 to 2019-20, stop on 2020-21)."""
    s = settings or get_settings()
    df = load_features([*BACKTEST_TRAIN, BACKTEST_VAL], s).filter(pl.col("penalty_shot") == 0)
    ps = load_features(BACKTEST_TRAIN, s).filter(pl.col("penalty_shot") == 1)
    start_year = pl.col("season") // 10000
    tr = df.filter(start_year.is_in(list(BACKTEST_TRAIN)))
    va = df.filter(start_year == BACKTEST_VAL)
    cat_idx = [FEATURES.index(c) for c in CATEGORICAL]
    dtrain = lgb.Dataset(
        encode(tr),
        tr["is_goal"].to_numpy().astype(float),
        feature_name=list(FEATURES),
        categorical_feature=cat_idx,
    )
    dval = lgb.Dataset(encode(va), va["is_goal"].to_numpy().astype(float), reference=dtrain)
    booster = lgb.train(
        PARAMS,
        dtrain,
        num_boost_round=4000,
        valid_sets=[dval],
        callbacks=[lgb.early_stopping(150, verbose=False)],
    )
    art = s.ml_dir / "artifacts"
    booster.save_model(str(art / f"{BACKTEST_VERSION}.txt"), num_iteration=booster.best_iteration)
    rate = float(ps["is_goal"].cast(pl.Float64).to_numpy().mean()) if len(ps) else 0.0
    metrics.write_json(
        art / f"{BACKTEST_VERSION}.json",
        {
            "model_version": BACKTEST_VERSION,
            "features": list(FEATURES),
            "categorical": list(CATEGORICAL),
            "levels": {k: list(v) for k, v in LEVELS.items()},
            "penalty_shot_rate": rate,
            "trained_on": {
                "train": [season_id(y) for y in BACKTEST_TRAIN],
                "validate": season_id(BACKTEST_VAL),
            },
        },
    )
    log.info("xg.backtest_variant", best_iteration=booster.best_iteration)


def _strip(rep: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in rep.items() if k != "reliability"}


# ----------------------------------------------------------------------
# Inference


@dataclass
class XgModel:
    booster: lgb.Booster
    penalty_shot_rate: float
    version: str

    @classmethod
    def load(cls, settings: Settings | None = None, version: str = MODEL_VERSION) -> XgModel:
        s = settings or get_settings()
        art = s.ml_dir / "artifacts"
        meta = json.loads((art / f"{version}.json").read_text())
        booster = lgb.Booster(model_file=str(art / f"{version}.txt"))
        return cls(booster, float(meta["penalty_shot_rate"]), version)

    def predict_rows(self, rows: Sequence[dict[str, Any]]) -> NDArray[np.float64]:
        if not rows:
            return np.zeros(0)
        p = np.asarray(self.booster.predict(encode_rows(rows)), dtype=np.float64)
        ps = np.array([bool(r.get("penalty_shot")) for r in rows])
        p[ps] = self.penalty_shot_rate
        return p

    def game_xg(self, game: ParsedGame) -> dict[int, float]:
        """xG per eligible event id (penalty shots use the constant rate)."""
        rows = xg_rows(game, include_penalty_shots=True)
        return {
            int(r["event_id"]): float(v) for r, v in zip(rows, self.predict_rows(rows), strict=True)
        }


@lru_cache(maxsize=1)
def default_model() -> XgModel:
    return XgModel.load()
