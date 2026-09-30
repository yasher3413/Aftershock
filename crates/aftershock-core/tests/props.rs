//! Property tests for the standings engine.

use aftershock_core::{
    playoff_bracket, rank_league, EndType, GameResult, LeagueConfig, PlayoffBracket, Schedule,
    SeasonAccumulator, StandingsScratch, TeamIdx,
};
use proptest::prelude::*;

fn cfg() -> LeagueConfig {
    LeagueConfig::builtin("nhl-2026-27").unwrap()
}

/// A random game: (home, away offset, winner is home, margin, end type).
fn game() -> impl Strategy<Value = (u16, u16, bool, u8, u8, u8)> {
    (0u16..32, 1u16..32, any::<bool>(), 0u8..6, 1u8..4, 0u8..3)
}

fn build(raw: &[(u16, u16, bool, u8, u8, u8)]) -> (Vec<(TeamIdx, TeamIdx)>, Vec<GameResult>) {
    let mut pairs = Vec::with_capacity(raw.len());
    let mut results = Vec::with_capacity(raw.len());
    for &(h, off, home_wins, lose_goals, margin, end) in raw {
        let a = (h + off) % 32;
        pairs.push((h, a));
        let end = match end {
            0 => EndType::Regulation,
            1 => EndType::Overtime,
            _ => EndType::Shootout,
        };
        // Overtime and shootout games are decided by exactly one goal.
        let margin = if end == EndType::Regulation {
            margin
        } else {
            1
        };
        let (w, l) = (lose_goals + margin, lose_goals);
        let (home_goals, away_goals) = if home_wins { (w, l) } else { (l, w) };
        results.push(GameResult {
            home_goals,
            away_goals,
            end,
        });
    }
    (pairs, results)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn standings_invariant_to_feed_order(
        raw in prop::collection::vec(game(), 1..600),
        seed in any::<u64>(),
    ) {
        let cfg = cfg();
        let (pairs, results) = build(&raw);
        let schedule = Schedule::new(32, &pairs).unwrap();

        let mut a = SeasonAccumulator::new(&cfg);
        for (i, r) in results.iter().enumerate() {
            a.apply_indexed(&schedule, i, r);
        }
        // Feed the same results in a pseudo-random permutation.
        let mut idx: Vec<usize> = (0..results.len()).collect();
        let mut s = seed | 1;
        for i in (1..idx.len()).rev() {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            idx.swap(i, (s % (i as u64 + 1)) as usize);
        }
        let mut b = SeasonAccumulator::new(&cfg);
        for &i in &idx {
            b.apply_indexed(&schedule, i, &results[i]);
        }
        prop_assert_eq!(&a, &b);

        let mut sa = StandingsScratch::new(&cfg);
        let mut sb = StandingsScratch::new(&cfg);
        let ra = rank_league(&a, &cfg, &mut sa).clone();
        let rb = rank_league(&b, &cfg, &mut sb).clone();
        prop_assert_eq!(&ra, &rb);

        // Reusing a scratch buffer gives the same answer.
        let again = rank_league(&a, &cfg, &mut sb).clone();
        prop_assert_eq!(&ra, &again);

        let mut ba = PlayoffBracket::new(&cfg);
        let mut bb = PlayoffBracket::new(&cfg);
        playoff_bracket(&ra, &a, &cfg, &mut ba);
        playoff_bracket(&rb, &b, &cfg, &mut bb);
        prop_assert_eq!(ba, bb);
    }

    #[test]
    fn record_invariants(raw in prop::collection::vec(game(), 1..600)) {
        let cfg = cfg();
        let (pairs, results) = build(&raw);
        let schedule = Schedule::new(32, &pairs).unwrap();
        let mut acc = SeasonAccumulator::new(&cfg);
        for (i, r) in results.iter().enumerate() {
            acc.apply_indexed(&schedule, i, r);
        }
        let mut total_gp = 0u32;
        for t in 0..32u16 {
            let r = acc.record(t);
            prop_assert_eq!(r.points, 2 * r.w + r.otl);
            prop_assert_eq!(r.gp, r.w + r.l + r.otl);
            prop_assert!(r.rw <= r.row && r.row <= r.w);
            total_gp += r.gp as u32;
        }
        prop_assert_eq!(total_gp as usize, 2 * results.len());
        // Head-to-head games are symmetric.
        for x in 0..32 {
            for y in 0..32 {
                prop_assert_eq!(acc.h2h_games[x * 32 + y], acc.h2h_games[y * 32 + x]);
            }
        }

        // Rankings are permutations and 16 teams qualify.
        let mut scratch = StandingsScratch::new(&cfg);
        let r = rank_league(&acc, &cfg, &mut scratch);
        let mut league = r.league.clone();
        league.sort_unstable();
        prop_assert_eq!(league, (0..32).collect::<Vec<u16>>());
        prop_assert_eq!(r.qualified.iter().filter(|&&q| q).count(), 16);
        for w in r.league.windows(2) {
            prop_assert!(acc.points[w[0] as usize] >= acc.points[w[1] as usize]);
        }
    }
}
