"""Team strength and pregame outcome probabilities.

Each team has an offense rating and a defense rating, both on a log scale
around 0. Expected regulation goals for the home team are

    league_avg * exp(off_home + def_away) * home_ice * fatigue

and the same for the away team without home ice. A positive defense rating
means a team allows more goals than average. After each game both ratings
move toward the observed performance, a blend of goals and xG per 60
minutes, with an exponential decay set by a half-life in games. Each new
season starts from the previous season's ratings shrunk toward the mean.

Regulation scorelines are Poisson with the diagonal inflated so the tie
rate matches history. Overtime and the shootout are resolved with measured
rates (section 8.2 of the design brief).
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Iterator
from dataclasses import asdict, dataclass, field, replace
from datetime import date
from typing import Any

import numpy as np
from numpy.typing import NDArray

MAX_GOALS = 10
OUTCOMES = ("home_reg", "home_ot", "home_so", "away_reg", "away_ot", "away_so")


@dataclass(frozen=True)
class StrengthParams:
    blend_w: float = 0.5  # weight on goals (1 - w on xG)
    half_life: float = 25.0  # games
    regress: float = 0.35  # share of the rating removed at a new season
    home_ice: float = 1.05  # multiplicative on home expected goals
    fatigue: float = 0.04  # back-to-back penalty on offense and defense
    tie_theta: float = 1.20  # diagonal inflation of regulation scorelines
    ot_k: float = 1.5  # slope of the overtime sigmoid on log strength ratio
    ot_shrink: float = 0.5  # shrink of the overtime edge toward 0.5
    p_so_given_ot: float = 0.37  # share of regular-season OTs that reach a shootout
    p_home_so: float = 0.50  # home share of shootout wins
    league_goals: float = 2.95  # regulation goals per team per game (prior)
    league_alpha: float = 0.002  # learning rate of the league average
    smooth: float = 1.0  # additive smoothing in the performance ratio

    def to_dict(self) -> dict[str, float]:
        return asdict(self)


@dataclass(frozen=True)
class Pregame:
    """Six-way outcome distribution plus the regulation goal model."""

    p: tuple[float, float, float, float, float, float]  # order of OUTCOMES
    lam_home: float
    lam_away: float
    p_reg_tie: float
    p_ot_home: float

    @property
    def p_home_win(self) -> float:
        return self.p[0] + self.p[1] + self.p[2]

    def as_dict(self) -> dict[str, float]:
        return dict(zip(OUTCOMES, self.p, strict=True))


def poisson_pmf(lam: float, n: int = MAX_GOALS) -> NDArray[np.float64]:
    k = np.arange(n + 1)
    logp = k * math.log(max(lam, 1e-9)) - lam - np.array([math.lgamma(i + 1) for i in k])
    p = np.exp(logp)
    p[-1] += max(0.0, 1.0 - p.sum())  # fold the tail into the last cell
    return np.asarray(p, dtype=np.float64)


def scoreline_table(lam_home: float, lam_away: float, theta: float) -> NDArray[np.float64]:
    """P(home = i, away = j) in regulation, with the diagonal scaled by theta."""
    t = np.outer(poisson_pmf(lam_home), poisson_pmf(lam_away))
    t[np.diag_indices_from(t)] *= theta
    return np.asarray(t / t.sum(), dtype=np.float64)


def six_way(
    lam_home: float, lam_away: float, params: StrengthParams, *, playoff: bool = False
) -> Pregame:
    t = scoreline_table(lam_home, lam_away, params.tie_theta)
    p_home_reg = float(np.tril(t, -1).sum())
    p_away_reg = float(np.triu(t, 1).sum())
    p_tie = max(0.0, 1.0 - p_home_reg - p_away_reg)
    edge = 1.0 / (1.0 + math.exp(-params.ot_k * math.log(lam_home / lam_away))) - 0.5
    q = 0.5 + params.ot_shrink * edge
    p_so = 0.0 if playoff else params.p_so_given_ot
    p = (
        p_home_reg,
        p_tie * (1 - p_so) * q,
        p_tie * p_so * params.p_home_so,
        p_away_reg,
        p_tie * (1 - p_so) * (1 - q),
        p_tie * p_so * (1 - params.p_home_so),
    )
    return Pregame(p=p, lam_home=lam_home, lam_away=lam_away, p_reg_tie=p_tie, p_ot_home=q)


@dataclass
class TeamRating:
    off: float = 0.0
    defense: float = 0.0
    last_game: date | None = None


@dataclass
class RatingEngine:
    """Sequential rating updates. Feed games in chronological order."""

    params: StrengthParams = field(default_factory=StrengthParams)
    ratings: dict[str, TeamRating] = field(default_factory=dict)
    league_goals: float = 0.0
    season: int | None = None

    def __post_init__(self) -> None:
        if self.league_goals == 0.0:
            self.league_goals = self.params.league_goals

    @property
    def alpha(self) -> float:
        return float(1.0 - 0.5 ** (1.0 / self.params.half_life))

    def team(self, abbrev: str) -> TeamRating:
        if abbrev not in self.ratings:
            self.ratings[abbrev] = TeamRating()
        return self.ratings[abbrev]

    def start_season(self, season: int) -> None:
        if self.season == season:
            return
        keep = 1.0 - self.params.regress
        for r in self.ratings.values():
            r.off *= keep
            r.defense *= keep
            r.last_game = None
        self.season = season

    def _b2b(self, r: TeamRating, day: date) -> bool:
        return r.last_game is not None and (day - r.last_game).days == 1

    def expected_goals(self, home: str, away: str, day: date | None) -> tuple[float, float]:
        h, a = self.team(home), self.team(away)
        lam_h = self.league_goals * math.exp(h.off + a.defense) * self.params.home_ice
        lam_a = self.league_goals * math.exp(a.off + h.defense)
        if day is not None:
            f = self.params.fatigue
            if self._b2b(h, day):
                lam_h *= 1 - f
                lam_a *= 1 + f
            if self._b2b(a, day):
                lam_a *= 1 - f
                lam_h *= 1 + f
        return lam_h, lam_a

    def predict(self, home: str, away: str, day: date | None, *, playoff: bool = False) -> Pregame:
        lam_h, lam_a = self.expected_goals(home, away, day)
        return six_way(lam_h, lam_a, self.params, playoff=playoff)

    def update(
        self,
        home: str,
        away: str,
        day: date,
        *,
        home_goals: float,
        away_goals: float,
        home_xg: float,
        away_xg: float,
        minutes: float,
    ) -> None:
        """Move ratings toward one finished game (goals and xG exclude the shootout)."""
        lam_h, lam_a = self.expected_goals(home, away, day)
        scale = 60.0 / max(minutes, 60.0)
        w, c = self.params.blend_w, self.params.smooth
        s_h = (w * home_goals + (1 - w) * home_xg) * scale
        s_a = (w * away_goals + (1 - w) * away_xg) * scale
        r_h = math.log((s_h + c) / (lam_h + c))
        r_a = math.log((s_a + c) / (lam_a + c))
        h, a = self.team(home), self.team(away)
        k = self.alpha
        h.off += k * r_h
        a.defense += k * r_h
        a.off += k * r_a
        h.defense += k * r_a
        h.last_game = day
        a.last_game = day
        la = self.params.league_alpha
        self.league_goals = (1 - la) * self.league_goals + la * 0.5 * (
            (home_goals + away_goals) * scale
        )
        self._recenter()

    def _recenter(self) -> None:
        n = len(self.ratings)
        if n < 2:
            return
        mo = sum(r.off for r in self.ratings.values()) / n
        md = sum(r.defense for r in self.ratings.values()) / n
        for r in self.ratings.values():
            r.off -= mo
            r.defense -= md

    def snapshot(self) -> dict[str, tuple[float, float]]:
        return {t: (r.off, r.defense) for t, r in self.ratings.items()}


@dataclass(frozen=True)
class GameRecord:
    game_id: int
    season: int
    game_type: int
    day: date
    home: str
    away: str
    last_period_type: str | None
    home_reg_goals: int
    away_reg_goals: int
    home_goals: float  # non-shootout goals
    away_goals: float
    home_xg: float
    away_xg: float
    minutes: float

    so_home: bool = False  # home team won the shootout

    @property
    def outcome_index(self) -> int:
        """Index into OUTCOMES of what actually happened."""
        lpt = self.last_period_type or "REG"
        if lpt == "SO":
            return 2 if self.so_home else 5
        home_won = self.home_goals > self.away_goals
        if lpt == "REG":
            return 0 if home_won else 3
        return 1 if home_won else 4


def records_from_table(rows: Iterable[dict[str, Any]]) -> list[GameRecord]:
    out = []
    for r in rows:
        so_home = (r["last_period_type"] == "SO") and (r["home_score"] > r["away_score"])
        out.append(
            GameRecord(
                game_id=int(r["game_id"]),
                season=int(r["season"]),
                game_type=int(r["game_type"]),
                day=r["game_date"],
                home=r["home"],
                away=r["away"],
                last_period_type=r["last_period_type"],
                home_reg_goals=int(r["home_reg_goals"]),
                away_reg_goals=int(r["away_reg_goals"]),
                home_goals=float(r["home_reg_goals"] + r["home_ot_goals"]),
                away_goals=float(r["away_reg_goals"] + r["away_ot_goals"]),
                home_xg=float(r["home_xg"]),
                away_xg=float(r["away_xg"]),
                minutes=float(r["minutes"]),
                so_home=so_home,
            )
        )
    return out


@dataclass(frozen=True)
class AsOfPrediction:
    game: GameRecord
    pregame: Pregame


def run_history(
    games: list[GameRecord], params: StrengthParams
) -> Iterator[tuple[AsOfPrediction, RatingEngine]]:
    """Predict every game with as-of ratings, then update. Yields in order."""
    engine = RatingEngine(params=params)
    for g in games:
        engine.start_season(g.season)
        pre = engine.predict(g.home, g.away, g.day, playoff=g.game_type == 3)
        yield AsOfPrediction(g, pre), engine
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


def with_params(params: StrengthParams, **changes: float) -> StrengthParams:
    return replace(params, **changes)
