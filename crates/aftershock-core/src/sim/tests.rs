//! Unit tests for the simulator driver.

use super::*;
use crate::testkit::{future_input, synthetic_schedule};

fn sim() -> Simulator {
    let cfg = LeagueConfig::builtin("nhl-2026-27").unwrap();
    let schedule = synthetic_schedule(&cfg);
    Simulator::new(cfg, schedule).unwrap()
}

#[test]
fn synthetic_schedule_is_balanced() {
    let s = sim();
    assert_eq!(s.schedule().len(), 1344);
    let mut gp = [0u32; 32];
    for g in s.schedule().games() {
        gp[g.home as usize] += 1;
        gp[g.away as usize] += 1;
    }
    assert!(gp.iter().all(|&g| g == 84), "{gp:?}");
}

#[test]
fn probabilities_are_consistent() {
    let s = sim();
    let input = future_input(s.config(), s.schedule(), 500, 7);
    let r = s.run(&input).unwrap();
    let cup: f64 = r.prob(Metric::Cup).iter().sum();
    assert!((cup - 1.0).abs() < 1e-12);
    let playoffs: f64 = r.prob(Metric::Playoffs).iter().sum();
    assert!((playoffs - 16.0).abs() < 1e-9);
    let div: f64 = r.prob(Metric::Division).iter().sum();
    assert!((div - 4.0).abs() < 1e-9);
    let pres: f64 = r.prob(Metric::Presidents).iter().sum();
    assert!((pres - 1.0).abs() < 1e-12);
    let last: f64 = r.prob(Metric::Last).iter().sum();
    assert!((last - 1.0).abs() < 1e-12);
    let round2: f64 = r.prob(Metric::Round2).iter().sum();
    assert!((round2 - 8.0).abs() < 1e-9);
    let cf: f64 = r.prob(Metric::ConfFinal).iter().sum();
    assert!((cf - 4.0).abs() < 1e-9);
    let fin: f64 = r.prob(Metric::Final).iter().sum();
    assert!((fin - 2.0).abs() < 1e-9);
    // Seed distribution rows sum to 1, playoffs = 1 - out.
    let sd = r.seed_dist();
    let pp = r.prob(Metric::Playoffs);
    for t in 0..32 {
        let row = &sd[t * 6..t * 6 + 6];
        assert!((row.iter().sum::<f64>() - 1.0).abs() < 1e-9);
        assert!((pp[t] - (1.0 - row[5])).abs() < 1e-9);
        let hist: u32 = r.points_hist[t * (r.max_points + 1)..(t + 1) * (r.max_points + 1)]
            .iter()
            .sum();
        assert_eq!(hist, 500);
    }
    // Points per season: 1344 games, 2 points each plus 1 per OT/SO game.
    let total: f64 = r.exp_points().iter().sum();
    assert!(total > 2.0 * 1344.0 && total < 3.0 * 1344.0);
}

#[test]
fn serial_and_default_runs_agree() {
    let s = sim();
    let mut input = future_input(s.config(), s.schedule(), 300, 99);
    input.focus_games = vec![0, 5, 1343];
    let a = s.run(&input).unwrap();
    let b = s.run_serial(&input).unwrap();
    assert_eq!(a, b);
}

#[test]
fn lazy_goals_match_eager_sampling() {
    for cfg_name in ["nhl-2026-27", "nhl-2017-18"] {
        let cfg = LeagueConfig::builtin(cfg_name).unwrap();
        let schedule = synthetic_schedule(&cfg);
        let s = Simulator::new(cfg, schedule).unwrap();
        let mut input = future_input(s.config(), s.schedule(), 400, 5);
        input.focus_games = vec![1, 2, 3];
        let lazy = s.run_serial(&input).unwrap();
        let eager = s.run_serial_eager(&input).unwrap();
        assert_eq!(lazy, eager, "{cfg_name}");
    }
}

#[test]
fn fast_season_matches_plain_accumulator() {
    let s = sim();
    let mut input = future_input(s.config(), s.schedule(), 10, 21);
    // Mix in finals and a live game.
    for i in 0..200 {
        input.status[i] = GameStatus::Final(GameResult {
            home_goals: 2 + (i % 3) as u8,
            away_goals: 1,
            end: [EndType::Regulation, EndType::Overtime, EndType::Shootout][i % 3],
        });
    }
    input.status[300] = GameStatus::Live {
        home_score: 1,
        away_score: 2,
        probs: [0.2, 0.05, 0.05, 0.5, 0.1, 0.1],
        lam_home_rem: 1.0,
        lam_away_rem: 0.9,
    };
    let mut prep = s.prepare(&input).unwrap();
    prep.lazy_goals = false;
    let mut w = prep.worker();
    for sim in 0..10u64 {
        prep.sample_season(sim, &mut w);
        let mut plain = SeasonAccumulator::new(s.config());
        let key = SimKey::new(input.seed, sim);
        for (i, (g, st)) in s.schedule().games().iter().zip(&input.status).enumerate() {
            let r = match *st {
                GameStatus::Final(r) => r,
                GameStatus::Live {
                    home_score,
                    away_score,
                    probs,
                    lam_home_rem,
                    lam_away_rem,
                } => {
                    let gk = key.game(i as u64);
                    let k = OutcomeCdf::new(&probs)
                        .unwrap()
                        .sample(gk.uniform_f32(Stream::Outcome));
                    let t = ScoreTable::new(
                        (home_score, away_score),
                        lam_home_rem,
                        lam_away_rem,
                        input.tie_theta,
                    )
                    .unwrap();
                    let (dh, da) = t.sample(outcome_class(k), gk.uniform_f32(Stream::LiveGoals));
                    finish(k, home_score + dh, away_score + da)
                }
                GameStatus::Future {
                    probs,
                    lam_home,
                    lam_away,
                } => {
                    let gk = key.game(i as u64);
                    let k = OutcomeCdf::new(&probs)
                        .unwrap()
                        .sample(gk.uniform_f32(Stream::Outcome));
                    let t = ScoreTable::new((0, 0), lam_home, lam_away, input.tie_theta).unwrap();
                    let (h, a) = t.sample(outcome_class(k), gk.uniform_f32(Stream::Scoreline));
                    finish(k, h, a)
                }
            };
            plain.apply(g, &r);
        }
        assert_eq!(w.acc, plain, "sim {sim}");
    }
}

#[test]
fn goals_needed_only_when_goals_step_reachable() {
    let s = sim();
    let input = future_input(s.config(), s.schedule(), 200, 11);
    let prep = s.prepare(&input).unwrap();
    let mut w = prep.worker();
    let mut needed = 0;
    for sim in 0..200 {
        prep.sample_season(sim, &mut w);
        if prep.goals_needed(&w.acc, &mut w.keys) {
            needed += 1;
        }
    }
    // Some seasons need goals, most do not.
    eprintln!("goals needed in {needed} of 200 seasons");
    assert!(needed > 0 && needed < 150, "{needed}");
}

#[test]
fn final_games_fix_the_base_standings() {
    let s = sim();
    let mut input = future_input(s.config(), s.schedule(), 50, 1);
    // Every game final: every simulation is the same season.
    for (i, st) in input.status.iter_mut().enumerate() {
        let home_wins = i % 3 != 0;
        *st = GameStatus::Final(GameResult {
            home_goals: if home_wins { 3 } else { 1 },
            away_goals: if home_wins { 2 } else { 4 },
            end: EndType::Regulation,
        });
    }
    input.focus_games = vec![0, 4];
    let r = s.run(&input).unwrap();
    for p in r.prob(Metric::Playoffs) {
        assert!(p == 0.0 || p == 1.0);
    }
    assert!(r.records.outcomes.chunks(2).all(|o| o == [3, 0]));
    assert_eq!(r.records.focus_probs[0], [0.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
}

#[test]
fn live_game_conditions_on_score() {
    let s = sim();
    let mut input = future_input(s.config(), s.schedule(), 200, 3);
    input.status[0] = GameStatus::Live {
        home_score: 4,
        away_score: 0,
        probs: [1.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        lam_home_rem: 0.3,
        lam_away_rem: 0.3,
    };
    input.focus_games = vec![0];
    let r = s.run(&input).unwrap();
    assert!(r.records.outcomes.iter().all(|&k| k == 0));
    assert_eq!(r.records.focus_probs[0], [1.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
}

#[test]
fn rejects_bad_inputs() {
    let s = sim();
    let good = future_input(s.config(), s.schedule(), 10, 3);
    let mut i = good.clone();
    i.status.pop();
    assert!(matches!(s.run(&i), Err(SimError::StatusLength { .. })));
    let mut i = good.clone();
    i.playoff_p[5] = 1.5;
    assert_eq!(s.run(&i), Err(SimError::PlayoffProb(0, 5)));
    let mut i = good.clone();
    i.focus_games = vec![5000];
    assert_eq!(s.run(&i), Err(SimError::FocusOutOfRange(5000)));
    let mut i = good.clone();
    i.n_sims = 0;
    assert_eq!(s.run(&i), Err(SimError::NoSims));
    let mut i = good;
    i.status[2] = GameStatus::Future {
        probs: [0.0; 6],
        lam_home: 3.0,
        lam_away: 3.0,
    };
    assert!(matches!(s.run(&i), Err(SimError::Game { index: 2, .. })));
}

#[test]
fn final_outcome_classes() {
    let r = |h, a, end| GameResult {
        home_goals: h,
        away_goals: a,
        end,
    };
    assert_eq!(final_outcome(&r(3, 1, EndType::Regulation)), 0);
    assert_eq!(final_outcome(&r(3, 2, EndType::Overtime)), 1);
    assert_eq!(final_outcome(&r(3, 2, EndType::Shootout)), 2);
    assert_eq!(final_outcome(&r(1, 3, EndType::Regulation)), 3);
    assert_eq!(final_outcome(&r(1, 2, EndType::OvertimeForfeit)), 4);
    assert_eq!(final_outcome(&r(1, 2, EndType::Shootout)), 5);
}

#[test]
fn tilted_sample_follows_tilted_probabilities() {
    let probs = [0.40f32, 0.07, 0.04, 0.37, 0.07, 0.05];
    let np = probs.map(|x| x as f64);
    let ph = np[0] + np[1] + np[2];
    let p = Pending {
        game: 0,
        h: 0,
        a: 1,
        h2h: 1,
        tiltable: true,
        ph,
        np,
        last: 5,
        sg: ScheduledGame {
            home: 0,
            away: 1,
            counts_h2h: true,
        },
        cdf: OutcomeCdf::new(&probs).unwrap(),
        base: (0, 0),
        stream: Stream::Scoreline,
    };
    for ratio in [0.5f64, 1.0, 1.7] {
        let target = noise::tilt(ph, ratio);
        let (sh, sa) = (target / ph, (1.0 - target) / (1.0 - ph));
        let mut counts = [0u32; 6];
        let n = 200_000;
        for i in 0..n {
            let u = (i as f32 + 0.5) / n as f32;
            counts[tilted_sample(&p, ratio, u) as usize] += 1;
        }
        for k in 0..6 {
            let want = np[k] * if k < 3 { sh } else { sa };
            let got = counts[k] as f64 / n as f64;
            assert!(
                (got - want).abs() < 1e-4,
                "ratio {ratio} k {k}: {got} vs {want}"
            );
        }
    }
    // Zero-probability trailing outcomes stay impossible.
    let probs = [0.5f32, 0.0, 0.0, 0.5, 0.0, 0.0];
    let q = Pending {
        np: probs.map(|x| x as f64),
        ph: 0.5,
        last: 3,
        cdf: OutcomeCdf::new(&probs).unwrap(),
        ..p
    };
    for i in 0..10_000 {
        let k = tilted_sample(&q, 2.5, i as f32 / 10_000.0);
        assert!(k == 0 || k == 3, "{k}");
    }
}

#[test]
fn team_noise_moves_extreme_odds_toward_half() {
    let s = sim();
    let mut input = future_input(s.config(), s.schedule(), 2000, 77);
    // Sharpen the games so preseason odds are extreme without noise.
    for (st, g) in input.status.iter_mut().zip(s.schedule().games()) {
        if let GameStatus::Future { probs, .. } = st {
            let d = 0.5
                * (crate::testkit::strength(g.home as usize)
                    - crate::testkit::strength(g.away as usize));
            let home = (0.53 + d).clamp(0.05, 0.95);
            *probs = [
                home * 0.78,
                home * 0.13,
                home * 0.09,
                (1.0 - home) * 0.78,
                (1.0 - home) * 0.13,
                (1.0 - home) * 0.09,
            ];
        }
    }
    let base = s.run(&input).unwrap().prob(Metric::Playoffs);
    input.team_sigma = 0.35;
    let noisy = s.run(&input).unwrap().prob(Metric::Playoffs);
    let strong = (0..32)
        .max_by(|&a, &b| base[a].total_cmp(&base[b]))
        .unwrap();
    let weak = (0..32)
        .min_by(|&a, &b| base[a].total_cmp(&base[b]))
        .unwrap();
    assert!(base[strong] > 0.99, "{}", base[strong]);
    assert!(
        noisy[strong] < base[strong],
        "{} vs {}",
        noisy[strong],
        base[strong]
    );
    assert!(
        noisy[weak] > base[weak],
        "{} vs {}",
        noisy[weak],
        base[weak]
    );
    // Spread across teams shrinks, total stays 16.
    let spread = |v: &[f64]| v.iter().map(|p| (p - 0.5).abs()).sum::<f64>();
    assert!(spread(&noisy) < spread(&base));
    assert!((noisy.iter().sum::<f64>() - 16.0).abs() < 1e-9);
}

#[test]
fn negative_sigma_is_rejected() {
    let s = sim();
    let mut input = future_input(s.config(), s.schedule(), 10, 1);
    input.team_sigma = -0.1;
    assert_eq!(s.run(&input), Err(SimError::BadSigma));
}
