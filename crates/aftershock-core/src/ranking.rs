//! Standings order: division, wild card, conference, and league ranks.
//!
//! Ranking sorts by points and runs the tiebreak chain only on runs of
//! clubs tied in points. All buffers live in a [`StandingsScratch`] that is
//! allocated once per league and reused, so [`rank_league`] performs no heap
//! allocation per call.
//!
//! # Tie resolution
//!
//! For a group of clubs tied in points, the chain steps are tried in order.
//! A step that does not separate anyone moves on to the next step. As soon
//! as a step separates the group, the clubs are ordered by that step, and
//! every subgroup that is still tied goes back to step 1 of the chain with
//! only its own members (so a head-to-head step is recomputed among the
//! smaller group). Steps other than head-to-head depend only on the club
//! itself, so restarting only changes the outcome at the head-to-head step.
//! If the chain is exhausted, clubs keep config order (the official
//! procedure ends in a draw or a tiebreak game, which a deterministic engine
//! cannot reproduce).

use core::cmp::Ordering;

use crate::league::{LeagueConfig, TeamIdx};
use crate::standings::SeasonAccumulator;
use crate::tiebreak::TiebreakStep;

/// Ordered standings and per-team positions. Positions are 1-based.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Ranking {
    /// All teams, best first.
    pub league: Vec<TeamIdx>,
    /// Per conference: all member teams, best first.
    pub conference: Vec<Vec<TeamIdx>>,
    /// Per division: all member teams, best first.
    pub division: Vec<Vec<TeamIdx>>,
    /// Per conference: teams outside the division qualifiers, best first.
    /// The first `wildcards_per_conference` are the wild cards.
    pub wildcard: Vec<Vec<TeamIdx>>,
    /// League position of each team.
    pub league_rank: Vec<u16>,
    /// Conference position of each team.
    pub conference_rank: Vec<u16>,
    /// Division position of each team.
    pub division_rank: Vec<u16>,
    /// Wild-card position of each team; 0 for division qualifiers.
    pub wildcard_rank: Vec<u16>,
    /// Whether each team qualifies for the playoffs.
    pub qualified: Vec<bool>,
}

/// Reusable buffers for [`rank_league`]. Create one per thread with
/// [`StandingsScratch::new`] and reuse it for every simulation.
#[derive(Clone, Debug)]
pub struct StandingsScratch {
    ranking: Ranking,
    h2h_num: Vec<u32>,
    h2h_den: Vec<u32>,
}

impl StandingsScratch {
    /// Allocate buffers sized for `cfg`.
    pub fn new(cfg: &LeagueConfig) -> Self {
        let n = cfg.n_teams();
        let ranking = Ranking {
            league: Vec::with_capacity(n),
            conference: cfg
                .conferences
                .iter()
                .map(|c| Vec::with_capacity(c.teams.len()))
                .collect(),
            division: cfg
                .divisions
                .iter()
                .map(|d| Vec::with_capacity(d.teams.len()))
                .collect(),
            wildcard: cfg
                .conferences
                .iter()
                .map(|c| Vec::with_capacity(c.teams.len()))
                .collect(),
            league_rank: vec![0; n],
            conference_rank: vec![0; n],
            division_rank: vec![0; n],
            wildcard_rank: vec![0; n],
            qualified: vec![false; n],
        };
        StandingsScratch {
            ranking,
            h2h_num: vec![0; n],
            h2h_den: vec![0; n],
        }
    }

    /// The ranking computed by the last [`rank_league`] call.
    pub fn ranking(&self) -> &Ranking {
        &self.ranking
    }
}

/// Context for comparing clubs under one chain.
struct Ctx<'a> {
    acc: &'a SeasonAccumulator,
    steps: &'a [TiebreakStep],
    win_points: u32,
}

impl Ctx<'_> {
    /// Ordering of `a` against `b` at `step`: `Less` means `a` ranks higher.
    /// For the head-to-head step the per-team keys must be precomputed.
    #[inline]
    fn cmp_step(
        &self,
        step: TiebreakStep,
        a: TeamIdx,
        b: TeamIdx,
        num: &[u32],
        den: &[u32],
    ) -> Ordering {
        let acc = self.acc;
        let (a, b) = (a as usize, b as usize);
        match step {
            TiebreakStep::FewerGamesPlayed => acc.gp[a].cmp(&acc.gp[b]),
            TiebreakStep::RegulationWins => acc.rw[b].cmp(&acc.rw[a]),
            TiebreakStep::RegulationOvertimeWins => acc.row[b].cmp(&acc.row[a]),
            TiebreakStep::TotalWins => acc.w[b].cmp(&acc.w[a]),
            TiebreakStep::HeadToHead => {
                // Compare num_a / den_a against num_b / den_b; a club with no
                // counted games is treated as 50 percent.
                let (na, da) = pct_parts(num[a], den[a]);
                let (nb, db) = pct_parts(num[b], den[b]);
                (nb * da).cmp(&(na * db))
            }
            TiebreakStep::GoalDifferential => {
                let da = acc.gf[a] as i32 - acc.ga[a] as i32;
                let db = acc.gf[b] as i32 - acc.ga[b] as i32;
                db.cmp(&da)
            }
            TiebreakStep::GoalsFor => acc.gf[b].cmp(&acc.gf[a]),
        }
    }

    /// Fill head-to-head keys for the members of `group`: points earned and
    /// points available in counted games against the other members.
    fn fill_h2h(&self, group: &[TeamIdx], num: &mut [u32], den: &mut [u32]) {
        let n = self.acc.n_teams();
        for &a in group {
            let (mut p, mut g) = (0u32, 0u32);
            let row = a as usize * n;
            for &b in group {
                p += self.acc.h2h_points[row + b as usize] as u32;
                g += self.acc.h2h_games[row + b as usize] as u32;
            }
            num[a as usize] = p;
            den[a as usize] = g * self.win_points;
        }
    }

    /// Order a group of clubs tied in points, starting at step 1 of the
    /// chain. See the module docs for the restart rule.
    fn resolve(&self, group: &mut [TeamIdx], num: &mut [u32], den: &mut [u32]) {
        debug_assert!(group.len() >= 2);
        for &step in self.steps {
            if step == TiebreakStep::HeadToHead {
                self.fill_h2h(group, num, den);
            }
            group.sort_unstable_by(|&a, &b| self.cmp_step(step, a, b, num, den).then(a.cmp(&b)));
            let first = group[0];
            let last = group[group.len() - 1];
            if self.cmp_step(step, first, last, num, den) == Ordering::Equal {
                continue;
            }
            // Separated: restart the chain within each still-tied run.
            let mut i = 0;
            while i < group.len() {
                let mut j = i + 1;
                while j < group.len()
                    && self.cmp_step(step, group[i], group[j], num, den) == Ordering::Equal
                {
                    j += 1;
                }
                if j - i > 1 {
                    self.resolve(&mut group[i..j], num, den);
                }
                i = j;
            }
            return;
        }
        // Chain exhausted: config order.
        group.sort_unstable();
    }

    /// Sort `teams` by points, resolving ties with the chain.
    fn sort(&self, teams: &mut [TeamIdx], num: &mut [u32], den: &mut [u32]) {
        let pts = &self.acc.points;
        teams.sort_unstable_by(|&a, &b| pts[b as usize].cmp(&pts[a as usize]).then(a.cmp(&b)));
        let mut i = 0;
        while i < teams.len() {
            let p = pts[teams[i] as usize];
            let mut j = i + 1;
            while j < teams.len() && pts[teams[j] as usize] == p {
                j += 1;
            }
            if j - i > 1 {
                self.resolve(&mut teams[i..j], num, den);
            }
            i = j;
        }
    }
}

#[inline]
fn pct_parts(num: u32, den: u32) -> (u64, u64) {
    if den == 0 {
        (1, 2)
    } else {
        (num as u64, den as u64)
    }
}

fn ctx<'a>(acc: &'a SeasonAccumulator, cfg: &'a LeagueConfig) -> Ctx<'a> {
    Ctx {
        acc,
        steps: cfg.tiebreak.steps(),
        win_points: cfg.points.win as u32,
    }
}

/// Sort an arbitrary set of teams in place by points and the league's
/// tiebreak chain, with head-to-head computed among the tied clubs inside
/// `teams`. `num` and `den` are scratch slices of length `n_teams`.
pub fn sort_teams(
    acc: &SeasonAccumulator,
    cfg: &LeagueConfig,
    teams: &mut [TeamIdx],
    num: &mut [u32],
    den: &mut [u32],
) {
    ctx(acc, cfg).sort(teams, num, den);
}

/// Compute division, wild-card, conference, and league standings.
///
/// Every grouping is sorted on its own, so head-to-head tiebreaks always
/// involve exactly the clubs tied within that grouping. Wild-card order
/// covers the conference's clubs outside the top `division_top` of each
/// division. No heap allocation happens once `scratch` has been used.
pub fn rank_league<'s>(
    acc: &SeasonAccumulator,
    cfg: &LeagueConfig,
    scratch: &'s mut StandingsScratch,
) -> &'s Ranking {
    let c = ctx(acc, cfg);
    let StandingsScratch {
        ranking: r,
        h2h_num: num,
        h2h_den: den,
    } = scratch;
    let top = cfg.playoffs.division_top as usize;
    let n_wc = cfg.playoffs.wildcards_per_conference as usize;

    r.qualified.fill(false);
    for (di, d) in cfg.divisions.iter().enumerate() {
        let order = &mut r.division[di];
        order.clear();
        order.extend_from_slice(&d.teams);
        c.sort(order, num, den);
        for (pos, &t) in order.iter().enumerate() {
            r.division_rank[t as usize] = pos as u16 + 1;
            r.qualified[t as usize] = pos < top;
        }
    }
    for (ci, conf) in cfg.conferences.iter().enumerate() {
        let wc = &mut r.wildcard[ci];
        wc.clear();
        for &t in &conf.teams {
            if (r.division_rank[t as usize] as usize) > top {
                wc.push(t);
            } else {
                r.wildcard_rank[t as usize] = 0;
            }
        }
        c.sort(wc, num, den);
        for (pos, &t) in wc.iter().enumerate() {
            r.wildcard_rank[t as usize] = pos as u16 + 1;
            if pos < n_wc {
                r.qualified[t as usize] = true;
            }
        }
        let co = &mut r.conference[ci];
        co.clear();
        co.extend_from_slice(&conf.teams);
        c.sort(co, num, den);
        for (pos, &t) in co.iter().enumerate() {
            r.conference_rank[t as usize] = pos as u16 + 1;
        }
    }
    r.league.clear();
    r.league.extend(0..cfg.n_teams() as TeamIdx);
    c.sort(&mut r.league, num, den);
    for (pos, &t) in r.league.iter().enumerate() {
        r.league_rank[t as usize] = pos as u16 + 1;
    }
    r
}

/// Whether `a` has a better regular-season record than `b`: more points,
/// then the league's tiebreak chain applied to the two clubs. This decides
/// home ice in every playoff series.
pub fn better_record(acc: &SeasonAccumulator, cfg: &LeagueConfig, a: TeamIdx, b: TeamIdx) -> bool {
    if a == b {
        return false;
    }
    let (pa, pb) = (acc.points[a as usize], acc.points[b as usize]);
    if pa != pb {
        return pa > pb;
    }
    let c = ctx(acc, cfg);
    let n = acc.n_teams();
    // Two-club head-to-head keys, computed directly without scratch.
    let (ai, bi) = (a as usize, b as usize);
    let games = acc.h2h_games[ai * n + bi] as u32 * c.win_points;
    for &step in c.steps {
        let ord = if step == TiebreakStep::HeadToHead {
            let (na, da) = pct_parts(acc.h2h_points[ai * n + bi] as u32, games);
            let (nb, db) = pct_parts(acc.h2h_points[bi * n + ai] as u32, games);
            (nb * da).cmp(&(na * db))
        } else {
            c.cmp_step(step, a, b, &[], &[])
        };
        match ord {
            Ordering::Less => return true,
            Ordering::Greater => return false,
            Ordering::Equal => {}
        }
    }
    a < b
}

#[cfg(test)]
mod tests;
