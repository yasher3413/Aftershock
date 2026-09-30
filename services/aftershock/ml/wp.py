"""In-game win probability: training, evaluation, and live inference.

The regulation outcome (away win < tie < home win) is ordered, so the model is
a cumulative pair of binary LightGBM classifiers:

- A: P(home does not lose in regulation) = P(tie) + P(home win)
- B: P(home wins in regulation)

Both are constrained to increase with the score differential, so win
probability is monotonic in the score by construction. Each is calibrated
with Platt scaling on the validation season, then combined:
P(home) = B, P(away) = 1 - A, P(tie) = A - B.

Overtime and shootout outcomes come from ``ml.overtime``. Split: train
2015-16 to 2023-24, validate 2024-25, test 2025-26.
"""

from __future__ import annotations

import gzip
import json
import time
from collections.abc import Sequence
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
from aftershock.ml.overtime import overtime_probs, rate_from_so_share, shootout_home_win_prob
from aftershock.ml.strength import OUTCOMES, Pregame, StrengthParams
from aftershock.ml.wp_features import CATEGORICAL, FEATURES, MANPOWER_STATES, GameState, wp_rows
from aftershock.ml.xg import XgModel
from aftershock.ml.xg_features import xg_rows
from aftershock.nhl.parse import FINISHED_STATES, REG_GAME_S, parse_play_by_play

log = structlog.get_logger(__name__)

MODEL_VERSION = "wp-1.0.0"
TRAIN_SEASONS = tuple(range(2015, 2024))
VAL_SEASON = 2024
TEST_SEASON = 2025
BUCKETS = (
    (0, 600),
    (600, 1200),
    (1200, 1800),
    (1800, 2400),
    (2400, 3000),
    (3000, 3300),
    (3300, 3480),
    (3480, 3601),
)
PARAMS: dict[str, Any] = {
    "objective": "binary",
    "learning_rate": 0.05,
    "num_leaves": 63,
    "min_data_in_leaf": 400,
    "feature_fraction": 0.9,
    "bagging_fraction": 0.7,
    "bagging_freq": 1,
    "lambda_l2": 1.0,
    "verbose": -1,
    "seed": 11,
}

_XG: XgModel | None = None


def _init(xg_version: str) -> None:
    global _XG
    _XG = XgModel.load(version=xg_version)


def _rows_for(args: tuple[str, tuple[float, float, float] | None]) -> list[dict[str, Any]]:
    path, pre = args
    assert _XG is not None
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        game = parse_play_by_play(json.load(fh))
    if game.meta.state not in FINISHED_STATES or pre is None:
        return []
    xg = _XG.game_xg(game)
    shooter = {
        int(r["event_id"]): int(r["team_id"]) for r in xg_rows(game, include_penalty_shots=True)
    }
    return wp_rows(game, pre, xg, shooter)


def build_season_features(
    start_year: int,
    pregame: dict[int, tuple[float, float, float]],
    xg_version: str,
    settings: Settings | None = None,
    workers: int = 6,
) -> Path:
    s = settings or get_settings()
    files = sorted((s.raw_cache_dir / "play-by-play").glob(f"{start_year}0[23]*.json.gz"))
    args = [(str(f), pregame.get(int(f.name.split(".")[0]))) for f in files]
    frames: list[pl.DataFrame] = []
    with ProcessPoolExecutor(
        max_workers=workers, initializer=_init, initargs=(xg_version,)
    ) as pool:
        batch: list[dict[str, Any]] = []
        for rows in pool.map(_rows_for, args, chunksize=8):
            batch.extend(rows)
            if len(batch) > 200_000:
                frames.append(_frame(batch))
                batch = []
        if batch:
            frames.append(_frame(batch))
    out = s.data_dir / "features" / "wp" / f"{start_year}.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    df = pl.concat(frames)
    df.write_parquet(out)
    log.info("wp.features", season=start_year, games=len(files), rows=len(df))
    return out


def _frame(rows: list[dict[str, Any]]) -> pl.DataFrame:
    df = pl.DataFrame(rows, infer_schema_length=None)
    floats = [c for c in df.columns if c not in ("manpower", "game_id", "season", "target")]
    return df.with_columns([pl.col(c).cast(pl.Float32) for c in floats])


def load_features(years: Sequence[int], settings: Settings | None = None) -> pl.DataFrame:
    s = settings or get_settings()
    return pl.concat(
        [pl.read_parquet(s.data_dir / "features" / "wp" / f"{y}.parquet") for y in years]
    )


def feature_names(use_xg: bool) -> list[str]:
    return [f for f in FEATURES if use_xg or f != "xg_diff"]


def encode(df: pl.DataFrame, names: Sequence[str]) -> NDArray[np.float32]:
    cols = []
    levels = {v: float(i) for i, v in enumerate(MANPOWER_STATES)}
    for name in names:
        if name in CATEGORICAL:
            cols.append(
                df[name]
                .replace_strict(levels, default=float(len(levels) - 1), return_dtype=pl.Float32)
                .to_numpy()
            )
        else:
            cols.append(df[name].cast(pl.Float32).to_numpy())
    return np.column_stack(cols).astype(np.float32)


def encode_states(rows: Sequence[dict[str, Any]], names: Sequence[str]) -> NDArray[np.float32]:
    levels = {v: i for i, v in enumerate(MANPOWER_STATES)}
    out = np.empty((len(rows), len(names)), dtype=np.float32)
    for i, r in enumerate(rows):
        for j, n in enumerate(names):
            v = r[n]
            out[i, j] = levels.get(v, len(levels) - 1) if n in CATEGORICAL else float(v)
    return out


# ----------------------------------------------------------------------
# Calibration and combination


@dataclass(frozen=True)
class Platt:
    a: float
    b: float

    def __call__(self, p: NDArray[np.float64]) -> NDArray[np.float64]:
        p = np.clip(p, 1e-9, 1 - 1e-9)
        z = self.a * np.log(p / (1 - p)) + self.b
        return np.asarray(1.0 / (1.0 + np.exp(-z)), dtype=np.float64)


def fit_platt(p: NDArray[np.float64], y: NDArray[np.float64], w: NDArray[np.float64]) -> Platt:
    p = np.clip(p, 1e-9, 1 - 1e-9)
    z = np.log(p / (1 - p)).reshape(-1, 1)
    lr = LogisticRegression(C=1e6, max_iter=1000).fit(z, y, sample_weight=w)
    a = float(lr.coef_[0][0])
    if a <= 0:
        raise ValueError("Platt slope must be positive to keep monotonicity")
    return Platt(a, float(lr.intercept_[0]))


def combine(pa: NDArray[np.float64], pb: NDArray[np.float64]) -> NDArray[np.float64]:
    """(home, away, tie) from the cumulative pair, repaired to a distribution."""
    home = np.minimum(pb, pa)
    away = 1.0 - pa
    tie = np.clip(pa - pb, 0.0, 1.0)
    out = np.column_stack([home, away, tie])
    return np.asarray(out / out.sum(axis=1, keepdims=True), dtype=np.float64)


# ----------------------------------------------------------------------
# Training


def _monotone(names: Sequence[str]) -> list[int]:
    return [1 if n == "score_diff" else 0 for n in names]


def _fit_pair(
    tr: pl.DataFrame, va: pl.DataFrame, names: list[str]
) -> tuple[lgb.Booster, lgb.Booster]:
    X_tr, X_va = encode(tr, names), encode(va, names)
    # Per-game weights are about 1/450 per row. Rescale to mean 1 so the L2
    # penalty and hessian thresholds act at their intended scale; the relative
    # weighting (each game counts equally) is unchanged.
    w_tr = tr["weight"].to_numpy() / tr["weight"].to_numpy().mean()
    w_va = va["weight"].to_numpy() / va["weight"].to_numpy().mean()
    t_tr, t_va = tr["target"].to_numpy(), va["target"].to_numpy()
    cat = [names.index(c) for c in CATEGORICAL if c in names]
    params = {
        **PARAMS,
        "monotone_constraints": _monotone(names),
        "monotone_constraints_method": "advanced",
    }
    boosters = []
    for label_tr, label_va in (((t_tr != 1), (t_va != 1)), ((t_tr == 0), (t_va == 0))):
        dtr = lgb.Dataset(
            X_tr,
            label_tr.astype(float),
            weight=w_tr,
            feature_name=names,
            categorical_feature=cat,
            free_raw_data=False,
        )
        dva = lgb.Dataset(X_va, label_va.astype(float), weight=w_va, reference=dtr)
        boosters.append(
            lgb.train(
                params,
                dtr,
                num_boost_round=3000,
                valid_sets=[dva],
                callbacks=[lgb.early_stopping(100, verbose=False)],
            )
        )
    return boosters[0], boosters[1]


def _predict_pair(
    a: lgb.Booster, b: lgb.Booster, X: NDArray[np.float32]
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    pa = np.asarray(a.predict(X, num_iteration=a.best_iteration), dtype=np.float64)
    pb = np.asarray(b.predict(X, num_iteration=b.best_iteration), dtype=np.float64)
    return pa, pb


def _eval_3way(df: pl.DataFrame, p: NDArray[np.float64]) -> dict[str, Any]:
    y = np.eye(3)[df["target"].to_numpy()]
    w = df["weight"].to_numpy().astype(np.float64)
    elapsed = REG_GAME_S - df["secs_left"].to_numpy()
    by_bucket = {}
    for lo, hi in BUCKETS:
        m = (elapsed >= lo) & (elapsed < hi)
        if m.any():
            by_bucket[f"{lo // 60}-{min(hi, 3600) // 60} min"] = {
                "log_loss": metrics.weighted_log_loss(y[m], p[m], w[m]),
                "brier": float(np.sum(w[m] * np.sum((p[m] - y[m]) ** 2, axis=1)) / np.sum(w[m])),
                "rows": int(m.sum()),
            }
    return {
        "log_loss": metrics.weighted_log_loss(y, p, w),
        "brier": float(np.sum(w * np.sum((p - y) ** 2, axis=1)) / np.sum(w)),
        "by_bucket": by_bucket,
        "reliability": {
            name: metrics.reliability(y[:, k], p[:, k], bins=15)
            for k, name in enumerate(("home_reg_win", "away_reg_win", "tied_after_reg"))
        },
    }


def _lookup_baseline(tr: pl.DataFrame, te: pl.DataFrame) -> NDArray[np.float64]:
    """Naive table of outcome frequencies by score differential and minute."""

    def keys(df: pl.DataFrame) -> pl.DataFrame:
        return df.select(
            pl.col("score_diff").clip(-3, 3).cast(pl.Int32).alias("sd"),
            ((REG_GAME_S - pl.col("secs_left")) // 60).clip(0, 60).cast(pl.Int32).alias("mn"),
            pl.col("target"),
        )

    k = keys(tr)
    table = (
        k.group_by(["sd", "mn"])
        .agg([(pl.col("target") == i).sum().alias(f"c{i}") for i in range(3)])
        .with_columns([(pl.col(f"c{i}") + 1).alias(f"c{i}") for i in range(3)])
    )
    joined = keys(te).join(table, on=["sd", "mn"], how="left").fill_null(1)
    counts = joined.select(["c0", "c1", "c2"]).to_numpy().astype(np.float64)
    return np.asarray(counts / counts.sum(axis=1, keepdims=True), dtype=np.float64)


def _logistic_baseline(tr: pl.DataFrame, te: pl.DataFrame) -> NDArray[np.float64]:
    def mat(df: pl.DataFrame) -> NDArray[np.float64]:
        sd = df["score_diff"].to_numpy().astype(float)
        frac = 1 - df["secs_left"].to_numpy().astype(float) / REG_GAME_S
        sk = df["skater_diff"].to_numpy().astype(float)
        return np.column_stack(
            [
                sd,
                frac,
                sd * frac,
                sd * frac**2,
                sk,
                sk * frac,
                df["pre_home_reg"].to_numpy(),
                df["pre_away_reg"].to_numpy(),
            ]
        )

    lr = LogisticRegression(max_iter=2000).fit(
        mat(tr), tr["target"].to_numpy(), sample_weight=tr["weight"].to_numpy()
    )
    return np.asarray(lr.predict_proba(mat(te)), dtype=np.float64)


def train(ot_stats: dict[str, float], settings: Settings | None = None) -> dict[str, Any]:
    s = settings or get_settings()
    started = time.monotonic()
    tr = load_features(TRAIN_SEASONS, s)
    va = load_features([VAL_SEASON], s)
    te = load_features([TEST_SEASON], s)

    variants: dict[bool, dict[str, Any]] = {}
    for use_xg in (False, True):
        names = feature_names(use_xg)
        a, b = _fit_pair(tr, va, names)
        pa, pb = _predict_pair(a, b, encode(va, names))
        y_va = va["target"].to_numpy()
        w_va = va["weight"].to_numpy().astype(np.float64)
        cal_a = fit_platt(pa, (y_va != 1).astype(float), w_va)
        cal_b = fit_platt(pb, (y_va == 0).astype(float), w_va)
        p_va = combine(cal_a(pa), cal_b(pb))
        val_ll = metrics.weighted_log_loss(np.eye(3)[y_va], p_va, w_va)
        variants[use_xg] = {
            "a": a,
            "b": b,
            "cal_a": cal_a,
            "cal_b": cal_b,
            "val_ll": val_ll,
            "names": names,
        }
        log.info("wp.variant", use_xg=use_xg, val_log_loss=round(val_ll, 5))
    use_xg = variants[True]["val_ll"] < variants[False]["val_ll"]
    chosen = variants[use_xg]
    names = chosen["names"]
    pa, pb = _predict_pair(chosen["a"], chosen["b"], encode(te, names))
    p_te = combine(chosen["cal_a"](pa), chosen["cal_b"](pb))

    report: dict[str, Any] = {
        "model_version": MODEL_VERSION,
        "split": {
            "train": [y * 10000 + y + 1 for y in TRAIN_SEASONS],
            "validate": VAL_SEASON * 10000 + VAL_SEASON + 1,
            "test": TEST_SEASON * 10000 + TEST_SEASON + 1,
        },
        "rows": {"train": len(tr), "validate": len(va), "test": len(te)},
        "xg_feature": {
            "kept": use_xg,
            "val_log_loss_without": variants[False]["val_ll"],
            "val_log_loss_with": variants[True]["val_ll"],
        },
        "calibration": {"a": vars(chosen["cal_a"]), "b": vars(chosen["cal_b"])},
        "test": {
            "lightgbm_ordinal": _eval_3way(te, p_te),
            "multinomial_logistic": _eval_3way(te, _logistic_baseline(tr, te)),
            "lookup_table": _eval_3way(te, _lookup_baseline(tr, te)),
        },
        "overtime": ot_stats,
        "seconds": round(time.monotonic() - started, 1),
    }
    art = s.ml_dir / "artifacts"
    chosen["a"].save_model(
        str(art / f"{MODEL_VERSION}-a.txt"), num_iteration=chosen["a"].best_iteration
    )
    chosen["b"].save_model(
        str(art / f"{MODEL_VERSION}-b.txt"), num_iteration=chosen["b"].best_iteration
    )
    metrics.write_json(
        art / f"{MODEL_VERSION}.json",
        {
            "model_version": MODEL_VERSION,
            "features": names,
            "use_xg": use_xg,
            "calibration": report["calibration"],
            "overtime": ot_stats,
        },
    )
    reports = s.ml_dir / "reports"
    metrics.write_json(reports / "wp.json", report)
    lgbm = report["test"]["lightgbm_ordinal"]
    metrics.reliability_plot(
        reports / "wp_reliability.svg",
        {
            "Home regulation win": lgbm["reliability"]["home_reg_win"],
            "Away regulation win": lgbm["reliability"]["away_reg_win"],
            "Tied after regulation": lgbm["reliability"]["tied_after_reg"],
        },
        "Win probability reliability, 2025-26 test season",
        max_p=1.0,
    )
    labels = list(lgbm["by_bucket"])
    metrics.bar_plot(
        reports / "wp_logloss_by_time.svg",
        labels,
        {
            "Ordinal LightGBM": [lgbm["by_bucket"][k]["log_loss"] for k in labels],
            "Multinomial logistic": [
                report["test"]["multinomial_logistic"]["by_bucket"][k]["log_loss"] for k in labels
            ],
            "Score and time table": [
                report["test"]["lookup_table"]["by_bucket"][k]["log_loss"] for k in labels
            ],
        },
        "Log loss by elapsed game time, 2025-26",
        "Log loss (lower is better)",
    )
    return report


# ----------------------------------------------------------------------
# Overtime and shootout measurements


def _ot_so_counts(path: str) -> tuple[float, int, int, int, int, int]:
    """(OT seconds, OT goals, SO attempts, SO goals, OT games, SO games) for one game."""
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        raw = json.load(fh)
    if raw.get("gameType") != 2 or raw.get("gameState") not in FINISHED_STATES:
        return (0.0, 0, 0, 0, 0, 0)
    game = parse_play_by_play(raw)
    lpt = game.meta.last_period_type
    if lpt not in ("OT", "SO"):
        return (0.0, 0, 0, 0, 0, 0)
    ot_goals = sum(1 for p in game.plays if p.type == "goal" and p.period_type == "OT")
    ot_end = max((p.t_game_s for p in game.plays if p.period_type == "OT"), default=REG_GAME_S)
    so = [
        p
        for p in game.plays
        if p.period_type == "SO"
        and p.type in ("goal", "shot-on-goal", "missed-shot", "failed-shot-attempt")
    ]
    so_goals = sum(1 for p in so if p.type == "goal")
    return (float(ot_end - REG_GAME_S), ot_goals, len(so), so_goals, 1, int(lpt == "SO"))


def measure_overtime(
    years: Sequence[int], settings: Settings | None = None, workers: int = 6
) -> dict[str, float]:
    s = settings or get_settings()
    files = [
        str(f)
        for y in years
        for f in sorted((s.raw_cache_dir / "play-by-play").glob(f"{y}02*.json.gz"))
    ]
    tot = np.zeros(6)
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for row in pool.map(_ot_so_counts, files, chunksize=64):
            tot += np.array(row)
    ot_secs, ot_goals, so_att, so_goals, ot_games, so_games = tot
    p_so = so_games / ot_games
    return {
        "ot_games": int(ot_games),
        "ot_seconds": float(ot_secs),
        "ot_goals": int(ot_goals),
        "ot_goal_rate_per_s_observed": float(ot_goals / ot_secs),
        "p_so_given_ot": float(p_so),
        "ot_goal_rate_per_s_implied": rate_from_so_share(p_so),
        "so_attempts": int(so_att),
        "so_goals": int(so_goals),
        "so_conversion": float(so_goals / so_att),
    }


# ----------------------------------------------------------------------
# Live inference


@dataclass
class ShootoutState:
    home_goals: int = 0
    away_goals: int = 0
    home_attempts: int = 0
    away_attempts: int = 0
    home_shoots_first: bool = True


class WinProbModel:
    def __init__(
        self, a: lgb.Booster, b: lgb.Booster, meta: dict[str, Any], params: StrengthParams
    ) -> None:
        self.a, self.b = a, b
        self.names: list[str] = list(meta["features"])
        self.cal_a = Platt(**meta["calibration"]["a"])
        self.cal_b = Platt(**meta["calibration"]["b"])
        ot = meta["overtime"]
        self.ot_rate = float(ot["ot_goal_rate_per_s_implied"])
        self.so_conv = float(ot["so_conversion"])
        self.params = params
        self.version = str(meta["model_version"])

    @classmethod
    def load(cls, settings: Settings | None = None) -> WinProbModel:
        from aftershock.ml.strength_fit import load_params

        s = settings or get_settings()
        art = s.ml_dir / "artifacts"
        meta = json.loads((art / f"{MODEL_VERSION}.json").read_text())
        return cls(
            lgb.Booster(model_file=str(art / f"{MODEL_VERSION}-a.txt")),
            lgb.Booster(model_file=str(art / f"{MODEL_VERSION}-b.txt")),
            meta,
            load_params(s),
        )

    def regulation(
        self, states: Sequence[GameState], pregame: Sequence[Pregame]
    ) -> NDArray[np.float64]:
        """(home, away, tie) at end of regulation for each state."""
        rows = [st.features(_pre3(pg)) for st, pg in zip(states, pregame, strict=True)]
        X = encode_states(rows, self.names)
        pa = np.asarray(self.a.predict(X), dtype=np.float64)
        pb = np.asarray(self.b.predict(X), dtype=np.float64)
        return combine(self.cal_a(pa), self.cal_b(pb))

    def six_way(
        self,
        state: GameState,
        pregame: Pregame,
        *,
        playoff: bool = False,
        shootout: ShootoutState | None = None,
        final: bool = False,
    ) -> dict[str, float]:
        """Six-way outcome distribution for a game in progress (or finished)."""
        q = pregame.p_ot_home
        if final or shootout is not None:
            if shootout is None:
                return _final_six_way(state, playoff)
            p_home = shootout_home_win_prob(
                shootout.home_goals,
                shootout.away_goals,
                shootout.home_attempts,
                shootout.away_attempts,
                home_shoots_first=shootout.home_shoots_first,
                p_home=self.so_conv,
            )
            return _six(0, 0, p_home, 0, 0, 1 - p_home)
        if state.period >= 4 or state.period_type == "OT":
            if state.home_score != state.away_score:
                return _final_six_way(state, playoff)
            ot_len = 1200 if playoff else 300
            period_start = REG_GAME_S + (state.period - 4) * (1200 if playoff else 300)
            secs_left = max(0.0, period_start + ot_len - state.t_game_s)
            h, a, so = overtime_probs(secs_left, q, self.ot_rate, playoff=playoff)
            return _six(0, h, so * self.params.p_home_so, 0, a, so * (1 - self.params.p_home_so))
        reg = self.regulation([state], [pregame])[0]
        h_ot, a_ot, so = overtime_probs(300.0, q, self.ot_rate, playoff=playoff)
        tie = float(reg[2])
        return _six(
            float(reg[0]),
            tie * h_ot,
            tie * so * self.params.p_home_so,
            float(reg[1]),
            tie * a_ot,
            tie * so * (1 - self.params.p_home_so),
        )


def _pre3(pg: Pregame) -> tuple[float, float, float]:
    return (pg.p[0], pg.p[3], pg.p_reg_tie)


def _six(*vals: float) -> dict[str, float]:
    total = sum(vals)
    return {k: v / total for k, v in zip(OUTCOMES, vals, strict=True)}


def _final_six_way(state: GameState, playoff: bool) -> dict[str, float]:
    home = state.home_score > state.away_score
    if state.period <= 3 and state.period_type == "REG":
        return _six(float(home), 0, 0, float(not home), 0, 0)
    return _six(0, float(home), 0, 0, float(not home), 0)


@lru_cache(maxsize=1)
def default_model() -> WinProbModel:
    return WinProbModel.load()
