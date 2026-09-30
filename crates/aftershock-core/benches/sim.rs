//! Full-season Monte Carlo benchmark: 20,000 simulations of all 1,344
//! future games of a synthetic 2026-27 schedule plus the playoffs.

use aftershock_core::testkit::{future_input, synthetic_schedule};
use aftershock_core::{LeagueConfig, Simulator};
use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn bench(c: &mut Criterion) {
    let cfg = LeagueConfig::builtin("nhl-2026-27").unwrap();
    let schedule = synthetic_schedule(&cfg);
    let sim = Simulator::new(cfg, schedule).unwrap();
    let mut input = future_input(sim.config(), sim.schedule(), 20_000, 1);
    input.focus_games = (0..112).collect();

    let mut g = c.benchmark_group("season_20k");
    g.sample_size(20);
    g.bench_function("run_parallel", |b| {
        b.iter(|| black_box(sim.run(&input).unwrap()))
    });
    g.finish();

    let mut small = input.clone();
    small.n_sims = 1_000;
    c.bench_function("run_serial_1k", |b| {
        b.iter(|| black_box(sim.run_serial(&small).unwrap()))
    });
}

criterion_group!(benches, bench);
criterion_main!(benches);
