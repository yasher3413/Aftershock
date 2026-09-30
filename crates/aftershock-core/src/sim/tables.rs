//! Precomputed sampling tables: the 6-way outcome CDF and the regulation
//! scoreline tables split by outcome class.
//!
//! Outcome order everywhere: `[home_reg, home_ot, home_so, away_reg,
//! away_ot, away_so]`.

#![allow(clippy::needless_range_loop)]

/// Largest number of goals per side in a scoreline table (cells cover
/// `0..=MAX_GOALS`).
pub const MAX_GOALS: usize = 10;
const SIDE: usize = MAX_GOALS + 1;
const CELLS: usize = SIDE * SIDE;

/// Number of outcome classes in the 6-way model.
pub const N_OUTCOMES: usize = 6;

/// Regulation result class of an outcome.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum RegClass {
    /// Home team ahead at the end of regulation.
    HomeAhead = 0,
    /// Away team ahead at the end of regulation.
    AwayAhead = 1,
    /// Tied after regulation (overtime or shootout follows).
    Tied = 2,
}

/// Regulation class of outcome `k` (0..6).
#[inline(always)]
pub fn outcome_class(k: u8) -> RegClass {
    match k {
        0 => RegClass::HomeAhead,
        3 => RegClass::AwayAhead,
        _ => RegClass::Tied,
    }
}

/// Errors in probability inputs.
#[derive(Debug, thiserror::Error, PartialEq)]
pub enum TableError {
    /// Probabilities are negative, not finite, or sum to zero.
    #[error("bad outcome probabilities {0:?}")]
    BadProbs([f32; 6]),
    /// Expected goals are negative or not finite.
    #[error("bad expected goals {0} {1}")]
    BadLambda(f32, f32),
}

/// Inverse CDF over the six outcomes. `cum[j]` is the upper boundary of
/// outcome `j` for `j < 5`; outcome 5 takes the rest of `[0, 1)`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OutcomeCdf {
    cum: [f32; 5],
}

impl OutcomeCdf {
    /// Build from (not necessarily normalized) probabilities.
    pub fn new(probs: &[f32; 6]) -> Result<Self, TableError> {
        let mut total = 0.0f64;
        for &p in probs {
            if !(p.is_finite() && p >= 0.0) {
                return Err(TableError::BadProbs(*probs));
            }
            total += p as f64;
        }
        if total <= 0.0 {
            return Err(TableError::BadProbs(*probs));
        }
        // The last outcome with positive mass ends at exactly 1.0 so that
        // zero-probability outcomes after it can never be drawn.
        let last = probs.iter().rposition(|&p| p > 0.0).unwrap_or(5);
        let mut cum = [1.0f32; 5];
        let mut run = 0.0f64;
        for j in 0..5 {
            run += probs[j] as f64;
            cum[j] = if j >= last {
                1.0
            } else {
                (run / total).min(1.0) as f32
            };
        }
        Ok(OutcomeCdf { cum })
    }

    /// Normalized probabilities implied by the table.
    pub fn probs(&self) -> [f32; 6] {
        let mut out = [0.0f32; 6];
        let mut prev = 0.0f32;
        for j in 0..5 {
            out[j] = self.cum[j] - prev;
            prev = self.cum[j];
        }
        out[5] = 1.0 - prev;
        out
    }

    /// Boundaries `cum[0..5]`.
    pub fn boundaries(&self) -> [f32; 5] {
        self.cum
    }

    /// Outcome for uniform `u` in `[0, 1)`: the number of boundaries at or
    /// below `u`.
    #[inline(always)]
    pub fn sample(&self, u: f32) -> u8 {
        let c = &self.cum;
        (u >= c[0]) as u8
            + (u >= c[1]) as u8
            + (u >= c[2]) as u8
            + (u >= c[3]) as u8
            + (u >= c[4]) as u8
    }
}

fn poisson(lam: f64) -> [f64; SIDE] {
    let mut p = [0.0; SIDE];
    p[0] = (-lam).exp();
    for k in 1..SIDE {
        p[k] = p[k - 1] * lam / k as f64;
    }
    p
}

/// Regulation goals still to be added to a game's current score, sampled
/// within a regulation class.
///
/// For a future game the current score is 0-0 and the table is the full
/// regulation scoreline. For a live game the table is over goals added from
/// the current score, and each cell is classified by the final regulation
/// result (current plus added).
#[derive(Clone, Debug, PartialEq)]
pub struct ScoreTable {
    /// Cells (as `dh * 11 + da`) with positive mass, grouped by class.
    cells: [u8; CELLS],
    /// Conditional CDF within each class, aligned with `cells`.
    cdf: [f32; CELLS],
    /// Class `c` occupies `start[c]..start[c + 1]`.
    start: [u8; 4],
    /// Smallest added-goal cell consistent with each class, used when the
    /// class has no mass in the table.
    fallback: [(u8, u8); 3],
}

impl ScoreTable {
    /// Table for a game at `score` (home, away) with expected remaining
    /// regulation goals `lam_home`, `lam_away`, Poisson per side, with the
    /// cells ending in a regulation tie multiplied by `theta`.
    pub fn new(
        score: (u8, u8),
        lam_home: f32,
        lam_away: f32,
        theta: f32,
    ) -> Result<Self, TableError> {
        if !(lam_home.is_finite() && lam_away.is_finite() && lam_home >= 0.0 && lam_away >= 0.0) {
            return Err(TableError::BadLambda(lam_home, lam_away));
        }
        let ph = poisson(lam_home as f64);
        let pa = poisson(lam_away as f64);
        let d = score.0 as i32 - score.1 as i32;
        let class_of = |dh: usize, da: usize| {
            let f = d + dh as i32 - da as i32;
            if f > 0 {
                0
            } else if f < 0 {
                1
            } else {
                2
            }
        };
        let theta = if theta.is_finite() && theta >= 0.0 {
            theta as f64
        } else {
            1.0
        };
        let mut t = ScoreTable {
            cells: [0; CELLS],
            cdf: [0.0; CELLS],
            start: [0; 4],
            fallback: [(0, 0); 3],
        };
        let mut n = 0usize;
        for c in 0..3 {
            t.start[c] = n as u8;
            let begin = n;
            let mut total = 0.0f64;
            let mut mass = [0.0f64; CELLS];
            for dh in 0..SIDE {
                for da in 0..SIDE {
                    if class_of(dh, da) != c {
                        continue;
                    }
                    let mut p = ph[dh] * pa[da];
                    if c == 2 {
                        p *= theta;
                    }
                    if p > 0.0 {
                        t.cells[n] = (dh * SIDE + da) as u8;
                        mass[n] = p;
                        total += p;
                        n += 1;
                    }
                }
            }
            if total > 0.0 {
                let mut run = 0.0;
                for i in begin..n {
                    run += mass[i];
                    t.cdf[i] = (run / total) as f32;
                }
                t.cdf[n - 1] = 1.0;
            } else {
                n = begin;
            }
        }
        t.start[3] = n as u8;
        // Fallbacks: fewest added goals reaching each class.
        let (h, a) = (score.0 as i32, score.1 as i32);
        t.fallback[0] = if h > a {
            (0, 0)
        } else {
            ((a - h + 1) as u8, 0)
        };
        t.fallback[1] = if a > h {
            (0, 0)
        } else {
            (0, (h - a + 1) as u8)
        };
        t.fallback[2] = if h >= a {
            (0, (h - a) as u8)
        } else {
            ((a - h) as u8, 0)
        };
        Ok(t)
    }

    /// Sample added goals `(home, away)` within `class` from uniform `u`.
    #[inline]
    pub fn sample(&self, class: RegClass, u: f32) -> (u8, u8) {
        let c = class as usize;
        let (s, e) = (self.start[c] as usize, self.start[c + 1] as usize);
        if s == e {
            return self.fallback[c];
        }
        let cdf = &self.cdf[s..e];
        let i = cdf.partition_point(|&x| x <= u).min(e - s - 1);
        let cell = self.cells[s + i] as usize;
        ((cell / SIDE) as u8, (cell % SIDE) as u8)
    }

    /// Whether each class (home ahead, away ahead, tied) has any mass in
    /// the table. A class without mass samples its fallback cell.
    pub fn class_has_mass(&self) -> [bool; 3] {
        [0, 1, 2].map(|c| self.start[c] != self.start[c + 1])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outcome_cdf_samples_every_outcome_in_order() {
        let cdf = OutcomeCdf::new(&[0.4, 0.1, 0.05, 0.3, 0.1, 0.05]).unwrap();
        let b = cdf.boundaries();
        assert_eq!(cdf.sample(0.0), 0);
        assert_eq!(cdf.sample(b[0] - 1e-6), 0);
        assert_eq!(cdf.sample(b[0]), 1);
        assert_eq!(cdf.sample(b[3]), 4);
        assert_eq!(cdf.sample(0.999_999), 5);
        let p = cdf.probs();
        assert!((p[0] - 0.4).abs() < 1e-6 && (p[5] - 0.05).abs() < 1e-6);
    }

    #[test]
    fn zero_probability_outcomes_never_drawn() {
        let cdf = OutcomeCdf::new(&[0.0, 0.5, 0.0, 0.5, 0.0, 0.0]).unwrap();
        for i in 0..1000 {
            let k = cdf.sample(i as f32 / 1000.0);
            assert!(k == 1 || k == 3, "{k}");
        }
        assert!(OutcomeCdf::new(&[0.0; 6]).is_err());
        assert!(OutcomeCdf::new(&[f32::NAN, 1.0, 0.0, 0.0, 0.0, 0.0]).is_err());
    }

    #[test]
    fn future_table_classes_match_scorelines() {
        let t = ScoreTable::new((0, 0), 3.1, 2.8, 1.2).unwrap();
        for i in 0..200 {
            let u = i as f32 / 200.0;
            let (h, a) = t.sample(RegClass::HomeAhead, u);
            assert!(h > a);
            let (h, a) = t.sample(RegClass::AwayAhead, u);
            assert!(a > h);
            let (h, a) = t.sample(RegClass::Tied, u);
            assert_eq!(h, a);
        }
    }

    #[test]
    fn live_table_conditions_on_current_score() {
        // Home leads 3-1: a tie needs at least two away goals net.
        let t = ScoreTable::new((3, 1), 0.8, 0.9, 1.0).unwrap();
        for i in 0..200 {
            let u = i as f32 / 200.0;
            let (dh, da) = t.sample(RegClass::Tied, u);
            assert_eq!(3 + dh, 1 + da);
            let (dh, da) = t.sample(RegClass::AwayAhead, u);
            assert!(1 + da > 3 + dh);
        }
    }

    #[test]
    fn empty_class_uses_smallest_consistent_cell() {
        // No time left: all mass at no added goals, so only the current
        // class (home ahead) has mass.
        let t = ScoreTable::new((2, 0), 0.0, 0.0, 1.0).unwrap();
        assert_eq!(t.class_has_mass(), [true, false, false]);
        assert_eq!(t.sample(RegClass::HomeAhead, 0.5), (0, 0));
        assert_eq!(t.sample(RegClass::Tied, 0.5), (0, 2));
        assert_eq!(t.sample(RegClass::AwayAhead, 0.5), (0, 3));
        let t = ScoreTable::new((1, 4), 0.0, 0.0, 1.0).unwrap();
        assert_eq!(t.sample(RegClass::HomeAhead, 0.1), (4, 0));
        assert_eq!(t.sample(RegClass::Tied, 0.1), (3, 0));
    }

    #[test]
    fn theta_does_not_change_within_class_shape() {
        // Theta scales every tied cell by the same factor, so it changes
        // only the class masses (which the 6-way probabilities already fix),
        // never the conditional scoreline within a class.
        let a = ScoreTable::new((0, 0), 3.0, 3.0, 1.0).unwrap();
        let b = ScoreTable::new((0, 0), 3.0, 3.0, 1.3).unwrap();
        for i in 0..50 {
            let u = i as f32 / 50.0;
            assert_eq!(a.sample(RegClass::Tied, u), b.sample(RegClass::Tied, u));
        }
        assert!(ScoreTable::new((0, 0), -1.0, 1.0, 1.0).is_err());
    }
}
