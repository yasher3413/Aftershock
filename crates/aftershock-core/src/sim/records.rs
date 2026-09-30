//! Per-simulation records and what is derived from them: conditional
//! tables ("if this game goes this way") and importance reweighting.

/// Compact record of every simulation.
#[derive(Clone, Debug, PartialEq)]
pub struct SimRecords {
    /// Simulations recorded.
    pub n_sims: u32,
    /// Teams in the league (at most 32).
    pub n_teams: usize,
    /// Schedule index of each focus game, in input order.
    pub focus_games: Vec<u32>,
    /// Normalized 6-way probabilities each focus game was sampled with
    /// (one-hot for games already final).
    pub focus_probs: Vec<[f32; 6]>,
    /// Row-major `[sim][focus]` sampled outcome class (0..6).
    pub outcomes: Vec<u8>,
    /// Per simulation: bit `t` set when team `t` made the playoffs.
    pub playoff_mask: Vec<u32>,
    /// Per simulation: bit `t` set when team `t` won its division.
    pub division_mask: Vec<u32>,
    /// Per simulation: Stanley Cup winner.
    pub cup_winner: Vec<u8>,
}

/// Counts conditioned on each outcome of each focus game.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConditionalTables {
    /// Focus games.
    pub n_focus: usize,
    /// Teams.
    pub n_teams: usize,
    /// Row-major `[focus][outcome]`: simulations with that outcome.
    pub outcome_counts: Vec<u64>,
    /// Row-major `[focus][outcome][team]`: of those, how many had the team
    /// in the playoffs.
    pub playoffs_counts: Vec<u64>,
    /// Row-major `[focus][outcome][team]`: of those, how many had the team
    /// win the Cup.
    pub cup_counts: Vec<u64>,
}

impl ConditionalTables {
    fn ratio(&self, num: &[u64], f: usize, k: usize, t: usize) -> Option<f64> {
        let d = self.outcome_counts[f * 6 + k];
        (d > 0).then(|| num[(f * 6 + k) * self.n_teams + t] as f64 / d as f64)
    }

    /// P(team `t` makes the playoffs | focus game `f` has outcome `k`), or
    /// `None` when no simulation had that outcome.
    pub fn p_playoffs(&self, f: usize, k: usize, t: usize) -> Option<f64> {
        self.ratio(&self.playoffs_counts, f, k, t)
    }

    /// P(team `t` wins the Cup | focus game `f` has outcome `k`).
    pub fn p_cup(&self, f: usize, k: usize, t: usize) -> Option<f64> {
        self.ratio(&self.cup_counts, f, k, t)
    }
}

/// Probabilities after importance reweighting.
#[derive(Clone, Debug, PartialEq)]
pub struct Reweighted {
    /// Reweighted playoff probability per team.
    pub p_playoffs: Vec<f64>,
    /// Reweighted division-title probability per team.
    pub p_division: Vec<f64>,
    /// Reweighted Cup probability per team.
    pub p_cup: Vec<f64>,
    /// Effective sample size `(sum w)^2 / sum w^2`.
    pub ess: f64,
}

/// Errors in a reweighting request.
#[derive(Debug, thiserror::Error, PartialEq)]
pub enum ReweightError {
    /// `games` and `new_probs` differ in length.
    #[error("{0} games but {1} probability rows")]
    Length(usize, usize),
    /// A focus position is out of range.
    #[error("focus position {0} out of range")]
    FocusPosition(u32),
    /// New probabilities are negative, not finite, or sum to zero.
    #[error("bad probabilities for focus position {0}")]
    BadProbs(u32),
    /// Every simulation has zero weight under the new probabilities.
    #[error("all simulations have zero weight")]
    ZeroWeight,
}

impl SimRecords {
    /// Number of focus games.
    pub fn n_focus(&self) -> usize {
        self.focus_games.len()
    }

    /// Outcome of focus game `f` in simulation `sim`.
    #[inline]
    pub fn outcome(&self, sim: usize, f: usize) -> u8 {
        self.outcomes[sim * self.n_focus() + f]
    }

    /// Count tables conditioned on every outcome of every focus game.
    pub fn conditional(&self) -> ConditionalTables {
        let nf = self.n_focus();
        let n = self.n_teams;
        let mut outcome_counts = vec![0u64; nf * 6];
        let mut playoffs_counts = vec![0u64; nf * 6 * n];
        let mut cup_counts = vec![0u64; nf * 6 * n];
        for s in 0..self.n_sims as usize {
            let mask = self.playoff_mask[s];
            let cup = self.cup_winner[s] as usize;
            for f in 0..nf {
                let k = self.outcome(s, f) as usize;
                let row = f * 6 + k;
                outcome_counts[row] += 1;
                cup_counts[row * n + cup] += 1;
                let mut m = mask;
                while m != 0 {
                    let t = m.trailing_zeros() as usize;
                    playoffs_counts[row * n + t] += 1;
                    m &= m - 1;
                }
            }
        }
        ConditionalTables {
            n_focus: nf,
            n_teams: n,
            outcome_counts,
            playoffs_counts,
            cup_counts,
        }
    }

    /// Reweight every simulation by the product over `games` (focus
    /// positions) of `P_new(k) / P_old(k)` for its sampled outcome `k`, and
    /// return the reweighted playoff, division, and Cup probabilities.
    pub fn reweight(
        &self,
        games: &[u32],
        new_probs: &[[f32; 6]],
    ) -> Result<Reweighted, ReweightError> {
        if games.len() != new_probs.len() {
            return Err(ReweightError::Length(games.len(), new_probs.len()));
        }
        // Per game and outcome: the likelihood ratio.
        let mut ratios = Vec::with_capacity(games.len());
        for (&f, p) in games.iter().zip(new_probs) {
            if f as usize >= self.n_focus() {
                return Err(ReweightError::FocusPosition(f));
            }
            let total: f64 = p.iter().map(|&x| x as f64).sum();
            if !p.iter().all(|x| x.is_finite() && *x >= 0.0) || total <= 0.0 {
                return Err(ReweightError::BadProbs(f));
            }
            let old = &self.focus_probs[f as usize];
            let mut r = [0.0f64; 6];
            for k in 0..6 {
                if old[k] > 0.0 {
                    r[k] = p[k] as f64 / total / old[k] as f64;
                }
            }
            ratios.push((f as usize, r));
        }
        let n = self.n_teams;
        let mut p_playoffs = vec![0.0; n];
        let mut p_division = vec![0.0; n];
        let mut p_cup = vec![0.0; n];
        let (mut sw, mut sw2) = (0.0f64, 0.0f64);
        for s in 0..self.n_sims as usize {
            let mut w = 1.0f64;
            for &(f, ref r) in &ratios {
                w *= r[self.outcome(s, f) as usize];
            }
            if w == 0.0 {
                continue;
            }
            sw += w;
            sw2 += w * w;
            let mut m = self.playoff_mask[s];
            while m != 0 {
                p_playoffs[m.trailing_zeros() as usize] += w;
                m &= m - 1;
            }
            let mut m = self.division_mask[s];
            while m != 0 {
                p_division[m.trailing_zeros() as usize] += w;
                m &= m - 1;
            }
            p_cup[self.cup_winner[s] as usize] += w;
        }
        if sw <= 0.0 {
            return Err(ReweightError::ZeroWeight);
        }
        for v in [&mut p_playoffs, &mut p_division, &mut p_cup] {
            for x in v.iter_mut() {
                *x /= sw;
            }
        }
        Ok(Reweighted {
            p_playoffs,
            p_division,
            p_cup,
            ess: sw * sw / sw2,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recs() -> SimRecords {
        // 4 sims, 1 focus game, 2 teams.
        SimRecords {
            n_sims: 4,
            n_teams: 2,
            focus_games: vec![10],
            focus_probs: vec![[0.5, 0.0, 0.0, 0.5, 0.0, 0.0]],
            outcomes: vec![0, 0, 3, 3],
            playoff_mask: vec![0b01, 0b11, 0b10, 0b10],
            division_mask: vec![0b01, 0b01, 0b10, 0b10],
            cup_winner: vec![0, 1, 1, 1],
        }
    }

    #[test]
    fn conditional_counts() {
        let c = recs().conditional();
        assert_eq!(&c.outcome_counts[..], &[2, 0, 0, 2, 0, 0]);
        assert_eq!(c.p_playoffs(0, 0, 0), Some(1.0));
        assert_eq!(c.p_playoffs(0, 0, 1), Some(0.5));
        assert_eq!(c.p_playoffs(0, 3, 0), Some(0.0));
        assert_eq!(c.p_cup(0, 3, 1), Some(1.0));
        assert_eq!(c.p_cup(0, 1, 1), None);
    }

    #[test]
    fn reweight_with_same_probs_is_identity() {
        let r = recs();
        let w = r.reweight(&[0], &[[0.5, 0.0, 0.0, 0.5, 0.0, 0.0]]).unwrap();
        assert_eq!(w.p_playoffs, vec![0.5, 0.75]);
        assert_eq!(w.p_cup, vec![0.25, 0.75]);
        assert!((w.ess - 4.0).abs() < 1e-12);
    }

    #[test]
    fn reweight_to_certain_outcome() {
        let r = recs();
        let w = r.reweight(&[0], &[[1.0, 0.0, 0.0, 0.0, 0.0, 0.0]]).unwrap();
        assert_eq!(w.p_playoffs, vec![1.0, 0.5]);
        assert_eq!(w.p_division, vec![1.0, 0.0]);
        assert!((w.ess - 2.0).abs() < 1e-12);
        assert_eq!(
            r.reweight(&[0], &[[0.0, 1.0, 0.0, 0.0, 0.0, 0.0]]),
            Err(ReweightError::ZeroWeight)
        );
        assert_eq!(
            r.reweight(&[1], &[[1.0; 6]]),
            Err(ReweightError::FocusPosition(1))
        );
    }
}
