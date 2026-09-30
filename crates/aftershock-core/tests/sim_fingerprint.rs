//! Pins the exact output of a fixed scenario, so model changes that must
//! not alter results (for example `team_sigma = 0`) are checked against the
//! output recorded before the change.

use aftershock_core::testkit::{future_input, synthetic_schedule};
use aftershock_core::{GameResult, GameStatus, LeagueConfig, SimResult, Simulator};

/// FNV-1a over every count, histogram bin, and per-simulation record.
fn fingerprint(r: &SimResult) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut eat = |x: u64| {
        for b in x.to_le_bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(0x0000_0100_0000_01B3);
        }
    };
    r.counts.iter().for_each(|&c| eat(c as u64));
    r.points_sum.iter().for_each(|&c| eat(c));
    r.points_hist.iter().for_each(|&c| eat(c as u64));
    r.seed_counts.iter().for_each(|&c| eat(c as u64));
    r.records.outcomes.iter().for_each(|&c| eat(c as u64));
    r.records.playoff_mask.iter().for_each(|&c| eat(c as u64));
    r.records.division_mask.iter().for_each(|&c| eat(c as u64));
    r.records.cup_winner.iter().for_each(|&c| eat(c as u64));
    h
}

fn scenario_result() -> SimResult {
    let cfg = LeagueConfig::builtin("nhl-2026-27").unwrap();
    let schedule = synthetic_schedule(&cfg);
    let sim = Simulator::new(cfg, schedule).unwrap();
    let mut input = future_input(sim.config(), sim.schedule(), 3000, 20260930);
    // A mix of final, live, and future games.
    for (i, st) in input.status.iter_mut().enumerate().take(400) {
        *st = GameStatus::Final(GameResult {
            home_goals: 2 + (i % 4) as u8,
            away_goals: 1 + (i % 2) as u8 * 3,
            end: aftershock_core::EndType::Regulation,
        });
    }
    input.status[400] = GameStatus::Live {
        home_score: 2,
        away_score: 1,
        probs: [0.55, 0.08, 0.05, 0.22, 0.06, 0.04],
        lam_home_rem: 0.9,
        lam_away_rem: 1.1,
    };
    input.focus_games = (395..430).collect();
    sim.run(&input).unwrap()
}

#[test]
fn fixed_scenario_output_is_pinned() {
    let r = scenario_result();
    assert_eq!(fingerprint(&r), PINNED, "got {:#018x}", fingerprint(&r));
}

/// Recorded on the simulator before team-strength noise existed.
const PINNED: u64 = 0x375f_5939_ee96_a5e6;
