//! Hot-path benchmark: replay a full 1,344-game season into a reused
//! accumulator, rank the league, and build the bracket.

use aftershock_core::rng::{hash4, Stream};
use aftershock_core::{
    playoff_bracket, rank_league, EndType, GameResult, LeagueConfig, PlayoffBracket, Schedule,
    SeasonAccumulator, StandingsScratch, TeamIdx,
};
use criterion::{black_box, criterion_group, criterion_main, Criterion};

/// Round-robin style schedule: every pair meets twice or three times until
/// each team has 84 games (approximate, fine for timing).
fn schedule(cfg: &LeagueConfig) -> Schedule {
    let n = cfg.n_teams() as TeamIdx;
    let mut games = Vec::new();
    let mut k = 0u64;
    while games.len() < cfg.total_games() {
        for h in 0..n {
            for a in 0..n {
                if h != a && games.len() < cfg.total_games() && !hash4(7, 0, k, 0).is_multiple_of(3)
                {
                    games.push((h, a));
                }
                k += 1;
            }
        }
    }
    Schedule::new(cfg.n_teams(), &games).unwrap()
}

fn results(n: usize, sim: u64) -> Vec<GameResult> {
    (0..n as u64)
        .map(|g| {
            let r = hash4(1, sim, g, Stream::Outcome as u64);
            let end = match r % 4 {
                0 => EndType::Overtime,
                1 => EndType::Shootout,
                _ => EndType::Regulation,
            };
            let lose = ((r >> 8) % 4) as u8;
            let margin = if end == EndType::Regulation {
                1 + ((r >> 16) % 3) as u8
            } else {
                1
            };
            let (h, a) = if r >> 32 & 1 == 1 {
                (lose + margin, lose)
            } else {
                (lose, lose + margin)
            };
            GameResult {
                home_goals: h,
                away_goals: a,
                end,
            }
        })
        .collect()
}

fn bench(c: &mut Criterion) {
    let cfg = LeagueConfig::builtin("nhl-2026-27").unwrap();
    let sched = schedule(&cfg);
    let res = results(sched.len(), 3);
    let mut acc = SeasonAccumulator::new(&cfg);
    let mut scratch = StandingsScratch::new(&cfg);
    let mut bracket = PlayoffBracket::new(&cfg);

    c.bench_function("apply_full_season", |b| {
        b.iter(|| {
            acc.reset();
            for (i, r) in res.iter().enumerate() {
                acc.apply_indexed(&sched, i, r);
            }
            black_box(&acc);
        })
    });
    for (i, r) in res.iter().enumerate() {
        acc.apply_indexed(&sched, i, r);
    }
    c.bench_function("rank_league_and_bracket", |b| {
        b.iter(|| {
            let r = rank_league(black_box(&acc), &cfg, &mut scratch);
            playoff_bracket(r, &acc, &cfg, &mut bracket);
            black_box(&bracket);
        })
    });
}

criterion_group!(benches, bench);
criterion_main!(benches);
