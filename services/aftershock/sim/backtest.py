"""Season backtests of playoff odds (Phase 8).

For a season and an as-of date, rebuild exactly what was knowable that
morning: results so far and team ratings from games before that date (with
the pre-backtest xG variant). Simulate the rest of the season and score
P(playoffs) against who actually made it.

Future games are predicted with ratings shrunk toward the league mean by a
factor ``shrink``. Current ratings are noisy estimates of strength, and a
season simulation compounds any overconfidence across dozens of games, so
the factor is tuned on 2016-17 to 2018-19 and then held fixed for the
reported seasons (2021-22 to 2025-26).
"""

from __future__ import annotations

import copy
import gzip
import json
from dataclasses import dataclass
from datetime import date
from typing import Any

import numpy as np
from numpy.typing import NDArray
from sklearn.linear_model import LogisticRegression

from aftershock.config import REPO_ROOT, Settings, get_settings
from aftershock.ml import metrics
from aftershock.ml.games_table import load_games_table
from aftershock.ml.strength import RatingEngine, StrengthParams, records_from_table
from aftershock.ml.strength_fit import load_params
from aftershock.ml.xg import BACKTEST_VERSION
from aftershock.sim.inputs import END_CODES, config_name, playoff_matrix

TUNE_SEASONS = (20162017, 20172018, 20182019)
REPORT_SEASONS = (20212022, 20222023, 20232024, 20242025, 20252026)
CHECKPOINT_MONTHS = (10, 11, 12, 1, 2, 3, 4)
RAMP_FRACTION = 0.15  # share of the season after which the mid-season shrink applies
SHRINK_GRID = (1.0, 0.85, 0.7, 0.6, 0.5, 0.4, 0.3)
N_SIMS = 4000

# Pulled-goalie overtime losses recorded as regulation losses (see the gold test).
OT_FORFEITS = {2023021166}


def load_gold(season: int) -> dict[str, Any]:
    path = REPO_ROOT / "tests" / "fixtures" / "gold" / f"{season}.json.gz"
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return dict(json.load(fh))


def checkpoints(season: int) -> list[date]:
    y = season // 10000
    return [date(y if m >= 8 else y + 1, m, 1) for m in CHECKPOINT_MONTHS]


@dataclass
class Checkpoint:
    season: int
    as_of: date
    engine: RatingEngine
    points_pct: dict[str, float]


def build_checkpoints(
    seasons: tuple[int, ...], params: StrengthParams, settings: Settings
) -> list[Checkpoint]:
    """Walk every game since 2015-16 once, snapshotting ratings at each checkpoint."""
    games = records_from_table(load_games_table(BACKTEST_VERSION, settings).iter_rows(named=True))
    wanted = sorted((s, d) for s in seasons for d in checkpoints(s))
    out: list[Checkpoint] = []
    engine = RatingEngine(params=params)
    pts: dict[tuple[int, str], list[int]] = {}
    i = 0
    for season, day in wanted:
        while i < len(games) and games[i].day < day:
            g = games[i]
            engine.start_season(g.season)
            engine.update(
                g.home,
                g.away,
                g.day,
                home_goals=g.home_goals,
                away_goals=g.away_goals,
                home_xg=g.home_xg,
                away_xg=g.away_xg,
                minutes=g.minutes,
            )
            if g.game_type == 2:
                idx = g.outcome_index
                for team, won, otl in (
                    (g.home, idx in (0, 1, 2), idx in (4, 5)),
                    (g.away, idx in (3, 4, 5), idx in (1, 2)),
                ):
                    acc = pts.setdefault((g.season, team), [0, 0])
                    acc[0] += 2 if won else (1 if otl else 0)
                    acc[1] += 1
            i += 1
        snap = copy.deepcopy(engine)
        snap.start_season(season)
        pp = {t: (v[0] / (2 * v[1]) if v[1] else 0.5) for (s, t), v in pts.items() if s == season}
        out.append(Checkpoint(season, day, snap, pp))
    return out


@dataclass(frozen=True)
class ShrinkSchedule:
    """Rating shrink for simulated games: ``start`` before the season, easing
    linearly to ``mid`` once RAMP_FRACTION of the season has been played."""

    start: float
    mid: float

    def __call__(self, fraction_played: float) -> float:
        k = min(1.0, max(0.0, fraction_played / RAMP_FRACTION))
        return self.start + (self.mid - self.start) * k


def shrunk(engine: RatingEngine, shrink: float) -> RatingEngine:
    e = copy.deepcopy(engine)
    for r in e.ratings.values():
        r.off *= shrink
        r.defense *= shrink
        r.last_game = None
    return e


def simulate_checkpoint(
    cp: Checkpoint, shrink: float | ShrinkSchedule, sim_factory: Any, seed: int = 7
) -> tuple[list[str], NDArray[np.float64], set[str]]:
    """(teams, P(playoffs) per team, actual playoff teams)."""
    gold = load_gold(cp.season)
    if isinstance(shrink, ShrinkSchedule):
        played = sum(1 for r in gold["results"] if date.fromisoformat(r["date"]) < cp.as_of)
        shrink = shrink(played / len(gold["results"]))
    cfg_teams: list[str] = sim_factory.config_teams(config_name(cp.season))
    idx = {t: i for i, t in enumerate(cfg_teams)}
    results = sorted(gold["results"], key=lambda r: (r["date"], r["id"]))
    n = len(results)
    home = np.array([idx[r["home"]] for r in results], dtype=np.uint16)
    away = np.array([idx[r["away"]] for r in results], dtype=np.uint16)
    status = np.zeros(n, dtype=np.uint8)
    hg = np.zeros(n, dtype=np.uint8)
    ag = np.zeros(n, dtype=np.uint8)
    end = np.zeros(n, dtype=np.uint8)
    probs = np.zeros((n, 6), dtype=np.float32)
    lam = np.zeros((n, 2), dtype=np.float32)
    eng = shrunk(cp.engine, shrink)
    for k, r in enumerate(results):
        if date.fromisoformat(r["date"]) < cp.as_of:
            status[k] = 2
            hg[k], ag[k] = r["home_goals"], r["away_goals"]
            end[k] = 3 if r["id"] in OT_FORFEITS else END_CODES[r["end"]]
        else:
            pre = eng.predict(r["home"], r["away"], None)
            probs[k] = pre.p
            lam[k] = (pre.lam_home, pre.lam_away)
    sim = sim_factory.Simulator(config_name(cp.season), home, away)
    res = sim.run(
        status,
        hg,
        ag,
        end,
        np.zeros(n, np.uint8),
        np.zeros(n, np.uint8),
        probs,
        lam,
        playoff_matrix(eng, cfg_teams),
        float(eng.params.tie_theta),
        N_SIMS,
        seed,
        np.zeros(0, np.uint32),
    )
    actual = {
        o["abbrev"]
        for o in gold["official"]
        if o["division_seq"] <= 3 or 1 <= o["wildcard_seq"] <= 2
    }
    return cfg_teams, np.asarray(res.metrics["p_playoffs"], dtype=np.float64), actual


def score(
    cps: list[Checkpoint], shrink: float | ShrinkSchedule, sim_factory: Any
) -> tuple[float, list[tuple[float, int, int, date]]]:
    rows: list[tuple[float, int, int, date]] = []
    for cp in cps:
        teams, p, actual = simulate_checkpoint(cp, shrink, sim_factory)
        rows.extend(
            (float(pi), int(t in actual), cp.season, cp.as_of)
            for t, pi in zip(teams, p, strict=True)
        )
    y = np.array([r[1] for r in rows], dtype=float)
    p = np.array([r[0] for r in rows])
    return float(np.mean((p - y) ** 2)), rows


def run_backtest(settings: Settings | None = None) -> dict[str, Any]:
    import aftershock_core

    s = settings or get_settings()
    params = load_params(s)
    tune_cps = build_checkpoints(TUNE_SEASONS, params, s)
    pre = [c for c in tune_cps if c.as_of.month == 10]
    rest = [c for c in tune_cps if c.as_of.month != 10]
    grid_pre = {k: score(pre, k, aftershock_core)[0] for k in SHRINK_GRID}
    grid = {k: score(rest, k, aftershock_core)[0] for k in SHRINK_GRID}
    best = ShrinkSchedule(
        start=min(grid_pre, key=lambda k: grid_pre[k]), mid=min(grid, key=lambda k: grid[k])
    )
    report_cps = build_checkpoints(REPORT_SEASONS, params, s)
    brier, rows = score(report_cps, best, aftershock_core)
    _, rows_unshrunk = score(report_cps, 1.0, aftershock_core)

    # Baseline: logistic regression of P(playoffs) on points percentage to
    # date and games played, fit on the tuning seasons.
    def pp_rows(cps: list[Checkpoint]) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
        X, y = [], []
        for cp in cps:
            gold = load_gold(cp.season)
            actual = {
                o["abbrev"]
                for o in gold["official"]
                if o["division_seq"] <= 3 or 1 <= o["wildcard_seq"] <= 2
            }
            months = (cp.as_of.year - (cp.season // 10000)) * 12 + cp.as_of.month - 10
            for t in (x["abbrev"] for x in gold["teams"]):
                pp = cp.points_pct.get(t, 0.5)
                X.append([pp - 0.5, (pp - 0.5) * months])
                y.append(1.0 if t in actual else 0.0)
        return np.array(X), np.array(y)

    Xt, yt = pp_rows(tune_cps)
    Xr, yr = pp_rows(report_cps)
    base = LogisticRegression(max_iter=1000).fit(Xt, yt)
    p_base = base.predict_proba(Xr)[:, 1]

    y = np.array([r[1] for r in rows], dtype=float)
    p = np.array([r[0] for r in rows])
    p0 = np.array([r[0] for r in rows_unshrunk])
    by_month: dict[str, dict[str, float]] = {}
    for m in CHECKPOINT_MONTHS:
        mask = np.array([r[3].month == m for r in rows])
        name = date(2000, m, 1).strftime("%B 1")
        by_month[name] = {
            "sim": float(np.mean((p[mask] - y[mask]) ** 2)),
            "sim_unshrunk": float(np.mean((p0[mask] - y[mask]) ** 2)),
            "points_pct_baseline": float(np.mean((p_base[mask] - yr[mask]) ** 2)),
        }
    report: dict[str, Any] = {
        "tune_seasons": list(TUNE_SEASONS),
        "report_seasons": list(REPORT_SEASONS),
        "checkpoints": [date(2000, m, 1).strftime("%B 1") for m in CHECKPOINT_MONTHS],
        "n_sims": N_SIMS,
        "shrink_grid_brier_preseason": {str(k): v for k, v in grid_pre.items()},
        "shrink_grid_brier_in_season": {str(k): v for k, v in grid.items()},
        "shrink": {"start": best.start, "mid": best.mid, "ramp_fraction": RAMP_FRACTION},
        "brier": {
            "sim": brier,
            "sim_unshrunk": float(np.mean((p0 - y) ** 2)),
            "points_pct_baseline": float(np.mean((p_base - yr) ** 2)),
        },
        "brier_by_checkpoint": by_month,
        "reliability": {
            "sim": metrics.reliability(y, p, bins=10, strategy="uniform"),
            "points_pct_baseline": metrics.reliability(yr, p_base, bins=10, strategy="uniform"),
        },
        "rows": len(rows),
    }
    reports = s.ml_dir / "reports"
    metrics.write_json(reports / "backtest.json", report)
    metrics.reliability_plot(
        reports / "backtest_reliability.svg",
        {
            "Simulator": report["reliability"]["sim"],
            "Points % baseline": report["reliability"]["points_pct_baseline"],
        },
        "P(playoffs) reliability, 2021-22 to 2025-26 checkpoints",
        max_p=1.0,
    )
    metrics.write_json(
        s.ml_dir / "artifacts" / "sim-1.0.0.json",
        {
            "shrink_start": best.start,
            "shrink_mid": best.mid,
            "ramp_fraction": RAMP_FRACTION,
            "tuned_on": list(TUNE_SEASONS),
        },
    )
    return report


def load_shrink(settings: Settings | None = None) -> ShrinkSchedule:
    s = settings or get_settings()
    path = s.ml_dir / "artifacts" / "sim-1.0.0.json"
    if not path.exists():
        return ShrinkSchedule(1.0, 1.0)
    data = json.loads(path.read_text())
    return ShrinkSchedule(float(data["shrink_start"]), float(data["shrink_mid"]))
