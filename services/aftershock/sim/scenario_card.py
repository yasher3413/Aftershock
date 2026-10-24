"""The numbers on a shared What-If scenario's preview image.

The What-If Lab simulates in the browser; a link preview cannot, so the api
reruns a saved scenario here the way the Lab does: the Lab's bootstrap, the
picked games made final with the Lab's scores, and the same number of
seasons and seed for the forecast with and without the picks.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import numpy as np

from aftershock.sim.inputs import (
    END_CODES,
    END_OT_FORFEIT,
    END_REG,
    STATUS_FINAL,
    STATUS_FUTURE,
)

N_SIMS = 10_000
SEED = 1  # the Lab's seed (web/src/whatif/useSimulator.ts)
# Scores the Lab gives a picked game (web/src/whatif/scenario.ts resultFor);
# only the goal difference matters, for tiebreaks.
WIN, LOSS_REG, LOSS_EXTRA = 3, 1, 2
HOW = {"r": "REG", "o": "OT", "s": "SO"}
HOW_WORDS = {"REG": "", "OT": " in overtime", "SO": " in a shootout"}
ENDS = {**END_CODES, "OTF": END_OT_FORFEIT}


@dataclass
class Mover:
    team: str
    before: float
    after: float


@dataclass
class ScenarioCard:
    picks: list[str]  # worded, in game order: "TOR beat EDM in overtime"
    movers: list[Mover]  # largest playoff-odds changes first


def _picks(encoded: str) -> dict[int, tuple[bool, str]]:
    """Game id to (home wins, REG/OT/SO)."""
    out: dict[int, tuple[bool, str]] = {}
    for part in encoded.split("_"):
        game, code = part.split(".")
        out[int(game)] = (code[0] == "h", HOW[code[1]])
    return out


def _run(core: Any, boot: dict[str, Any], picks: dict[int, tuple[bool, str]]) -> np.ndarray:
    teams = {t: i for i, t in enumerate(boot["teams"])}
    games = boot["games"]
    n = len(games)
    status = np.zeros(n, np.uint8)
    hg = np.zeros(n, np.uint8)
    ag = np.zeros(n, np.uint8)
    end = np.zeros(n, np.uint8)
    probs = np.zeros((n, 6), np.float32)
    lam = np.zeros((n, 2), np.float32)
    for i, g in enumerate(games):
        result = g.get("result")
        pick = picks.get(g["game_id"]) if g["status"] == "future" else None
        if pick is not None:
            home_wins, how = pick
            loss = LOSS_REG if how == "REG" else LOSS_EXTRA
            result = {
                "home_goals": WIN if home_wins else loss,
                "away_goals": loss if home_wins else WIN,
                "end": how,
            }
        if result is not None and (g["status"] == "final" or pick is not None):
            status[i] = STATUS_FINAL
            hg[i], ag[i] = result["home_goals"], result["away_goals"]
            end[i] = ENDS.get(result["end"], END_REG)
        else:
            status[i] = STATUS_FUTURE
            probs[i] = g["probs"]
            lam[i] = g["lam"]
    home = np.array([teams[g["home"]] for g in games], np.uint16)
    away = np.array([teams[g["away"]] for g in games], np.uint16)
    sim = core.Simulator(boot["config"], home, away)
    zeros = np.zeros(n, np.uint8)
    res = sim.run(
        status,
        hg,
        ag,
        end,
        zeros,
        zeros,
        probs,
        lam,
        np.asarray(boot["playoff_p"], np.float32),
        float(boot["tie_theta"]),
        N_SIMS,
        SEED,
        np.zeros(0, np.uint32),
        team_sigma=float(boot.get("team_sigma", 0.0)),
    )
    return np.asarray(res.metrics["p_playoffs"], np.float64)


def scenario_card(boot: dict[str, Any], encoded: str, top: int = 5) -> ScenarioCard:
    """The picks still to be played, worded, and the teams they move most."""
    import aftershock_core

    picks = _picks(encoded)
    future = sorted(
        (g for g in boot["games"] if g["status"] == "future" and g["game_id"] in picks),
        key=lambda g: datetime.fromisoformat(g["start_utc"]),
    )
    words = []
    for g in future:
        home_wins, how = picks[g["game_id"]]
        winner, loser = (g["home"], g["away"]) if home_wins else (g["away"], g["home"])
        words.append(f"{winner} beat {loser}{HOW_WORDS[how]}")
    if not future:
        return ScenarioCard(picks=[], movers=[])
    live = {g["game_id"]: picks[g["game_id"]] for g in future}
    before = _run(aftershock_core, boot, {})
    after = _run(aftershock_core, boot, live)
    order = np.argsort(-np.abs(after - before), kind="stable")[:top]
    movers = [
        Mover(boot["teams"][i], float(before[i]), float(after[i]))
        for i in order
        if abs(after[i] - before[i]) >= 0.0005
    ]
    return ScenarioCard(picks=words, movers=movers)
