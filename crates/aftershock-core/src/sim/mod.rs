//! Monte Carlo season and playoff simulator.
//!
//! A [`Simulator`] holds the league config and the full schedule and is
//! built once. Each [`Simulator::run`] takes a [`SimInput`] (the status of
//! every game, playoff single-game probabilities, the focus games, the
//! number of simulations, and a seed) and returns a [`SimResult`] with
//! per-team probabilities and per-simulation records.
//!
//! # Common random numbers
//!
//! Every random draw is a pure function of `(seed, sim, game, stream)` via
//! the counter RNG in [`crate::rng`]. A game's outcome is an inverse-CDF
//! lookup of one uniform over the fixed 6-outcome order, and its scoreline
//! uses a second uniform from a separate stream. Nothing is drawn from a
//! sequential stream shared across games, so:
//!
//! - results do not depend on thread count or scheduling;
//! - changing one game's inputs never changes any other game's draws;
//! - a small change in one game's probabilities flips only the simulations
//!   whose uniform lies between the old and new boundary.
//!
//! Playoff series use a [`KeyedRng`] keyed by `(seed, sim, series slot,
//! Stream::Playoff)`, independent of regular-season game indices.

pub mod noise;
pub mod records;
pub mod tables;

use crate::league::{LeagueConfig, TeamIdx};
use crate::playoffs::{home_ice, playoff_bracket, PlayoffBracket};
use crate::ranking::{rank_league, StandingsScratch};
use crate::rng::{KeyedRng, SimKey, Stream};
use crate::schedule::{Schedule, ScheduledGame};
use crate::standings::{EndType, GameResult, SeasonAccumulator};
use crate::tiebreak::TiebreakStep;

pub use records::{ConditionalTables, Reweighted, SimRecords};
pub use tables::{outcome_class, OutcomeCdf, RegClass, ScoreTable, TableError, N_OUTCOMES};

/// Status of one scheduled game at simulation time.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum GameStatus {
    /// Finished; the result is applied once to the base standings.
    Final(GameResult),
    /// In progress, conditioned on the current score.
    Live {
        /// Current home goals.
        home_score: u8,
        /// Current away goals.
        away_score: u8,
        /// 6-way outcome probabilities from the current state.
        probs: [f32; 6],
        /// Expected remaining regulation goals, home.
        lam_home_rem: f32,
        /// Expected remaining regulation goals, away.
        lam_away_rem: f32,
    },
    /// Not started.
    Future {
        /// 6-way outcome probabilities.
        probs: [f32; 6],
        /// Expected regulation goals, home.
        lam_home: f32,
        /// Expected regulation goals, away.
        lam_away: f32,
    },
}

/// Inputs of one simulation run.
#[derive(Clone, Debug, PartialEq)]
pub struct SimInput {
    /// Status of every scheduled game, aligned with the schedule.
    pub status: Vec<GameStatus>,
    /// Multiplier on regulation-tie cells of the scoreline tables.
    pub tie_theta: f32,
    /// Row-major `n x n`: `playoff_p[i * n + j]` is the probability that
    /// team `i` beats team `j` in a playoff game hosted by `i`.
    pub playoff_p: Vec<f32>,
    /// Schedule indices of the games whose sampled outcome is recorded per
    /// simulation (live games plus the next few days).
    pub focus_games: Vec<u32>,
    /// Number of simulations.
    pub n_sims: u32,
    /// Seed of the counter RNG.
    pub seed: u64,
}

/// Errors building or running a simulation.
#[derive(Debug, thiserror::Error, PartialEq)]
pub enum SimError {
    /// The schedule and config disagree on team count, or the league is
    /// too large for the 32-bit per-simulation team masks.
    #[error("league has {0} teams; the simulator supports 2 to 32")]
    TeamCount(usize),
    /// `status` does not have one entry per scheduled game.
    #[error("status has {got} entries for {expected} games")]
    StatusLength {
        /// Scheduled games.
        expected: usize,
        /// Entries given.
        got: usize,
    },
    /// `playoff_p` is not `n x n`.
    #[error("playoff_p has {got} entries, expected {expected}")]
    PlayoffMatrix {
        /// `n * n`.
        expected: usize,
        /// Entries given.
        got: usize,
    },
    /// A playoff probability is outside `[0, 1]`.
    #[error("playoff_p[{0}][{1}] is not a probability")]
    PlayoffProb(usize, usize),
    /// A game's probabilities or expected goals are invalid.
    #[error("game {index}: {source}")]
    Game {
        /// Schedule index.
        index: usize,
        /// What was wrong.
        source: TableError,
    },
    /// A final result has no winner.
    #[error("game {0}: final result is tied")]
    TiedFinal(usize),
    /// A focus game index is outside the schedule.
    #[error("focus game {0} is outside the schedule")]
    FocusOutOfRange(u32),
    /// `n_sims` is zero.
    #[error("n_sims must be positive")]
    NoSims,
}

/// Probability metrics reported per team (in [`METRICS`] order).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub enum Metric {
    /// Qualifies for the playoffs.
    Playoffs = 0,
    /// Finishes first in its division.
    Division,
    /// Finishes in the top three of its division.
    Top3Div,
    /// Qualifies as a wild card.
    Wildcard,
    /// Finishes first in the league (Presidents' Trophy).
    Presidents,
    /// Finishes first in its conference.
    ConfFirst,
    /// Wins its first-round series.
    Round2,
    /// Wins its second-round series (reaches the conference final).
    ConfFinal,
    /// Wins the conference final (reaches the Cup Final).
    Final,
    /// Wins the Stanley Cup.
    Cup,
    /// Finishes last in the league.
    Last,
}

/// All count metrics with their output names, in storage order.
pub const METRICS: [(Metric, &str); 11] = [
    (Metric::Playoffs, "p_playoffs"),
    (Metric::Division, "p_division"),
    (Metric::Top3Div, "p_top3_div"),
    (Metric::Wildcard, "p_wildcard"),
    (Metric::Presidents, "p_presidents"),
    (Metric::ConfFirst, "p_conf_first"),
    (Metric::Round2, "p_round2"),
    (Metric::ConfFinal, "p_conf_final"),
    (Metric::Final, "p_final"),
    (Metric::Cup, "p_cup"),
    (Metric::Last, "p_last"),
];
const N_METRICS: usize = METRICS.len();

/// Playoff seed slots, in [`SimResult::seed_counts`] order.
pub const SEED_SLOTS: [&str; 6] = ["div1", "div2", "div3", "wc1", "wc2", "out"];

/// Result of one run.
#[derive(Clone, Debug, PartialEq)]
pub struct SimResult {
    /// Simulations run.
    pub n_sims: u32,
    /// Teams in the league.
    pub n_teams: usize,
    /// Largest possible points total (histogram has `max_points + 1` bins).
    pub max_points: usize,
    /// Row-major `[metric][team]` counts, metric order as [`METRICS`].
    pub counts: Vec<u32>,
    /// Sum of final points per team over all simulations.
    pub points_sum: Vec<u64>,
    /// Row-major `[team][points]` histogram of final points (1-point bins).
    pub points_hist: Vec<u32>,
    /// Row-major `[team][slot]` counts over [`SEED_SLOTS`].
    pub seed_counts: Vec<u32>,
    /// Per-simulation records.
    pub records: SimRecords,
}

impl SimResult {
    /// Count of simulations in which `team` achieved `metric`.
    pub fn count(&self, metric: Metric, team: usize) -> u32 {
        self.counts[metric as usize * self.n_teams + team]
    }

    /// Probability of `metric` for every team.
    pub fn prob(&self, metric: Metric) -> Vec<f64> {
        let n = self.n_teams;
        let s = self.n_sims as f64;
        self.counts[metric as usize * n..(metric as usize + 1) * n]
            .iter()
            .map(|&c| c as f64 / s)
            .collect()
    }

    /// Expected final points per team.
    pub fn exp_points(&self) -> Vec<f64> {
        let s = self.n_sims as f64;
        self.points_sum.iter().map(|&p| p as f64 / s).collect()
    }

    /// Row-major `[team][slot]` seed probabilities.
    pub fn seed_dist(&self) -> Vec<f64> {
        let s = self.n_sims as f64;
        self.seed_counts.iter().map(|&c| c as f64 / s).collect()
    }

    /// Every per-team metric by output name: the eleven probabilities of
    /// [`METRICS`] followed by `exp_points`.
    pub fn metrics(&self) -> Vec<(&'static str, Vec<f64>)> {
        let mut out: Vec<(&'static str, Vec<f64>)> = METRICS
            .iter()
            .map(|&(m, name)| (name, self.prob(m)))
            .collect();
        out.push(("exp_points", self.exp_points()));
        out
    }
}

/// A non-final game prepared for sampling.
#[derive(Clone, Debug)]
struct Pending {
    game: u32,
    h: u8,
    a: u8,
    /// 1 when the game counts for head-to-head, else 0.
    h2h: u16,
    sg: ScheduledGame,
    cdf: OutcomeCdf,
    base: (u8, u8),
    stream: Stream,
}

/// Where a focus game's per-simulation outcome comes from.
#[derive(Clone, Copy, Debug)]
enum FocusSource {
    Pending(u32),
    Fixed(u8),
}

/// Per-run prepared state shared by all workers.
struct Prepared<'a> {
    cfg: &'a LeagueConfig,
    base: SeasonAccumulator,
    pending: Vec<Pending>,
    tables: Vec<ScoreTable>,
    focus: Vec<FocusSource>,
    focus_games: Vec<u32>,
    focus_probs: Vec<[f32; 6]>,
    playoff_p: &'a [f32],
    seed: u64,
    max_points: usize,
    /// Intrinsic chain steps before the first goals step, or `None` when
    /// the chain has no goals step.
    pre_goal_steps: Option<Vec<TiebreakStep>>,
    /// Sample scorelines only when a goals tiebreak is reachable.
    lazy_goals: bool,
    /// Per outcome: home and away deltas `[gp, w, l, otl, rw, row, pts, 0]`
    /// (games played is prefilled in the base, so its delta is 0).
    delta: [[[u16; 8]; 2]; 6],
}

/// Per-thread scratch reused for every simulation.
struct Worker {
    acc: SeasonAccumulator,
    ranking: StandingsScratch,
    bracket: PlayoffBracket,
    outcomes: Vec<u8>,
    keys: Vec<u64>,
    local: Box<[[u16; 8]; 32]>,
    h2h: Box<[u16; 1024]>,
}

/// Per-thread integer tallies. Integer sums make the merged result
/// independent of how simulations are split across threads.
#[derive(Clone)]
struct Tally {
    counts: Vec<u32>,
    points_sum: Vec<u64>,
    hist: Vec<u32>,
    seeds: Vec<u32>,
}

impl Tally {
    fn new(n: usize, max_points: usize) -> Self {
        Tally {
            counts: vec![0; N_METRICS * n],
            points_sum: vec![0; n],
            hist: vec![0; n * (max_points + 1)],
            seeds: vec![0; n * SEED_SLOTS.len()],
        }
    }

    #[cfg_attr(not(feature = "parallel"), allow(dead_code))]
    fn merge(mut self, other: Tally) -> Tally {
        for (a, b) in self.counts.iter_mut().zip(&other.counts) {
            *a += b;
        }
        for (a, b) in self.points_sum.iter_mut().zip(&other.points_sum) {
            *a += b;
        }
        for (a, b) in self.hist.iter_mut().zip(&other.hist) {
            *a += b;
        }
        for (a, b) in self.seeds.iter_mut().zip(&other.seeds) {
            *a += b;
        }
        self
    }
}

/// Mutable per-simulation record slices for one chunk.
struct ChunkOut<'o> {
    outcomes: &'o mut [u8],
    playoff_mask: &'o mut [u32],
    division_mask: &'o mut [u32],
    cup_winner: &'o mut [u8],
}

/// Simulations per work unit.
const CHUNK: usize = 64;

/// The simulator: league config and schedule, built once and reused.
#[derive(Clone, Debug)]
pub struct Simulator {
    cfg: LeagueConfig,
    schedule: Schedule,
}

impl Simulator {
    /// Build a simulator for `cfg` and `schedule`.
    pub fn new(cfg: LeagueConfig, schedule: Schedule) -> Result<Self, SimError> {
        let n = cfg.n_teams();
        if n != schedule.n_teams() || !(2..=32).contains(&n) {
            return Err(SimError::TeamCount(n));
        }
        Ok(Simulator { cfg, schedule })
    }

    /// League config.
    pub fn config(&self) -> &LeagueConfig {
        &self.cfg
    }

    /// Schedule.
    pub fn schedule(&self) -> &Schedule {
        &self.schedule
    }

    /// Run on all cores when the `parallel` feature is on, else serially.
    pub fn run(&self, input: &SimInput) -> Result<SimResult, SimError> {
        let prep = self.prepare(input)?;
        #[cfg(feature = "parallel")]
        {
            Ok(run_parallel(&prep, input.n_sims as usize))
        }
        #[cfg(not(feature = "parallel"))]
        {
            Ok(run_serial(&prep, input.n_sims as usize))
        }
    }

    /// Run on the calling thread only. Gives exactly the same result as
    /// [`Simulator::run`].
    pub fn run_serial(&self, input: &SimInput) -> Result<SimResult, SimError> {
        let prep = self.prepare(input)?;
        Ok(run_serial(&prep, input.n_sims as usize))
    }

    /// Serial run that samples every scoreline (no lazy goals). For tests
    /// that prove lazy sampling changes nothing.
    #[cfg(test)]
    pub(crate) fn run_serial_eager(&self, input: &SimInput) -> Result<SimResult, SimError> {
        let mut prep = self.prepare(input)?;
        prep.lazy_goals = false;
        Ok(run_serial(&prep, input.n_sims as usize))
    }

    fn prepare<'a>(&'a self, input: &'a SimInput) -> Result<Prepared<'a>, SimError> {
        let cfg = &self.cfg;
        let n = cfg.n_teams();
        let games = self.schedule.games();
        if input.n_sims == 0 {
            return Err(SimError::NoSims);
        }
        if input.status.len() != games.len() {
            return Err(SimError::StatusLength {
                expected: games.len(),
                got: input.status.len(),
            });
        }
        if input.playoff_p.len() != n * n {
            return Err(SimError::PlayoffMatrix {
                expected: n * n,
                got: input.playoff_p.len(),
            });
        }
        for i in 0..n {
            for j in 0..n {
                let p = input.playoff_p[i * n + j];
                if !(0.0..=1.0).contains(&p) {
                    return Err(SimError::PlayoffProb(i, j));
                }
            }
        }

        let mut base = SeasonAccumulator::new(cfg);
        let mut pending = Vec::new();
        let mut tables = Vec::new();
        let mut pending_of = vec![u32::MAX; games.len()];
        let game_err = |index, source| SimError::Game { index, source };
        for (i, (g, st)) in games.iter().zip(&input.status).enumerate() {
            let (probs, base_score, lh, la, stream) = match *st {
                GameStatus::Final(r) => {
                    if r.home_goals == r.away_goals {
                        return Err(SimError::TiedFinal(i));
                    }
                    base.apply(g, &r);
                    continue;
                }
                GameStatus::Live {
                    home_score,
                    away_score,
                    probs,
                    lam_home_rem,
                    lam_away_rem,
                } => (
                    probs,
                    (home_score, away_score),
                    lam_home_rem,
                    lam_away_rem,
                    Stream::LiveGoals,
                ),
                GameStatus::Future {
                    probs,
                    lam_home,
                    lam_away,
                } => (probs, (0, 0), lam_home, lam_away, Stream::Scoreline),
            };
            let cdf = OutcomeCdf::new(&probs).map_err(|e| game_err(i, e))?;
            let table =
                ScoreTable::new(base_score, lh, la, input.tie_theta).map_err(|e| game_err(i, e))?;
            pending_of[i] = pending.len() as u32;
            // Outcome-independent counts go straight into the base.
            base.gp[g.home as usize] += 1;
            base.gp[g.away as usize] += 1;
            if g.counts_h2h {
                base.h2h_games[g.home as usize * n + g.away as usize] += 1;
                base.h2h_games[g.away as usize * n + g.home as usize] += 1;
            }
            pending.push(Pending {
                game: i as u32,
                h: g.home as u8,
                a: g.away as u8,
                h2h: g.counts_h2h as u16,
                sg: *g,
                cdf,
                base: base_score,
                stream,
            });
            tables.push(table);
        }

        let mut focus = Vec::with_capacity(input.focus_games.len());
        let mut focus_probs = Vec::with_capacity(input.focus_games.len());
        for &f in &input.focus_games {
            let i = f as usize;
            if i >= games.len() {
                return Err(SimError::FocusOutOfRange(f));
            }
            if pending_of[i] != u32::MAX {
                let pi = pending_of[i];
                focus.push(FocusSource::Pending(pi));
                focus_probs.push(pending[pi as usize].cdf.probs());
            } else if let GameStatus::Final(r) = input.status[i] {
                let k = final_outcome(&r);
                focus.push(FocusSource::Fixed(k));
                let mut p = [0.0f32; 6];
                p[k as usize] = 1.0;
                focus_probs.push(p);
            }
        }
        let max_points = cfg.points.win as usize * cfg.games_per_team as usize;
        Ok(Prepared {
            cfg,
            base,
            pending,
            tables,
            focus,
            focus_games: input.focus_games.clone(),
            focus_probs,
            playoff_p: &input.playoff_p,
            seed: input.seed,
            max_points: max_points.max(1),
            pre_goal_steps: pre_goal_steps(cfg),
            delta: outcome_deltas(cfg),
            lazy_goals: true,
        })
    }
}

/// Outcome class (0..6) of a final result.
pub fn final_outcome(r: &GameResult) -> u8 {
    let home = r.home_goals > r.away_goals;
    let k = match r.end {
        EndType::Regulation => 0,
        EndType::Overtime | EndType::OvertimeForfeit => 1,
        EndType::Shootout => 2,
    };
    if home {
        k
    } else {
        k + 3
    }
}

/// Intrinsic steps before the first goals step of the league's chain.
fn pre_goal_steps(cfg: &LeagueConfig) -> Option<Vec<TiebreakStep>> {
    let steps = cfg.tiebreak.steps();
    let first_goal = steps
        .iter()
        .position(|s| matches!(s, TiebreakStep::GoalDifferential | TiebreakStep::GoalsFor))?;
    Some(
        steps[..first_goal]
            .iter()
            .copied()
            .filter(|&s| s != TiebreakStep::HeadToHead)
            .collect(),
    )
}

/// Index of points in an outcome delta vector.
const PTS: usize = 6;

/// Per outcome: `[home, away]` deltas `[gp, w, l, otl, rw, row, pts, 0]`.
fn outcome_deltas(cfg: &LeagueConfig) -> [[[u16; 8]; 2]; 6] {
    let ps = cfg.points;
    let win = |reg: bool, ot: bool| [0, 1, 0, 0, reg as u16, (reg || ot) as u16, ps.win, 0];
    let reg_loss = [0, 0, 1, 0, 0, 0, ps.loss, 0];
    let ot_loss = [0, 0, 0, 1, 0, 0, ps.otl, 0];
    [
        [win(true, false), reg_loss],
        [win(false, true), ot_loss],
        [win(false, false), ot_loss],
        [reg_loss, win(true, false)],
        [ot_loss, win(false, true)],
        [ot_loss, win(false, false)],
    ]
}

/// Final score and end type for outcome `k` given the regulation score.
#[inline(always)]
fn finish(k: u8, h: u8, a: u8) -> GameResult {
    let (home_goals, away_goals, end) = match k {
        0 => (h, a, EndType::Regulation),
        1 => (h + 1, a, EndType::Overtime),
        2 => (h + 1, a, EndType::Shootout),
        3 => (h, a, EndType::Regulation),
        4 => (h, a + 1, EndType::Overtime),
        _ => (h, a + 1, EndType::Shootout),
    };
    GameResult {
        home_goals,
        away_goals,
        end,
    }
}

impl Prepared<'_> {
    fn worker(&self) -> Worker {
        Worker {
            acc: SeasonAccumulator::new(self.cfg),
            ranking: StandingsScratch::new(self.cfg),
            bracket: PlayoffBracket::new(self.cfg),
            outcomes: vec![0; self.pending.len()],
            keys: Vec::with_capacity(self.cfg.n_teams()),
            local: Box::new([[0; 8]; 32]),
            h2h: Box::new([0; 1024]),
        }
    }

    fn tally(&self) -> Tally {
        Tally::new(self.cfg.n_teams(), self.max_points)
    }

    /// Sample the regular season of simulation `sim` into `w.acc`.
    ///
    /// Outcomes are always sampled and applied branch free: each outcome
    /// adds a fixed per-team delta vector (`[gp, w, l, otl, rw, row, pts]`)
    /// into a 32-team scratch and its points into a 32 x 32 head-to-head
    /// scratch, which are flushed into the accumulator once per season.
    /// Games played and head-to-head game counts do not depend on outcomes,
    /// so they are already in the base accumulator. Scorelines only change GF and GA, which
    /// matter only when a tie reaches a goals step of the chain, so they are
    /// sampled only when two clubs are level on every earlier step
    /// ([`Prepared::goals_needed`]). Scoreline draws are keyed by game, so
    /// the result is identical to always sampling them.
    #[inline]
    fn sample_season(&self, sim: u64, w: &mut Worker) {
        let key = SimKey::new(self.seed, sim);
        let local = &mut *w.local;
        let h2h = &mut *w.h2h;
        local.fill([0; 8]);
        h2h.fill(0);
        for (pi, p) in self.pending.iter().enumerate() {
            let k = p
                .cdf
                .sample(key.game(p.game as u64).uniform_f32(Stream::Outcome));
            let d = &self.delta[k as usize % 6];
            let (h, a) = (p.h as usize & 31, p.a as usize & 31);
            for j in 0..8 {
                local[h][j] += d[0][j];
                local[a][j] += d[1][j];
            }
            h2h[(h << 5) | a] += d[0][PTS] * p.h2h;
            h2h[(a << 5) | h] += d[1][PTS] * p.h2h;
            w.outcomes[pi] = k;
        }
        let acc = &mut w.acc;
        acc.copy_from(&self.base);
        let n = acc.n_teams();
        for (t, l) in local.iter().enumerate().take(n) {
            acc.w[t] += l[1];
            acc.l[t] += l[2];
            acc.otl[t] += l[3];
            acc.rw[t] += l[4];
            acc.row[t] += l[5];
            acc.points[t] += l[PTS];
        }
        for a in 0..n {
            for b in 0..n {
                acc.h2h_points[a * n + b] += h2h[(a << 5) | b];
            }
        }
        if !self.lazy_goals || self.goals_needed(&w.acc, &mut w.keys) {
            for (pi, p) in self.pending.iter().enumerate() {
                let k = w.outcomes[pi];
                let u = key.game(p.game as u64).uniform_f32(p.stream);
                let (dh, da) = self.tables[pi].sample(outcome_class(k), u);
                let r = finish(k, p.base.0 + dh, p.base.1 + da);
                w.acc.add_goals(&p.sg, r.home_goals, r.away_goals);
            }
        }
    }

    /// Whether any two clubs are level in points and on every chain step
    /// before the first goals step (head-to-head aside). If not, no
    /// comparison anywhere (standings or home ice) can reach goal
    /// differential or goals for, so goals cannot change any output.
    #[inline]
    fn goals_needed(&self, acc: &SeasonAccumulator, keys: &mut Vec<u64>) -> bool {
        let Some(steps) = &self.pre_goal_steps else {
            return false;
        };
        keys.clear();
        for t in 0..acc.n_teams() {
            let mut k = acc.points[t] as u64;
            for &s in steps {
                let v = match s {
                    TiebreakStep::FewerGamesPlayed => acc.gp[t],
                    TiebreakStep::RegulationWins => acc.rw[t],
                    TiebreakStep::RegulationOvertimeWins => acc.row[t],
                    TiebreakStep::TotalWins => acc.w[t],
                    _ => 0,
                };
                k = (k << 12) | (v as u64 & 0xFFF);
            }
            keys.push(k);
        }
        keys.sort_unstable();
        keys.windows(2).any(|p| p[0] == p[1])
    }

    /// Simulate one best-of series; returns the winner.
    fn series(
        &self,
        acc: &SeasonAccumulator,
        sim: u64,
        slot: u64,
        a: TeamIdx,
        b: TeamIdx,
    ) -> TeamIdx {
        let cfg = self.cfg;
        let n = cfg.n_teams();
        let (h, v) = home_ice(acc, cfg, a, b);
        let need = cfg.playoffs.series_length / 2 + 1;
        let (mut wh, mut wv) = (0u8, 0u8);
        let mut rng = KeyedRng::new(self.seed, sim, slot, Stream::Playoff);
        for &h_hosts in &cfg.playoffs.home_pattern {
            let (host, guest) = if h_hosts { (h, v) } else { (v, h) };
            let p = self.playoff_p[host as usize * n + guest as usize] as f64;
            let host_wins = rng.next_f64() < p;
            if host_wins == h_hosts {
                wh += 1;
            } else {
                wv += 1;
            }
            if wh == need {
                return h;
            }
            if wv == need {
                return v;
            }
        }
        unreachable!("series length is odd and validated")
    }

    /// Run one simulation and record it.
    fn simulate(&self, sim: u64, w: &mut Worker, t: &mut Tally, out: &mut ChunkOut, j: usize) {
        self.sample_season(sim, w);
        let cfg = self.cfg;
        let n = cfg.n_teams();
        let acc = &w.acc;
        let r = rank_league(acc, cfg, &mut w.ranking);
        playoff_bracket(r, acc, cfg, &mut w.bracket);

        let top = cfg.playoffs.division_top as u16;
        let n_wc = cfg.playoffs.wildcards_per_conference as u16;
        let bins = self.max_points + 1;
        let mut playoff_mask = 0u32;
        let mut division_mask = 0u32;
        let c = &mut t.counts;
        for team in 0..n {
            let pts = acc.points[team] as usize;
            t.points_sum[team] += pts as u64;
            t.hist[team * bins + pts.min(self.max_points)] += 1;
            let dr = r.division_rank[team];
            let wr = r.wildcard_rank[team];
            if r.qualified[team] {
                playoff_mask |= 1 << team;
                c[Metric::Playoffs as usize * n + team] += 1;
            }
            if dr == 1 {
                division_mask |= 1 << team;
                c[Metric::Division as usize * n + team] += 1;
            }
            if dr <= top {
                c[Metric::Top3Div as usize * n + team] += 1;
            }
            if wr >= 1 && wr <= n_wc {
                c[Metric::Wildcard as usize * n + team] += 1;
            }
            if r.league_rank[team] == 1 {
                c[Metric::Presidents as usize * n + team] += 1;
            }
            if r.league_rank[team] as usize == n {
                c[Metric::Last as usize * n + team] += 1;
            }
            if r.conference_rank[team] == 1 {
                c[Metric::ConfFirst as usize * n + team] += 1;
            }
            let slot = if dr <= top {
                dr as usize - 1
            } else if wr >= 1 && wr <= n_wc {
                3 + wr as usize - 1
            } else {
                5
            };
            t.seeds[team * SEED_SLOTS.len() + slot.min(5)] += 1;
        }

        // Playoffs: slots 0..4C round 1, 4C..6C round 2, 6C..7C conference
        // finals, 7C the final.
        let n_conf = cfg.conferences.len();
        let mut r1 = [0 as TeamIdx; 32];
        for (s, m) in w.bracket.round1.iter().enumerate() {
            r1[s] = self.series(acc, sim, s as u64, m.high_seed, m.low_seed);
            c[Metric::Round2 as usize * n + r1[s] as usize] += 1;
        }
        let mut champs = [0 as TeamIdx; 16];
        for (conf, champ_slot) in champs.iter_mut().enumerate().take(n_conf) {
            let base = 4 * conf;
            let a = self.series(
                acc,
                sim,
                (4 * n_conf + 2 * conf) as u64,
                r1[base],
                r1[base + 1],
            );
            let b = self.series(
                acc,
                sim,
                (4 * n_conf + 2 * conf + 1) as u64,
                r1[base + 2],
                r1[base + 3],
            );
            c[Metric::ConfFinal as usize * n + a as usize] += 1;
            c[Metric::ConfFinal as usize * n + b as usize] += 1;
            let champ = self.series(acc, sim, (6 * n_conf + conf) as u64, a, b);
            c[Metric::Final as usize * n + champ as usize] += 1;
            *champ_slot = champ;
        }
        // Conference champions meet in the final (two conferences).
        let cup = self.series(acc, sim, (7 * n_conf) as u64, champs[0], champs[1]);
        c[Metric::Cup as usize * n + cup as usize] += 1;

        out.playoff_mask[j] = playoff_mask;
        out.division_mask[j] = division_mask;
        out.cup_winner[j] = cup as u8;
        let nf = self.focus.len();
        for (f, src) in self.focus.iter().enumerate() {
            out.outcomes[j * nf + f] = match *src {
                FocusSource::Pending(pi) => w.outcomes[pi as usize],
                FocusSource::Fixed(k) => k,
            };
        }
    }

    fn run_chunk(&self, chunk: usize, w: &mut Worker, t: &mut Tally, mut out: ChunkOut) {
        let first = chunk * CHUNK;
        for j in 0..out.playoff_mask.len() {
            self.simulate((first + j) as u64, w, t, &mut out, j);
        }
    }

    fn new_records(&self, n_sims: usize) -> SimRecords {
        SimRecords {
            n_sims: n_sims as u32,
            n_teams: self.cfg.n_teams(),
            focus_games: self.focus_games.clone(),
            focus_probs: self.focus_probs.clone(),
            outcomes: vec![0; n_sims * self.focus.len()],
            playoff_mask: vec![0; n_sims],
            division_mask: vec![0; n_sims],
            cup_winner: vec![0; n_sims],
        }
    }

    fn finish(&self, tally: Tally, records: SimRecords, n_sims: usize) -> SimResult {
        SimResult {
            n_sims: n_sims as u32,
            n_teams: self.cfg.n_teams(),
            max_points: self.max_points,
            counts: tally.counts,
            points_sum: tally.points_sum,
            points_hist: tally.hist,
            seed_counts: tally.seeds,
            records,
        }
    }
}

/// Split the record buffers into per-chunk mutable slices.
fn split_out(rec: &mut SimRecords, nf: usize) -> Vec<ChunkOut<'_>> {
    let mut outs = Vec::with_capacity(rec.playoff_mask.len().div_ceil(CHUNK));
    let mut o_rest: &mut [u8] = &mut rec.outcomes;
    let mut p_rest: &mut [u32] = &mut rec.playoff_mask;
    let mut d_rest: &mut [u32] = &mut rec.division_mask;
    let mut c_rest: &mut [u8] = &mut rec.cup_winner;
    while !p_rest.is_empty() {
        let k = CHUNK.min(p_rest.len());
        let (o, o2) = std::mem::take(&mut o_rest).split_at_mut(k * nf);
        let (p, p2) = std::mem::take(&mut p_rest).split_at_mut(k);
        let (d, d2) = std::mem::take(&mut d_rest).split_at_mut(k);
        let (c, c2) = std::mem::take(&mut c_rest).split_at_mut(k);
        (o_rest, p_rest, d_rest, c_rest) = (o2, p2, d2, c2);
        outs.push(ChunkOut {
            outcomes: o,
            playoff_mask: p,
            division_mask: d,
            cup_winner: c,
        });
    }
    outs
}

fn run_serial(prep: &Prepared, n_sims: usize) -> SimResult {
    let mut rec = prep.new_records(n_sims);
    let mut w = prep.worker();
    let mut t = prep.tally();
    let nf = prep.focus.len();
    for (chunk, out) in split_out(&mut rec, nf).into_iter().enumerate() {
        prep.run_chunk(chunk, &mut w, &mut t, out);
    }
    prep.finish(t, rec, n_sims)
}

#[cfg(feature = "parallel")]
fn run_parallel(prep: &Prepared, n_sims: usize) -> SimResult {
    use rayon::prelude::*;
    let mut rec = prep.new_records(n_sims);
    let nf = prep.focus.len();
    let outs = split_out(&mut rec, nf);
    let tally = outs
        .into_par_iter()
        .enumerate()
        .fold(
            || (prep.worker(), prep.tally()),
            |(mut w, mut t), (chunk, out)| {
                prep.run_chunk(chunk, &mut w, &mut t, out);
                (w, t)
            },
        )
        .map(|(_, t)| t)
        .reduce(|| prep.tally(), Tally::merge);
    prep.finish(tally, rec, n_sims)
}

#[cfg(test)]
mod tests;
