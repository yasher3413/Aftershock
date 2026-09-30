//! Property tests for the common-random-numbers guarantees of the
//! simulator.

use aftershock_core::rng::{SimKey, Stream};
use aftershock_core::sim::OutcomeCdf;
use aftershock_core::testkit::{future_input, synthetic_schedule};
use aftershock_core::{GameStatus, LeagueConfig, SimInput, Simulator};
use proptest::prelude::*;
use std::sync::OnceLock;

fn simulator() -> &'static Simulator {
    static SIM: OnceLock<Simulator> = OnceLock::new();
    SIM.get_or_init(|| {
        let cfg = LeagueConfig::builtin("nhl-2026-27").unwrap();
        let schedule = synthetic_schedule(&cfg);
        Simulator::new(cfg, schedule).unwrap()
    })
}

/// Input with the first 40 games as focus games.
fn input(n_sims: u32, seed: u64) -> SimInput {
    let s = simulator();
    let mut i = future_input(s.config(), s.schedule(), n_sims, seed);
    i.focus_games = (0..40).collect();
    i
}

fn probs_of(i: &SimInput, g: usize) -> [f32; 6] {
    match i.status[g] {
        GameStatus::Future { probs, .. } => probs,
        _ => unreachable!(),
    }
}

fn set_probs(i: &mut SimInput, g: usize, p: [f32; 6]) {
    if let GameStatus::Future { probs, .. } = &mut i.status[g] {
        *probs = p;
    }
}

#[cfg(feature = "parallel")]
#[test]
fn identical_for_any_thread_count() {
    let s = simulator();
    let inp = input(700, 17);
    let serial = s.run_serial(&inp).unwrap();
    for threads in [1, 2, 3, 8] {
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .build()
            .unwrap();
        let r = pool.install(|| s.run(&inp)).unwrap();
        assert_eq!(r, serial, "{threads} threads");
    }
}

#[test]
fn identical_across_repeated_runs() {
    let s = simulator();
    let inp = input(300, 5);
    assert_eq!(s.run(&inp).unwrap(), s.run(&inp).unwrap());
    assert_eq!(s.run(&inp).unwrap(), s.run_serial(&inp).unwrap());
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(12))]

    /// Changing one game's probabilities never changes any other game's
    /// sampled outcome in any simulation.
    #[test]
    fn other_games_unaffected(
        g in 0usize..40,
        new in prop::array::uniform6(0.01f32..1.0),
        seed in any::<u64>(),
    ) {
        let s = simulator();
        let a = input(150, seed);
        let mut b = a.clone();
        set_probs(&mut b, g, new);
        let ra = s.run(&a).unwrap().records;
        let rb = s.run(&b).unwrap().records;
        for sim in 0..150 {
            for f in 0..40 {
                if f != g {
                    prop_assert_eq!(ra.outcome(sim, f), rb.outcome(sim, f));
                }
            }
        }
    }

    /// Moving probability mass between two adjacent outcomes of one game
    /// flips exactly the simulations whose uniform lies between the old and
    /// the new boundary.
    #[test]
    fn small_change_flips_only_boundary_sims(
        g in 0usize..40,
        j in 0usize..5,
        frac in 0.01f32..0.5,
        seed in any::<u64>(),
    ) {
        let s = simulator();
        let n = 600u32;
        let a = input(n, seed);
        let old = probs_of(&a, g);
        let mut new = old;
        let d = old[j] * frac;
        new[j] -= d;
        new[j + 1] += d;
        let mut b = a.clone();
        set_probs(&mut b, g, new);
        let ra = s.run(&a).unwrap().records;
        let rb = s.run(&b).unwrap().records;
        let (co, cn) = (OutcomeCdf::new(&old).unwrap(), OutcomeCdf::new(&new).unwrap());
        let (bo, bn) = (co.boundaries(), cn.boundaries());
        let mut flipped = 0;
        for sim in 0..n as usize {
            let u = SimKey::new(seed, sim as u64)
                .game(g as u64)
                .uniform_f32(Stream::Outcome);
            let (ko, kn) = (ra.outcome(sim, g), rb.outcome(sim, g));
            // Outcomes are exactly the inverse CDF of this uniform.
            prop_assert_eq!(ko, co.sample(u));
            prop_assert_eq!(kn, cn.sample(u));
            let between = (0..5).any(|i| {
                let (lo, hi) = (bo[i].min(bn[i]), bo[i].max(bn[i]));
                lo <= u && u < hi
            });
            if ko != kn {
                flipped += 1;
                prop_assert!(between, "sim {} flipped with u {} outside boundaries", sim, u);
                prop_assert_eq!((ko as usize, kn as usize), (j, j + 1));
            } else {
                prop_assert!(!between || bo == bn);
            }
        }
        // The moved boundary is the only one that shifts (up to rounding).
        let expected = (0..n as usize)
            .filter(|&sim| {
                let u = SimKey::new(seed, sim as u64).game(g as u64).uniform_f32(Stream::Outcome);
                bn[j] <= u && u < bo[j]
            })
            .count();
        prop_assert_eq!(flipped, expected);
    }
}
