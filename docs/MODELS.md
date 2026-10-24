# Models

Puckquake runs four measured components. Full cards with data, features,
splits, metrics, and limitations are in [`ml/MODEL_CARDS.md`](../ml/MODEL_CARDS.md).

| Component | Artifact | Report | Headline test result |
|---|---|---|---|
| Expected goals | `ml/artifacts/xg-1.0.0.*` | `ml/reports/xg.json` | 2025-26: AUC 0.755, log loss 0.228 (baseline 0.245) |
| Team strength | `ml/artifacts/strength-1.0.0.json` | `ml/reports/strength.json` | 2021-22 to 2025-26: 59.3% accuracy, 3-way log loss 1.035 |
| Win probability | `ml/artifacts/wp-1.0.0*` | `ml/reports/wp.json` | 2025-26: log loss 0.798 (lookup table 0.800) |
| Season simulator | `ml/artifacts/sim-1.0.0.json` | `ml/reports/backtest.json` | P(playoffs) Brier 0.106 (points % baseline 0.153) |

Training order matters because each model feeds the next: xG, then team
strength (which uses xG), then win probability (which uses both). Run
`make train`, then `aftershock backtest` for the simulator calibration.

Team strength also reads `config/market/point_totals.json`, each team's
preseason sportsbook point total by season. Add the new season's lines before
opening night (from Hockey-Reference's preseason odds page); without them the
model simply skips that step. After changing the strength model on the
server, run `aftershock ratings` in the worker container and restart the
worker so the live odds use it (`docs/DEPLOY.md`).

The simulator itself (rules, tiebreakers, Monte Carlo, common random numbers,
benchmarks) is documented in [`SIMULATOR.md`](SIMULATOR.md).
