"""In-game state reconstruction for the win-probability model.

``GameStateTracker`` replays a game's plays and exposes the state at any
moment: score, manpower, seconds left on the current power play, empty nets,
and cumulative xG. The same tracker drives live inference, so training rows
and live features are computed by identical code.

Training rows are sampled at every regulation event and every 30 seconds of
regulation game time. The target is the state at the end of regulation.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from aftershock.nhl.parse import REG_GAME_S, ParsedGame, Play, Situation

SAMPLE_EVERY_S = 30
MANPOWER_STATES = (
    "5v5",
    "5v4",
    "4v5",
    "5v3",
    "3v5",
    "4v4",
    "3v3",
    "4v3",
    "3v4",
    "6v5",
    "5v6",
    "6v4",
    "4v6",
    "other",
)
FEATURES = (
    "score_diff",
    "secs_left",
    "period",
    "skater_diff",
    "manpower",
    "pp_secs_left",
    "home_goalie_in",
    "away_goalie_in",
    "pre_home_reg",
    "pre_away_reg",
    "pre_tie",
    "xg_diff",
    "total_goals",
)
CATEGORICAL = ("manpower",)

# Penalty type codes that change manpower. Misconducts do not.
MANPOWER_PENALTIES = frozenset({"MIN", "BEN", "MAJ", "MATCH"})


@dataclass
class _Penalty:
    team_is_home: bool
    ends_s: float
    minor: bool


@dataclass
class GameState:
    """Home-perspective state at a moment in a game."""

    t_game_s: float = 0.0
    period: int = 1
    period_type: str = "REG"
    home_score: int = 0
    away_score: int = 0
    situation: Situation = field(default_factory=lambda: Situation(True, 5, 5, True))
    pp_secs_left: float = 0.0
    xg_home: float = 0.0
    xg_away: float = 0.0

    @property
    def score_diff(self) -> int:
        return self.home_score - self.away_score

    @property
    def secs_left_reg(self) -> float:
        return max(0.0, REG_GAME_S - self.t_game_s)

    @property
    def manpower(self) -> str:
        s = f"{self.situation.home_skaters}v{self.situation.away_skaters}"
        return s if s in MANPOWER_STATES else "other"

    def features(self, pregame: tuple[float, float, float]) -> dict[str, Any]:
        sit = self.situation
        return {
            "score_diff": max(-6, min(6, self.score_diff)),
            "secs_left": self.secs_left_reg,
            "period": min(self.period, 3),
            "skater_diff": sit.home_skaters - sit.away_skaters,
            "manpower": self.manpower,
            "pp_secs_left": self.pp_secs_left,
            "home_goalie_in": int(sit.home_goalie),
            "away_goalie_in": int(sit.away_goalie),
            "pre_home_reg": pregame[0],
            "pre_away_reg": pregame[1],
            "pre_tie": pregame[2],
            "xg_diff": self.xg_home - self.xg_away,
            "total_goals": self.home_score + self.away_score,
        }


class GameStateTracker:
    """Applies plays in order and maintains a ``GameState``."""

    def __init__(
        self,
        home_id: int,
        xg: dict[int, float] | None = None,
        shooter_team: dict[int, int] | None = None,
    ) -> None:
        self.home_id = home_id
        self.state = GameState()
        self._penalties: list[_Penalty] = []
        self._xg = xg or {}
        self._shooter_team = shooter_team or {}

    def set_xg(self, xg: dict[int, float], shooter_team: dict[int, int]) -> None:
        """Provide per-event xG (and the shooting team) for the cumulative xG feature."""
        self._xg = xg
        self._shooter_team = shooter_team

    @property
    def xg_maps(self) -> tuple[dict[int, float], dict[int, int]]:
        return self._xg, self._shooter_team

    def _expire(self, t: float) -> None:
        self._penalties = [p for p in self._penalties if p.ends_s > t]

    def _pp_left(self, t: float) -> float:
        sit = self.state.situation
        diff = sit.home_skaters - sit.away_skaters
        if diff == 0:
            return 0.0
        # The team with more skaters is on the power play; count down the
        # shorthanded team's earliest-expiring penalty.
        shorthanded_home = diff < 0
        remaining = [p.ends_s - t for p in self._penalties if p.team_is_home == shorthanded_home]
        if not remaining:
            return 0.0
        left = min(remaining)
        return left if diff > 0 else -left

    def advance(self, t: float) -> GameState:
        """Move the clock to ``t`` (no events) and return the state."""
        self.state.t_game_s = t
        self._expire(t)
        self.state.pp_secs_left = self._pp_left(t)
        return self.state

    def apply(self, p: Play) -> GameState:
        s = self.state
        s.t_game_s = float(p.t_game_s)
        s.period = p.period
        s.period_type = p.period_type
        self._expire(s.t_game_s)
        sit = p.situation
        if sit is not None and p.period_type != "SO":
            s.situation = sit
        if p.type == "goal" and p.period_type != "SO":
            if p.home_score is not None and p.away_score is not None:
                s.home_score, s.away_score = p.home_score, p.away_score
            scorer_home = p.owner_team_id == self.home_id
            # A power-play goal ends the earliest minor of the shorthanded team.
            minors = sorted(
                (x for x in self._penalties if x.minor and x.team_is_home != scorer_home),
                key=lambda x: x.ends_s,
            )
            if minors and self._pp_left(s.t_game_s) * (1 if scorer_home else -1) > 0:
                self._penalties.remove(minors[0])
        if p.type == "penalty" and p.penalty_type in MANPOWER_PENALTIES and p.penalty_minutes:
            team_is_home = p.owner_team_id == self.home_id
            minutes = p.penalty_minutes
            self._penalties.append(
                _Penalty(team_is_home, s.t_game_s + 60 * minutes, minor=minutes in (2, 4))
            )
        if p.event_id in self._xg:
            if self._shooter_team.get(p.event_id) == self.home_id:
                s.xg_home += self._xg[p.event_id]
            else:
                s.xg_away += self._xg[p.event_id]
        s.pp_secs_left = self._pp_left(s.t_game_s)
        return s


def regulation_target(game: ParsedGame) -> int:
    """0 home regulation win, 1 away regulation win, 2 tied after regulation."""
    home = away = 0
    for p in game.plays:
        if p.type == "goal" and p.period <= 3:
            if p.owner_team_id == game.meta.home.id:
                home += 1
            else:
                away += 1
    return 0 if home > away else 1 if away > home else 2


def wp_rows(
    game: ParsedGame,
    pregame: tuple[float, float, float],
    xg: dict[int, float] | None = None,
    shooter_team: dict[int, int] | None = None,
) -> list[dict[str, Any]]:
    """Training rows for one game: every regulation event plus a 30 s grid."""
    target = regulation_target(game)
    tracker = GameStateTracker(game.meta.home.id, xg, shooter_team)
    rows: list[dict[str, Any]] = []
    next_sample = 0.0
    reg_plays: Iterable[Play] = (p for p in game.plays if p.period <= 3)
    for p in reg_plays:
        while next_sample < p.t_game_s and next_sample <= REG_GAME_S:
            rows.append(tracker.advance(next_sample).features(pregame))
            next_sample += SAMPLE_EVERY_S
        rows.append(tracker.apply(p).features(pregame))
    while next_sample <= REG_GAME_S:
        rows.append(tracker.advance(next_sample).features(pregame))
        next_sample += SAMPLE_EVERY_S
    weight = 1.0 / max(len(rows), 1)
    for r in rows:
        r["target"] = target
        r["weight"] = weight
        r["game_id"] = game.meta.id
        r["season"] = game.meta.season
    return rows
