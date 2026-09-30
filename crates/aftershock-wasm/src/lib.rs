//! WebAssembly bindings for `aftershock-core` (the What-If Lab).
//!
//! One entry point, [`simulate`], takes the season state as JSON and
//! returns per-team odds as JSON. Single threaded (no rayon).
//!
//! Input:
//!
//! ```json
//! {"config": "nhl-2026-27",
//!  "games": [{"home": "TOR", "away": "MTL", "status": "final",
//!             "result": {"home_goals": 3, "away_goals": 2, "end": "REG"}},
//!            {"home": "BOS", "away": "BUF", "status": "future",
//!             "probs": [0.4, 0.07, 0.04, 0.37, 0.07, 0.05], "lam": [3.1, 2.9]}],
//!  "playoff_p": [[0.5, ...], ...],
//!  "tie_theta": 1.2,
//!  "team_sigma": 0.15}
//! ```
//!
//! `team_sigma` (optional, default 0) is the per-simulation team strength
//! noise on the log-odds scale; 0 disables it.
//!
//! Games are in chronological order. `status` is `final`, `future`, or
//! `live` (a live game adds `"score": [home, away]` and its `lam` is the
//! expected remaining regulation goals). `end` is `REG`, `OT`, `SO`, or
//! `OTF` (overtime loss with the goalie pulled). `playoff_p` is `t x t` in
//! config team order.

use aftershock_core::sim::SEED_SLOTS;
use aftershock_core::{
    EndType, GameResult, GameStatus, LeagueConfig, Schedule, SimInput, Simulator, TeamIdx,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use wasm_bindgen::prelude::*;

/// Season state accepted by [`simulate`].
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct State {
    /// Builtin league config name.
    pub config: String,
    /// Every game of the season in chronological order.
    pub games: Vec<Game>,
    /// Playoff single-game home win probabilities, `t x t`.
    pub playoff_p: Vec<Vec<f32>>,
    /// Regulation tie multiplier for scoreline tables.
    #[serde(default = "one")]
    pub tie_theta: f32,
    /// Per-simulation team strength noise (log-odds standard deviation);
    /// 0 disables it.
    #[serde(default)]
    pub team_sigma: f32,
}

fn one() -> f32 {
    1.0
}

/// One game of [`State`].
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Game {
    /// Home team abbreviation.
    pub home: String,
    /// Away team abbreviation.
    pub away: String,
    /// `final`, `future`, or `live`.
    pub status: String,
    /// Final result (for `final`).
    #[serde(default)]
    pub result: Option<ResultJson>,
    /// 6-way outcome probabilities (for `future` and `live`).
    #[serde(default)]
    pub probs: Option<[f32; 6]>,
    /// Expected (remaining) regulation goals `[home, away]`.
    #[serde(default)]
    pub lam: Option<[f32; 2]>,
    /// Current score `[home, away]` (for `live`).
    #[serde(default)]
    pub score: Option<[u8; 2]>,
}

/// Final result of a game.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResultJson {
    /// Home goals.
    pub home_goals: u8,
    /// Away goals.
    pub away_goals: u8,
    /// `REG`, `OT`, `SO`, or `OTF`.
    pub end: String,
}

#[derive(Serialize)]
struct Output {
    teams: Vec<Map<String, Value>>,
    n_sims: u32,
    duration_ms: f64,
}

/// Run the simulation described by `state` and return the JSON output
/// text. `now_ms` supplies a millisecond clock for `duration_ms`.
pub fn simulate_state(
    state: &State,
    n_sims: u32,
    seed: u64,
    now_ms: impl Fn() -> f64,
) -> Result<String, String> {
    let t0 = now_ms();
    let cfg = LeagueConfig::builtin(&state.config).map_err(|e| e.to_string())?;
    let team = |abbrev: &str| {
        cfg.team(abbrev)
            .ok_or_else(|| format!("unknown team {abbrev}"))
    };
    let mut pairs: Vec<(TeamIdx, TeamIdx)> = Vec::with_capacity(state.games.len());
    let mut status = Vec::with_capacity(state.games.len());
    for (i, g) in state.games.iter().enumerate() {
        pairs.push((team(&g.home)?, team(&g.away)?));
        let need = |what: &str| format!("game {i}: missing {what}");
        status.push(match g.status.as_str() {
            "final" => {
                let r = g.result.as_ref().ok_or_else(|| need("result"))?;
                let end = match r.end.as_str() {
                    "REG" => EndType::Regulation,
                    "OT" => EndType::Overtime,
                    "SO" => EndType::Shootout,
                    "OTF" => EndType::OvertimeForfeit,
                    e => return Err(format!("game {i}: bad end {e}")),
                };
                GameStatus::Final(GameResult {
                    home_goals: r.home_goals,
                    away_goals: r.away_goals,
                    end,
                })
            }
            "future" => {
                let lam = g.lam.ok_or_else(|| need("lam"))?;
                GameStatus::Future {
                    probs: g.probs.ok_or_else(|| need("probs"))?,
                    lam_home: lam[0],
                    lam_away: lam[1],
                }
            }
            "live" => {
                let lam = g.lam.ok_or_else(|| need("lam"))?;
                let score = g.score.ok_or_else(|| need("score"))?;
                GameStatus::Live {
                    home_score: score[0],
                    away_score: score[1],
                    probs: g.probs.ok_or_else(|| need("probs"))?,
                    lam_home_rem: lam[0],
                    lam_away_rem: lam[1],
                }
            }
            s => return Err(format!("game {i}: bad status {s}")),
        });
    }
    let n = cfg.n_teams();
    if state.playoff_p.len() != n || state.playoff_p.iter().any(|r| r.len() != n) {
        return Err(format!("playoff_p must be {n} x {n}"));
    }
    let playoff_p: Vec<f32> = state.playoff_p.iter().flatten().copied().collect();
    let schedule = Schedule::new(n, &pairs).map_err(|e| e.to_string())?;
    let sim = Simulator::new(cfg, schedule).map_err(|e| e.to_string())?;
    let input = SimInput {
        status,
        tie_theta: state.tie_theta,
        playoff_p,
        focus_games: Vec::new(),
        n_sims,
        seed,
        team_sigma: state.team_sigma,
    };
    let res = sim.run(&input).map_err(|e| e.to_string())?;

    let metrics = res.metrics();
    let seed_dist = res.seed_dist();
    let bins = res.max_points + 1;
    let teams = (0..n)
        .map(|t| {
            let mut m = Map::new();
            m.insert("team".into(), sim.config().teams[t].clone().into());
            for (name, v) in &metrics {
                m.insert((*name).into(), v[t].into());
            }
            let sd: Map<String, Value> = SEED_SLOTS
                .iter()
                .enumerate()
                .map(|(s, &slot)| (slot.to_string(), seed_dist[t * 6 + s].into()))
                .collect();
            m.insert("seed_dist".into(), sd.into());
            let hist = &res.points_hist[t * bins..(t + 1) * bins];
            // Trim trailing zero bins; index is the points total.
            let last = hist.iter().rposition(|&c| c > 0).map_or(0, |i| i + 1);
            m.insert("points_hist".into(), hist[..last].to_vec().into());
            m
        })
        .collect();
    let out = Output {
        teams,
        n_sims,
        duration_ms: now_ms() - t0,
    };
    serde_json::to_string(&out).map_err(|e| e.to_string())
}

/// Parse `json_state` and simulate. Returns the JSON output, or throws a
/// JS error with a message on bad input.
#[wasm_bindgen]
pub fn simulate(json_state: &str, n_sims: u32, seed: u64) -> Result<String, JsError> {
    let state: State =
        serde_json::from_str(json_state).map_err(|e| JsError::new(&e.to_string()))?;
    simulate_state(&state, n_sims, seed, now_ms).map_err(|e| JsError::new(&e))
}

#[cfg(target_arch = "wasm32")]
fn now_ms() -> f64 {
    js_sys::Date::now()
}

#[cfg(not(target_arch = "wasm32"))]
fn now_ms() -> f64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64() * 1e3)
        .unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state_json() -> String {
        let cfg = LeagueConfig::builtin("nhl-2026-27").unwrap();
        let sched = aftershock_core::testkit::synthetic_schedule(&cfg);
        let games: Vec<Value> = sched
            .games()
            .iter()
            .enumerate()
            .map(|(i, g)| {
                let (h, a) = (cfg.abbrev(g.home), cfg.abbrev(g.away));
                if i < 300 {
                    serde_json::json!({"home": h, "away": a, "status": "final",
                        "result": {"home_goals": 3, "away_goals": 2, "end": "OT"}})
                } else {
                    serde_json::json!({"home": h, "away": a, "status": "future",
                        "probs": [0.4, 0.07, 0.04, 0.37, 0.07, 0.05], "lam": [3.1, 2.9]})
                }
            })
            .collect();
        let p = vec![vec![0.55f32; 32]; 32];
        serde_json::json!({"config": "nhl-2026-27", "games": games, "playoff_p": p,
            "tie_theta": 1.2})
        .to_string()
    }

    #[test]
    fn simulate_round_trip() {
        let state: State = serde_json::from_str(&state_json()).unwrap();
        let out = simulate_state(&state, 300, 7, || 0.0).unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        let teams = v["teams"].as_array().unwrap();
        assert_eq!(teams.len(), 32);
        let cup: f64 = teams.iter().map(|t| t["p_cup"].as_f64().unwrap()).sum();
        assert!((cup - 1.0).abs() < 1e-9);
        let sd = &teams[0]["seed_dist"];
        let total: f64 = SEED_SLOTS.iter().map(|s| sd[*s].as_f64().unwrap()).sum();
        assert!((total - 1.0).abs() < 1e-9);
        for name in ["p_playoffs", "p_round2", "p_last", "exp_points"] {
            assert!(teams[5][name].is_number(), "{name}");
        }
        // Deterministic.
        assert_eq!(out, simulate_state(&state, 300, 7, || 0.0).unwrap());
    }

    #[test]
    fn team_sigma_field_is_optional() {
        let mut v: Value = serde_json::from_str(&state_json()).unwrap();
        let without: State = serde_json::from_value(v.clone()).unwrap();
        assert_eq!(without.team_sigma, 0.0);
        v["team_sigma"] = 0.0.into();
        let zero: State = serde_json::from_value(v.clone()).unwrap();
        let a = simulate_state(&without, 200, 3, || 0.0).unwrap();
        assert_eq!(a, simulate_state(&zero, 200, 3, || 0.0).unwrap());
        v["team_sigma"] = 0.3.into();
        let noisy: State = serde_json::from_value(v).unwrap();
        assert_ne!(a, simulate_state(&noisy, 200, 3, || 0.0).unwrap());
    }

    #[test]
    fn bad_input_is_an_error() {
        let mut state: State = serde_json::from_str(&state_json()).unwrap();
        state.games[0].status = "postponed".into();
        assert!(simulate_state(&state, 10, 1, || 0.0).is_err());
    }
}
