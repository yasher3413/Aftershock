"""The What-If Lab bootstrap: everything the in-browser simulator needs.

The shape matches the ``aftershock-wasm`` JSON input (config, games in
chronological order, playoff matrix, tie inflation), plus display fields the
UI uses (game ids, start times, team order).
"""

from __future__ import annotations

from typing import Any

from aftershock.ml.strength import OUTCOMES
from aftershock.sim.inputs import END_OT, END_SO, STATUS_FINAL, SimInputs

END_NAMES = {END_OT: "OT", END_SO: "SO"}


def whatif_payload(inputs: SimInputs, season: int) -> dict[str, Any]:
    sch = inputs.schedule
    games = []
    for i in range(sch.n):
        g: dict[str, Any] = {
            "game_id": int(sch.game_ids[i]),
            "start_utc": sch.start_utc[i].isoformat(),
            "home": sch.teams[int(sch.home[i])],
            "away": sch.teams[int(sch.away[i])],
        }
        if inputs.status[i] == STATUS_FINAL:
            g["status"] = "final"
            g["result"] = {
                "home_goals": int(inputs.home_goals[i]),
                "away_goals": int(inputs.away_goals[i]),
                # An overtime forfeit counts as a regulation result in the standings.
                "end": END_NAMES.get(int(inputs.end[i]), "REG"),
            }
        else:
            g["status"] = "future"
            g["probs"] = [round(float(p), 5) for p in inputs.probs[i]]
            g["lam"] = [round(float(x), 4) for x in inputs.lam[i]]
        games.append(g)
    return {
        "season": season,
        "config": sch.config,
        "teams": sch.teams,
        "outcomes": list(OUTCOMES),
        "games": games,
        "playoff_p": [[round(float(v), 5) for v in row] for row in inputs.playoff_p],
        "tie_theta": float(inputs.tie_theta),
    }
