# Models

Aftershock runs four measured components. Full cards with data, features,
splits, metrics, and limitations are in [`ml/MODEL_CARDS.md`](../ml/MODEL_CARDS.md).

| Component | Artifact | Report | Headline test result |
|---|---|---|---|
| Expected goals | `ml/artifacts/xg-1.0.0.*` | `ml/reports/xg.json` | 2025-26: AUC 0.755, log loss 0.228 (baseline 0.245) |
| Team strength | `ml/artifacts/strength-1.0.0.json` | `ml/reports/strength.json` | 2021-22 to 2025-26: 59.4% accuracy, 3-way log loss 1.036 |
| Win probability | `ml/artifacts/wp-1.0.0*` | `ml/reports/wp.json` | 2025-26: log loss 0.798 (lookup table 0.800) |
| Season simulator | `ml/artifacts/sim-1.0.0.json` | `ml/reports/backtest.json` | P(playoffs) Brier 0.110 (points % baseline 0.153) |

Training order matters because each model feeds the next: xG, then team
strength (which uses xG), then win probability (which uses both). Run
`make train`, then `aftershock backtest` for the simulator calibration.

The simulator itself (rules, tiebreakers, Monte Carlo, common random numbers,
benchmarks) is documented in [`SIMULATOR.md`](SIMULATOR.md).
