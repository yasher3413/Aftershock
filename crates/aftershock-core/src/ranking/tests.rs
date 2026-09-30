//! Unit tests for each tiebreak step and multi-club ties.

use super::*;
use crate::schedule::Schedule;
use crate::standings::{EndType, GameResult};

/// 12-team league: four divisions of three, two per conference.
pub(crate) fn cfg12(chain: &str) -> LeagueConfig {
    let text = format!(
        r#"
name = "test"
season = 1
games_per_team = 82
tiebreak = "{chain}"
teams = ["T0","T1","T2","T3","T4","T5","T6","T7","T8","T9","T10","T11"]
[points]
win = 2
otl = 1
[overtime]
ot_minutes = 5
shootout = true
[playoffs]
format = "division-wildcard"
division_top = 3
wildcards_per_conference = 2
series_length = 7
home_pattern = "HHAAHAH"
[[conferences]]
name = "E"
divisions = ["D0", "D1"]
[[conferences]]
name = "W"
divisions = ["D2", "D3"]
[[divisions]]
name = "D0"
teams = ["T0","T1","T2"]
[[divisions]]
name = "D1"
teams = ["T3","T4","T5"]
[[divisions]]
name = "D2"
teams = ["T6","T7","T8"]
[[divisions]]
name = "D3"
teams = ["T9","T10","T11"]
"#
    );
    LeagueConfig::from_toml_str(&text).unwrap()
}

/// Accumulator where every team has identical baseline stats.
pub(crate) fn flat(cfg: &LeagueConfig) -> SeasonAccumulator {
    let mut acc = SeasonAccumulator::new(cfg);
    for t in 0..cfg.n_teams() {
        acc.gp[t] = 82;
        acc.w[t] = 40;
        acc.l[t] = 30;
        acc.otl[t] = 12;
        acc.points[t] = 92;
        acc.rw[t] = 30;
        acc.row[t] = 35;
        acc.gf[t] = 250;
        acc.ga[t] = 250;
    }
    acc
}

fn set_h2h(acc: &mut SeasonAccumulator, a: usize, b: usize, pa: u16, pb: u16, games: u16) {
    let n = acc.n_teams();
    acc.h2h_points[a * n + b] = pa;
    acc.h2h_points[b * n + a] = pb;
    acc.h2h_games[a * n + b] = games;
    acc.h2h_games[b * n + a] = games;
}

fn order(acc: &SeasonAccumulator, cfg: &LeagueConfig, teams: &[TeamIdx]) -> Vec<TeamIdx> {
    let mut v = teams.to_vec();
    let n = cfg.n_teams();
    sort_teams(acc, cfg, &mut v, &mut vec![0; n], &mut vec![0; n]);
    v
}

#[test]
fn points_decide_before_any_tiebreak() {
    let cfg = cfg12("nhl-2019");
    let mut acc = flat(&cfg);
    acc.points[2] = 93;
    acc.rw[0] = 50;
    assert_eq!(order(&acc, &cfg, &[0, 1, 2]), vec![2, 0, 1]);
}

#[test]
fn step1_fewer_games_played() {
    let cfg = cfg12("nhl-2019");
    let mut acc = flat(&cfg);
    acc.gp[0] = 82;
    acc.gp[1] = 81;
    acc.rw[0] = 50;
    assert_eq!(order(&acc, &cfg, &[0, 1]), vec![1, 0]);
}

#[test]
fn step2_regulation_wins() {
    let cfg = cfg12("nhl-2019");
    let mut acc = flat(&cfg);
    acc.rw[1] = 31;
    acc.row[0] = 40;
    assert_eq!(order(&acc, &cfg, &[0, 1]), vec![1, 0]);
}

#[test]
fn step3_regulation_overtime_wins() {
    let cfg = cfg12("nhl-2019");
    let mut acc = flat(&cfg);
    acc.row[1] = 36;
    acc.w[0] = 41;
    assert_eq!(order(&acc, &cfg, &[0, 1]), vec![1, 0]);
}

#[test]
fn step4_total_wins() {
    let cfg = cfg12("nhl-2019");
    let mut acc = flat(&cfg);
    acc.w[1] = 41;
    set_h2h(&mut acc, 0, 1, 4, 0, 2);
    assert_eq!(order(&acc, &cfg, &[0, 1]), vec![1, 0]);
}

#[test]
fn step5_head_to_head_points() {
    let cfg = cfg12("nhl-2019");
    let mut acc = flat(&cfg);
    set_h2h(&mut acc, 0, 1, 2, 3, 2);
    acc.gf[0] = 300;
    assert_eq!(order(&acc, &cfg, &[0, 1]), vec![1, 0]);
}

#[test]
fn step6_goal_differential() {
    let cfg = cfg12("nhl-2019");
    let mut acc = flat(&cfg);
    set_h2h(&mut acc, 0, 1, 2, 2, 2);
    acc.ga[0] = 251;
    acc.gf[0] = 260; // +9
    acc.gf[1] = 260; // +10
    assert_eq!(order(&acc, &cfg, &[0, 1]), vec![1, 0]);
}

#[test]
fn step7_goals_for() {
    let cfg = cfg12("nhl-2019");
    let mut acc = flat(&cfg);
    acc.gf[1] = 260;
    acc.ga[1] = 260;
    assert_eq!(order(&acc, &cfg, &[0, 1]), vec![1, 0]);
}

#[test]
fn exhausted_chain_keeps_config_order() {
    let cfg = cfg12("nhl-2019");
    let acc = flat(&cfg);
    assert_eq!(order(&acc, &cfg, &[5, 3, 4]), vec![3, 4, 5]);
}

#[test]
fn nhl_2010_skips_regulation_wins_and_goals_for() {
    let cfg = cfg12("nhl-2010");
    let mut acc = flat(&cfg);
    // More RW for 0, more ROW for 1: 2010 chain looks at ROW only.
    acc.rw[0] = 34;
    acc.row[1] = 36;
    assert_eq!(order(&acc, &cfg, &[0, 1]), vec![1, 0]);
    // Total wins is not a step in 2010: equal ROW falls to head-to-head.
    let mut acc = flat(&cfg);
    acc.w[0] = 45;
    set_h2h(&mut acc, 0, 1, 1, 3, 2);
    assert_eq!(order(&acc, &cfg, &[0, 1]), vec![1, 0]);
    // Goals for is not a step in 2010: config order after goal diff.
    let mut acc = flat(&cfg);
    acc.gf[1] = 260;
    acc.ga[1] = 260;
    assert_eq!(order(&acc, &cfg, &[0, 1]), vec![0, 1]);
}

#[test]
fn three_way_tie_uses_points_percentage_among_tied_clubs() {
    let cfg = cfg12("nhl-2019");
    let mut acc = flat(&cfg);
    // Pair (0,1): 1 game, 0 gets 0, 1 gets 2.
    // Pair (0,2): 5 games, 0 gets 5, 2 gets 4.
    // Pair (1,2): 1 game, 1 gets 2, 2 gets 0.
    // Raw points among the three: 0 -> 5, 1 -> 4, 2 -> 4.
    // Percentage: 0 -> 5/12, 1 -> 4/4, 2 -> 4/12. Percentage puts 1 first.
    set_h2h(&mut acc, 0, 1, 0, 2, 1);
    set_h2h(&mut acc, 0, 2, 5, 4, 5);
    set_h2h(&mut acc, 1, 2, 2, 0, 1);
    assert_eq!(order(&acc, &cfg, &[0, 1, 2]), vec![1, 0, 2]);
}

#[test]
fn separated_clubs_restart_chain_among_remaining() {
    let cfg = cfg12("nhl-2019");
    let mut acc = flat(&cfg);
    // Among all three, 0 is best (6/8) and 1 and 2 are equal (3/8 each),
    // but 2 beat 1 head to head (3 points to 1). Club 1 has the better goal
    // differential, so continuing to step 6 would put 1 ahead; restarting
    // the chain with only {1, 2} puts 2 ahead on head-to-head.
    set_h2h(&mut acc, 0, 1, 2, 2, 2);
    set_h2h(&mut acc, 0, 2, 4, 0, 2);
    set_h2h(&mut acc, 1, 2, 1, 3, 2);
    acc.gf[1] = 255;
    assert_eq!(order(&acc, &cfg, &[0, 1, 2]), vec![0, 2, 1]);
    // If the pair is also level head to head, goal differential decides.
    set_h2h(&mut acc, 0, 1, 3, 1, 2);
    set_h2h(&mut acc, 1, 2, 2, 2, 2);
    // 1 -> 3/8, 2 -> 2/8 now differ among three; make them equal again.
    set_h2h(&mut acc, 0, 2, 3, 1, 2);
    assert_eq!(order(&acc, &cfg, &[0, 1, 2]), vec![0, 1, 2]);
}

#[test]
fn four_way_tie_splits_then_restarts() {
    let cfg = cfg12("nhl-2019");
    let mut acc = flat(&cfg);
    // RW splits {0,1} (31) from {2,3} (30); each pair then goes to
    // head-to-head within the pair only.
    acc.rw[0] = 31;
    acc.rw[1] = 31;
    set_h2h(&mut acc, 0, 1, 1, 3, 2);
    set_h2h(&mut acc, 2, 3, 4, 0, 2);
    // Cross-pair results must not matter.
    set_h2h(&mut acc, 0, 2, 0, 8, 4);
    assert_eq!(order(&acc, &cfg, &[0, 1, 2, 3]), vec![1, 0, 2, 3]);
}

#[test]
fn four_way_tie_on_head_to_head_percentage() {
    let cfg = cfg12("nhl-2019");
    let mut acc = flat(&cfg);
    // Round robin among 0..4, 2 games each pair (4 points available).
    let pairs = [
        (0, 1, 3, 1),
        (0, 2, 2, 2),
        (0, 3, 4, 0),
        (1, 2, 3, 1),
        (1, 3, 2, 2),
        (2, 3, 1, 3),
    ];
    for (a, b, pa, pb) in pairs {
        set_h2h(&mut acc, a, b, pa, pb, 2);
    }
    // Totals: 0 -> 9, 1 -> 6, 2 -> 4, 3 -> 5 (all from 6 games).
    assert_eq!(order(&acc, &cfg, &[3, 2, 1, 0]), vec![0, 1, 3, 2]);
}

#[test]
fn odd_game_exclusion_changes_head_to_head() {
    let cfg = cfg12("nhl-2019");
    // T0 hosts two of three meetings with T1, so the first game in T0's
    // building is not counted.
    let s = Schedule::new(12, &[(0, 1), (1, 0), (0, 1)]).unwrap();
    assert!(!s.games()[0].counts_h2h);
    let mut acc = SeasonAccumulator::new(&cfg);
    let g = |h, a, end| GameResult {
        home_goals: h,
        away_goals: a,
        end,
    };
    acc.apply_indexed(&s, 0, &g(3, 0, EndType::Regulation)); // T0 wins (odd game)
    acc.apply_indexed(&s, 1, &g(2, 1, EndType::Regulation)); // T1 wins
    acc.apply_indexed(&s, 2, &g(3, 2, EndType::Shootout)); // T0 wins in SO
                                                           // Counted: T0 2 points, T1 3 points. All games would give T0 4, T1 3.
    let base = flat(&cfg);
    for t in 0..2 {
        acc.gp[t] = base.gp[t];
        acc.w[t] = base.w[t];
        acc.l[t] = base.l[t];
        acc.otl[t] = base.otl[t];
        acc.points[t] = base.points[t];
        acc.rw[t] = base.rw[t];
        acc.row[t] = base.row[t];
        acc.gf[t] = base.gf[t];
        acc.ga[t] = base.ga[t];
    }
    assert_eq!(order(&acc, &cfg, &[0, 1]), vec![1, 0]);
    assert!(better_record(&acc, &cfg, 1, 0));
}

#[test]
fn better_record_matches_pairwise_sort() {
    let cfg = cfg12("nhl-2019");
    let mut acc = flat(&cfg);
    acc.points[4] = 95;
    acc.rw[2] = 33;
    set_h2h(&mut acc, 0, 1, 3, 1, 2);
    for a in 0..6u16 {
        for b in 0..6u16 {
            if a == b {
                assert!(!better_record(&acc, &cfg, a, b));
                continue;
            }
            let o = order(&acc, &cfg, &[a, b]);
            assert_eq!(better_record(&acc, &cfg, a, b), o[0] == a, "{a} {b}");
        }
    }
}

#[test]
fn rank_league_divisions_and_wildcards() {
    let cfg = cfg12("nhl-2019");
    let mut acc = flat(&cfg);
    // East: D0 = T0 T1 T2, D1 = T3 T4 T5. With three per division every
    // club is a division qualifier, so the wild-card lists are empty.
    for (t, p) in [(0, 100), (1, 90), (2, 80), (3, 95), (4, 85), (5, 99)] {
        acc.points[t] = p;
    }
    let mut scratch = StandingsScratch::new(&cfg);
    let r = rank_league(&acc, &cfg, &mut scratch);
    assert_eq!(r.division[0], vec![0, 1, 2]);
    assert_eq!(r.division[1], vec![5, 3, 4]);
    assert_eq!(r.conference[0], vec![0, 5, 3, 1, 4, 2]);
    assert!(r.wildcard[0].is_empty());
    assert_eq!(r.division_rank[5], 1);
    assert_eq!(r.conference_rank[4], 5);
    assert!(r.qualified.iter().all(|&q| q));
    assert_eq!(r.league[0], 0);
}
