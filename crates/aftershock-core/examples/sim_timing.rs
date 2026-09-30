//! Timing harness: repeated full-season runs, reporting median and p95.
//!
//! `cargo run --release -p aftershock-core --example sim_timing -- [n_sims] [reps]`
//!
//! Every one of the 1,344 games of a synthetic 2026-27 schedule is a
//! future game (opening night), followed by the full playoffs.

use std::time::Instant;

use aftershock_core::testkit::{future_input, synthetic_schedule};
use aftershock_core::{LeagueConfig, Simulator};

fn main() {
    let mut args = std::env::args().skip(1);
    let n_sims: u32 = args.next().and_then(|a| a.parse().ok()).unwrap_or(20_000);
    let reps: usize = args.next().and_then(|a| a.parse().ok()).unwrap_or(30);
    let cfg = LeagueConfig::builtin("nhl-2026-27").unwrap();
    let schedule = synthetic_schedule(&cfg);
    let sim = Simulator::new(cfg, schedule).unwrap();
    let mut input = future_input(sim.config(), sim.schedule(), n_sims, 1);
    input.focus_games = (0..112).collect();

    // Warm up.
    sim.run(&input).unwrap();
    let mut ms: Vec<f64> = (0..reps)
        .map(|r| {
            input.seed = r as u64 + 2;
            let t = Instant::now();
            let res = sim.run(&input).unwrap();
            std::hint::black_box(&res);
            t.elapsed().as_secs_f64() * 1e3
        })
        .collect();
    ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let q = |p: f64| ms[((ms.len() - 1) as f64 * p).round() as usize];
    println!(
        "n_sims={n_sims} reps={reps} threads={} median={:.1}ms p95={:.1}ms min={:.1}ms per_sim={:.2}us",
        std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
        q(0.5),
        q(0.95),
        ms[0],
        q(0.5) * 1e3 / n_sims as f64
    );
}
