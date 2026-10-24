"""What-If numbers for the film: Montreal's playoff odds as the cursor picks
Montreal to win each of its next three games in regulation.

Builds the simulator input the way web/src/whatif/scenario.ts does
(applyScenario, resultFor, toSimInput) and runs the What-If Lab's own
simulator natively with the page's settings (10,000 seasons, seed 1).

    cargo build --release --manifest-path whatif/Cargo.toml
    python3 whatif.py        writes whatif-results.json
"""

import gzip
import json
import subprocess
from pathlib import Path

HERE = Path(__file__).parent
RUNNER = HERE / "whatif" / "target" / "release" / "whatif"
boot = json.loads(gzip.open(HERE.parent / "web" / "e2e" / "fixtures" / "whatif.json.gz").read())


def sim_input(games):
    return {
        "config": boot["config"],
        "playoff_p": boot["playoff_p"],
        "tie_theta": boot["tie_theta"],
        "team_sigma": boot.get("team_sigma", 0),
        "games": [
            {"home": g["home"], "away": g["away"], "status": "final", "result": g["result"]}
            if g["status"] == "final"
            else {"home": g["home"], "away": g["away"], "status": "future", "probs": g["probs"], "lam": g["lam"]}
            for g in games
        ],
    }


def mtl_wins(g):
    home = g["home"] == "MTL"
    return {"home_goals": 3 if home else 1, "away_goals": 1 if home else 3, "end": "REG"}


picks = [g for g in boot["games"] if g["status"] == "future" and "MTL" in (g["home"], g["away"])][:3]
out = []
for k in range(4):
    chosen = {g["game_id"] for g in picks[:k]}
    games = [dict(g, status="final", result=mtl_wins(g)) if g["game_id"] in chosen else g for g in boot["games"]]
    run = subprocess.run([str(RUNNER), "10000"], input=json.dumps(sim_input(games)), capture_output=True, text=True, check=True)
    res = json.loads(run.stdout)
    mtl = next(t for t in res["teams"] if t["team"] == "MTL")
    out.append({"picks": k, "p_playoffs": mtl["p_playoffs"], "p_cup": mtl["p_cup"], "ms": round(res["duration_ms"])})
(HERE / "whatif-results.json").write_text(json.dumps(out) + "\n")
print(out)
