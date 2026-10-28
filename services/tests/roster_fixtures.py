"""Synthetic games for the player value tests."""

from __future__ import annotations

import numpy as np

from aftershock.ml.stints import Stint

BASE = 2.6  # xG per 60 for an average five
NOISE = 2.0  # spread of a stint's observed rate, per 60


def synthetic_stints(
    seed: int,
    star: int,
    boost: float,
    games: int = 400,
    star_games: int | None = None,
    teams: int = 10,
    per_team: int = 15,
    stint_s: int = 40,
    per_game: int = 60,
) -> list[Stint]:
    """Random lines from ``teams`` teams; ``star`` plays for team 0 and adds
    ``boost`` xG per 60 to his team when on the ice."""
    rng = np.random.default_rng(seed)
    roster = {t: [t * 100 + i for i in range(per_team)] for t in range(teams)}
    roster[0][0] = star
    out: list[Stint] = []
    star_left = games if star_games is None else star_games
    for g in range(games):
        h, a = rng.choice(teams, 2, replace=False)
        plays = star_left > 0 and 0 in (h, a)
        if 0 in (h, a):
            star_left -= 1
        for _ in range(per_game):
            hs = rng.choice(roster[h], 5, replace=False)
            as_ = rng.choice(roster[a], 5, replace=False)
            if not plays:
                hs = np.array([p if p != star else roster[0][1] for p in hs])
                as_ = np.array([p if p != star else roster[0][1] for p in as_])
            hs, as_ = np.unique(hs), np.unique(as_)
            if len(hs) != 5 or len(as_) != 5:
                continue
            hr = BASE + boost * (star in hs) + rng.normal(0, NOISE)
            ar = BASE + boost * (star in as_) + rng.normal(0, NOISE)
            out.append(
                Stint(
                    game_id=g,
                    dur_s=stint_s,
                    home=tuple(int(p) for p in hs),
                    away=tuple(int(p) for p in as_),
                    home_xg=max(hr, 0.0) * stint_s / 3600,
                    away_xg=max(ar, 0.0) * stint_s / 3600,
                    home_goals=0,
                    away_goals=0,
                )
            )
    return out
