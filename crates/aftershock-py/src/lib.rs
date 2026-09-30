//! Python bindings for `aftershock-core`, exposed as the module
//! `aftershock_core`.
//!
//! Build with maturin from `services/`:
//! `uv run maturin develop --release -m ../crates/aftershock-py/Cargo.toml`.

use std::time::Instant;

use aftershock_core as core;
use core::sim::{SimResult as CoreResult, SEED_SLOTS};
use core::{
    rank_league, EndType, GameResult, GameStatus, LeagueConfig, Schedule, SeasonAccumulator,
    SimInput, StandingsScratch, TeamIdx,
};
use numpy::ndarray::{Array2, Array3};
use numpy::{IntoPyArray, PyArray1, PyReadonlyArray1, PyReadonlyArray2};
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyDict;

fn err<E: std::fmt::Display>(e: E) -> PyErr {
    PyValueError::new_err(e.to_string())
}

fn end_from_code(code: u8) -> PyResult<EndType> {
    Ok(match code {
        0 => EndType::Regulation,
        1 => EndType::Overtime,
        2 => EndType::Shootout,
        3 => EndType::OvertimeForfeit,
        _ => return Err(err(format!("bad end code {code}"))),
    })
}

fn build_schedule(cfg: &LeagueConfig, home: &[u16], away: &[u16]) -> PyResult<Schedule> {
    if home.len() != away.len() {
        return Err(err("home and away differ in length"));
    }
    let pairs: Vec<(TeamIdx, TeamIdx)> = home.iter().copied().zip(away.iter().copied()).collect();
    Schedule::new(cfg.n_teams(), &pairs).map_err(err)
}

fn check_len(name: &str, got: usize, want: usize) -> PyResult<()> {
    if got == want {
        Ok(())
    } else {
        Err(err(format!("{name} has length {got}, expected {want}")))
    }
}

/// Season simulator for one league config and schedule, built once.
#[pyclass(module = "aftershock_core", frozen)]
struct Simulator {
    inner: core::Simulator,
}

#[pymethods]
impl Simulator {
    /// `Simulator(config, home, away)`: `config` is a builtin config name
    /// such as `"nhl-2026-27"`; `home` and `away` are uint16 team indices
    /// (config team order) of every game in chronological order.
    #[new]
    fn new(
        config: &str,
        home: PyReadonlyArray1<'_, u16>,
        away: PyReadonlyArray1<'_, u16>,
    ) -> PyResult<Self> {
        let cfg = LeagueConfig::builtin(config).map_err(err)?;
        let schedule = build_schedule(&cfg, home.as_slice()?, away.as_slice()?)?;
        let inner = core::Simulator::new(cfg, schedule).map_err(err)?;
        Ok(Simulator { inner })
    }

    /// Team abbreviations in index order.
    #[getter]
    fn teams(&self) -> Vec<String> {
        self.inner.config().teams.clone()
    }

    /// Number of scheduled games.
    #[getter]
    fn n_games(&self) -> usize {
        self.inner.schedule().len()
    }

    /// Run `n_sims` simulations. See the module docs in
    /// `docs/SIMULATOR.md` for array meanings. Releases the GIL.
    #[allow(clippy::too_many_arguments)]
    #[pyo3(signature = (status, home_goals, away_goals, end, live_home, live_away, probs, lam,
                        playoff_p, tie_theta, n_sims, seed, focus))]
    fn run(
        &self,
        py: Python<'_>,
        status: PyReadonlyArray1<'_, u8>,
        home_goals: PyReadonlyArray1<'_, u8>,
        away_goals: PyReadonlyArray1<'_, u8>,
        end: PyReadonlyArray1<'_, u8>,
        live_home: PyReadonlyArray1<'_, u8>,
        live_away: PyReadonlyArray1<'_, u8>,
        probs: PyReadonlyArray2<'_, f32>,
        lam: PyReadonlyArray2<'_, f32>,
        playoff_p: PyReadonlyArray2<'_, f32>,
        tie_theta: f32,
        n_sims: u32,
        seed: u64,
        focus: PyReadonlyArray1<'_, u32>,
    ) -> PyResult<SimResult> {
        let n = self.inner.schedule().len();
        let t = self.inner.config().n_teams();
        let (st, hg, ag, en) = (
            status.as_slice()?,
            home_goals.as_slice()?,
            away_goals.as_slice()?,
            end.as_slice()?,
        );
        let (lh, la) = (live_home.as_slice()?, live_away.as_slice()?);
        for (name, len) in [
            ("status", st.len()),
            ("home_goals", hg.len()),
            ("away_goals", ag.len()),
            ("end", en.len()),
            ("live_home", lh.len()),
            ("live_away", la.len()),
        ] {
            check_len(name, len, n)?;
        }
        let probs = probs.as_array();
        let lam = lam.as_array();
        if probs.shape() != [n, 6] {
            return Err(err(format!(
                "probs has shape {:?}, expected [{n}, 6]",
                probs.shape()
            )));
        }
        if lam.shape() != [n, 2] {
            return Err(err(format!(
                "lam has shape {:?}, expected [{n}, 2]",
                lam.shape()
            )));
        }
        let pp = playoff_p.as_array();
        if pp.shape() != [t, t] {
            return Err(err(format!(
                "playoff_p has shape {:?}, expected [{t}, {t}]",
                pp.shape()
            )));
        }
        let mut games = Vec::with_capacity(n);
        for i in 0..n {
            let p = [
                probs[[i, 0]],
                probs[[i, 1]],
                probs[[i, 2]],
                probs[[i, 3]],
                probs[[i, 4]],
                probs[[i, 5]],
            ];
            games.push(match st[i] {
                0 => GameStatus::Future {
                    probs: p,
                    lam_home: lam[[i, 0]],
                    lam_away: lam[[i, 1]],
                },
                1 => GameStatus::Live {
                    home_score: lh[i],
                    away_score: la[i],
                    probs: p,
                    lam_home_rem: lam[[i, 0]],
                    lam_away_rem: lam[[i, 1]],
                },
                2 => GameStatus::Final(GameResult {
                    home_goals: hg[i],
                    away_goals: ag[i],
                    end: end_from_code(en[i])?,
                }),
                s => return Err(err(format!("game {i}: bad status {s}"))),
            });
        }
        let input = SimInput {
            status: games,
            tie_theta,
            playoff_p: pp.iter().copied().collect(),
            focus_games: focus.as_slice()?.to_vec(),
            n_sims,
            seed,
        };
        let sim = &self.inner;
        let (res, ms) = py.detach(|| {
            let t0 = Instant::now();
            let r = sim.run(&input);
            (r, t0.elapsed().as_secs_f64() * 1e3)
        });
        Ok(SimResult {
            inner: res.map_err(err)?,
            duration_ms: ms,
        })
    }
}

/// Result of `Simulator.run`.
#[pyclass(module = "aftershock_core", frozen)]
struct SimResult {
    inner: CoreResult,
    /// Wall time of the simulation in milliseconds.
    #[pyo3(get)]
    duration_ms: f64,
}

#[pymethods]
impl SimResult {
    /// Simulations run.
    #[getter]
    fn n_sims(&self) -> u32 {
        self.inner.n_sims
    }

    /// Per-team metrics: name -> float64[t]. Names: p_playoffs,
    /// p_division, p_top3_div, p_wildcard, p_presidents, p_conf_first,
    /// p_round2, p_conf_final, p_final, p_cup, p_last, exp_points.
    #[getter]
    fn metrics<'py>(&self, py: Python<'py>) -> PyResult<Bound<'py, PyDict>> {
        let d = PyDict::new(py);
        for (name, v) in self.inner.metrics() {
            d.set_item(name, v.into_pyarray(py))?;
        }
        Ok(d)
    }

    /// Final-points histogram: int64[t, max_points + 1] of counts.
    #[getter]
    fn points_hist<'py>(&self, py: Python<'py>) -> PyResult<Bound<'py, numpy::PyArray2<i64>>> {
        let t = self.inner.n_teams;
        let bins = self.inner.max_points + 1;
        let v: Vec<i64> = self.inner.points_hist.iter().map(|&c| c as i64).collect();
        Ok(Array2::from_shape_vec((t, bins), v)
            .map_err(err)?
            .into_pyarray(py))
    }

    /// Seed distribution: float64[t, 6] over div1, div2, div3, wc1, wc2,
    /// out.
    #[getter]
    fn seed_dist<'py>(&self, py: Python<'py>) -> PyResult<Bound<'py, numpy::PyArray2<f64>>> {
        let t = self.inner.n_teams;
        Ok(
            Array2::from_shape_vec((t, SEED_SLOTS.len()), self.inner.seed_dist())
                .map_err(err)?
                .into_pyarray(py),
        )
    }

    /// Seed slot names, the column order of `seed_dist`.
    #[getter]
    fn seed_slots(&self) -> Vec<&'static str> {
        SEED_SLOTS.to_vec()
    }

    /// Per-simulation outcome class of each focus game: uint8[n_sims, f].
    #[getter]
    fn focus_outcomes<'py>(&self, py: Python<'py>) -> PyResult<Bound<'py, numpy::PyArray2<u8>>> {
        let r = &self.inner.records;
        Ok(
            Array2::from_shape_vec((r.n_sims as usize, r.n_focus()), r.outcomes.clone())
                .map_err(err)?
                .into_pyarray(py),
        )
    }

    /// Per-simulation playoff team bitmask: uint32[n_sims].
    #[getter]
    fn playoff_mask<'py>(&self, py: Python<'py>) -> Bound<'py, PyArray1<u32>> {
        self.inner.records.playoff_mask.clone().into_pyarray(py)
    }

    /// Per-simulation division winner bitmask: uint32[n_sims].
    #[getter]
    fn division_mask<'py>(&self, py: Python<'py>) -> Bound<'py, PyArray1<u32>> {
        self.inner.records.division_mask.clone().into_pyarray(py)
    }

    /// Per-simulation Cup winner index: uint8[n_sims].
    #[getter]
    fn cup_winner<'py>(&self, py: Python<'py>) -> Bound<'py, PyArray1<u8>> {
        self.inner.records.cup_winner.clone().into_pyarray(py)
    }

    /// Conditional count tables: dict with `outcome_counts` int64[f, 6],
    /// `playoffs_counts` int64[f, 6, t], `cup_counts` int64[f, 6, t].
    fn conditional<'py>(&self, py: Python<'py>) -> PyResult<Bound<'py, PyDict>> {
        let c = py.detach(|| self.inner.records.conditional());
        let (f, t) = (c.n_focus, c.n_teams);
        let to_i64 = |v: Vec<u64>| v.into_iter().map(|x| x as i64).collect::<Vec<i64>>();
        let d = PyDict::new(py);
        d.set_item(
            "outcome_counts",
            Array2::from_shape_vec((f, 6), to_i64(c.outcome_counts))
                .map_err(err)?
                .into_pyarray(py),
        )?;
        d.set_item(
            "playoffs_counts",
            Array3::from_shape_vec((f, 6, t), to_i64(c.playoffs_counts))
                .map_err(err)?
                .into_pyarray(py),
        )?;
        d.set_item(
            "cup_counts",
            Array3::from_shape_vec((f, 6, t), to_i64(c.cup_counts))
                .map_err(err)?
                .into_pyarray(py),
        )?;
        Ok(d)
    }

    /// Importance reweighting: `games` are focus positions (uint32[k]) and
    /// `new_probs` float32[k, 6]. Returns dict with `p_playoffs`,
    /// `p_division`, `p_cup` (float64[t]) and `ess` (float).
    fn reweight<'py>(
        &self,
        py: Python<'py>,
        games: PyReadonlyArray1<'_, u32>,
        new_probs: PyReadonlyArray2<'_, f32>,
    ) -> PyResult<Bound<'py, PyDict>> {
        let g = games.as_slice()?.to_vec();
        let p = new_probs.as_array();
        if p.shape() != [g.len(), 6] {
            return Err(err(format!(
                "new_probs has shape {:?}, expected [{}, 6]",
                p.shape(),
                g.len()
            )));
        }
        let rows: Vec<[f32; 6]> = (0..g.len())
            .map(|i| {
                [
                    p[[i, 0]],
                    p[[i, 1]],
                    p[[i, 2]],
                    p[[i, 3]],
                    p[[i, 4]],
                    p[[i, 5]],
                ]
            })
            .collect();
        let r = py
            .detach(|| self.inner.records.reweight(&g, &rows))
            .map_err(err)?;
        let d = PyDict::new(py);
        d.set_item("p_playoffs", r.p_playoffs.into_pyarray(py))?;
        d.set_item("p_division", r.p_division.into_pyarray(py))?;
        d.set_item("p_cup", r.p_cup.into_pyarray(py))?;
        d.set_item("ess", r.ess)?;
        Ok(d)
    }

    /// Probability of one metric by name, e.g. `result.prob("p_cup")`.
    fn prob<'py>(&self, py: Python<'py>, name: &str) -> PyResult<Bound<'py, PyArray1<f64>>> {
        let m = core::sim::METRICS
            .iter()
            .find(|(_, n)| *n == name)
            .map(|&(m, _)| m)
            .ok_or_else(|| err(format!("unknown metric {name}")))?;
        Ok(self.inner.prob(m).into_pyarray(py))
    }
}

/// Standings for an all-final season: `standings(config, home, away,
/// home_goals, away_goals, end)` with games in chronological order.
/// Returns a dict of numpy arrays (config team order): w, l, otl, points,
/// rw, row, gf, ga, league_rank, conference_rank, division_rank,
/// wildcard_rank, qualified.
#[pyfunction]
fn standings<'py>(
    py: Python<'py>,
    config: &str,
    home: PyReadonlyArray1<'_, u16>,
    away: PyReadonlyArray1<'_, u16>,
    home_goals: PyReadonlyArray1<'_, u8>,
    away_goals: PyReadonlyArray1<'_, u8>,
    end: PyReadonlyArray1<'_, u8>,
) -> PyResult<Bound<'py, PyDict>> {
    let cfg = LeagueConfig::builtin(config).map_err(err)?;
    let schedule = build_schedule(&cfg, home.as_slice()?, away.as_slice()?)?;
    let n = schedule.len();
    let (hg, ag, en) = (
        home_goals.as_slice()?,
        away_goals.as_slice()?,
        end.as_slice()?,
    );
    check_len("home_goals", hg.len(), n)?;
    check_len("away_goals", ag.len(), n)?;
    check_len("end", en.len(), n)?;
    let mut acc = SeasonAccumulator::new(&cfg);
    for i in 0..n {
        if hg[i] == ag[i] {
            return Err(err(format!("game {i} is tied")));
        }
        acc.apply_indexed(
            &schedule,
            i,
            &GameResult {
                home_goals: hg[i],
                away_goals: ag[i],
                end: end_from_code(en[i])?,
            },
        );
    }
    let mut scratch = StandingsScratch::new(&cfg);
    let r = rank_league(&acc, &cfg, &mut scratch);
    let d = PyDict::new(py);
    let u16s = |v: &Vec<u16>| v.iter().map(|&x| x as i64).collect::<Vec<i64>>();
    for (name, v) in [
        ("w", &acc.w),
        ("l", &acc.l),
        ("otl", &acc.otl),
        ("points", &acc.points),
        ("rw", &acc.rw),
        ("row", &acc.row),
        ("gf", &acc.gf),
        ("ga", &acc.ga),
        ("league_rank", &r.league_rank),
        ("conference_rank", &r.conference_rank),
        ("division_rank", &r.division_rank),
        ("wildcard_rank", &r.wildcard_rank),
    ] {
        d.set_item(name, u16s(v).into_pyarray(py))?;
    }
    d.set_item("qualified", r.qualified.clone().into_pyarray(py))?;
    d.set_item("teams", cfg.teams.clone())?;
    Ok(d)
}

/// Team abbreviations of a builtin config, in index order.
#[pyfunction]
fn config_teams(config: &str) -> PyResult<Vec<String>> {
    Ok(LeagueConfig::builtin(config).map_err(err)?.teams)
}

#[pymodule(name = "aftershock_core")]
fn aftershock_core_module(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<Simulator>()?;
    m.add_class::<SimResult>()?;
    m.add_function(wrap_pyfunction!(standings, m)?)?;
    m.add_function(wrap_pyfunction!(config_teams, m)?)?;
    m.add(
        "METRICS",
        core::sim::METRICS
            .iter()
            .map(|(_, n)| *n)
            .collect::<Vec<_>>(),
    )?;
    Ok(())
}
