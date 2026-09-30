//! Synthetic schedules and inputs for tests, benchmarks, and examples.
//! Not part of the stable API.

use crate::league::{LeagueConfig, TeamIdx};
use crate::schedule::Schedule;
use crate::sim::{GameStatus, SimInput};

/// A balanced schedule by the circle method: rounds of a single round
/// robin repeated (alternating home and away each cycle) until every team
/// has `games_per_team` games. Exact for an even number of teams.
pub fn synthetic_schedule(cfg: &LeagueConfig) -> Schedule {
    let n = cfg.n_teams();
    let m = if n.is_multiple_of(2) { n } else { n + 1 };
    let rounds = m - 1;
    let mut order: Vec<usize> = (0..m).collect();
    let mut all_rounds: Vec<Vec<(usize, usize)>> = Vec::with_capacity(rounds);
    for _ in 0..rounds {
        let mut r = Vec::with_capacity(m / 2);
        for i in 0..m / 2 {
            let (a, b) = (order[i], order[m - 1 - i]);
            if a < n && b < n {
                r.push((a, b));
            }
        }
        all_rounds.push(r);
        // Rotate all but the first.
        let last = order.pop().unwrap();
        order.insert(1, last);
    }
    let mut games = Vec::with_capacity(cfg.total_games());
    let mut played = vec![0u16; n];
    let mut k = 0usize;
    while games.len() < cfg.total_games() && k < 10 * rounds * 4 {
        let cycle = k / rounds;
        for (i, &(a, b)) in all_rounds[k % rounds].iter().enumerate() {
            if played[a] >= cfg.games_per_team || played[b] >= cfg.games_per_team {
                continue;
            }
            let flip = (cycle + i + k) % 2 == 1;
            let (h, v) = if flip { (b, a) } else { (a, b) };
            games.push((h as TeamIdx, v as TeamIdx));
            played[a] += 1;
            played[b] += 1;
        }
        k += 1;
    }
    Schedule::new(n, &games).expect("valid synthetic schedule")
}

/// Team strength in `[-0.5, 0.5]`, deterministic by index.
pub fn strength(t: usize) -> f32 {
    ((t * 37 + 11) % 32) as f32 / 31.0 - 0.5
}

/// 6-way probabilities for a game between `home` and `away`.
pub fn game_probs(home: usize, away: usize) -> [f32; 6] {
    let d = 0.18 * (strength(home) - strength(away));
    let reg_tie = 0.22;
    let home_reg = (0.40 + d).clamp(0.05, 0.9);
    let away_reg = (1.0 - reg_tie - home_reg).max(0.02);
    [
        home_reg,
        reg_tie * 0.30,
        reg_tie * 0.20,
        away_reg,
        reg_tie * 0.28,
        reg_tie * 0.22,
    ]
}

/// All games future, strength-based probabilities, 20 percent home edge in
/// the playoff matrix.
pub fn future_input(cfg: &LeagueConfig, schedule: &Schedule, n_sims: u32, seed: u64) -> SimInput {
    let n = cfg.n_teams();
    let status = schedule
        .games()
        .iter()
        .map(|g| GameStatus::Future {
            probs: game_probs(g.home as usize, g.away as usize),
            lam_home: 3.1 + strength(g.home as usize) * 0.4,
            lam_away: 2.9 + strength(g.away as usize) * 0.4,
        })
        .collect();
    let mut playoff_p = vec![0.5f32; n * n];
    for i in 0..n {
        for j in 0..n {
            playoff_p[i * n + j] = (0.54 + 0.25 * (strength(i) - strength(j))).clamp(0.05, 0.95);
        }
    }
    SimInput {
        status,
        tie_theta: 1.2,
        playoff_p,
        focus_games: Vec::new(),
        n_sims,
        seed,
        team_sigma: 0.0,
    }
}
