//! Per-team season accumulators.
//!
//! [`SeasonAccumulator`] stores every counter as a struct of arrays indexed
//! by [`TeamIdx`], plus a dense head-to-head matrix. Applying a result is a
//! handful of integer adds with no allocation, so a Monte Carlo loop can
//! reset or copy an accumulator and replay thousands of games cheaply.

use crate::league::{LeagueConfig, PointsSystem, TeamIdx};
use crate::schedule::{Schedule, ScheduledGame};

/// How a game ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum EndType {
    /// Decided in regulation.
    Regulation,
    /// Decided in overtime.
    Overtime,
    /// Decided by shootout.
    Shootout,
    /// Decided in overtime while the losing club had pulled its goalkeeper
    /// for an extra attacker. Under the NHL regular-season overtime rule the
    /// loser forfeits the point it earned by reaching overtime, and the
    /// official standings record the game as a regulation loss (L, 0 points)
    /// for it. The winner is credited with an overtime win (ROW, not RW).
    /// The NHL feed reports these games as plain `OT`.
    OvertimeForfeit,
}

impl EndType {
    /// Parse the NHL feed code: `REG`, `OT`, or `SO`.
    pub fn from_code(code: &str) -> Option<Self> {
        match code {
            "REG" => Some(Self::Regulation),
            "OT" => Some(Self::Overtime),
            "SO" => Some(Self::Shootout),
            _ => None,
        }
    }
}

/// Final result of one game. For a shootout, the winner's goals already
/// include the one goal awarded for winning the shootout.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct GameResult {
    /// Home goals (including the shootout goal if the home team won one).
    pub home_goals: u8,
    /// Away goals (including the shootout goal if the away team won one).
    pub away_goals: u8,
    /// How the game ended.
    pub end: EndType,
}

/// Snapshot of one team's record, for display and tests.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TeamRecord {
    /// Games played.
    pub gp: u16,
    /// Wins in any manner.
    pub w: u16,
    /// Regulation losses.
    pub l: u16,
    /// Overtime and shootout losses.
    pub otl: u16,
    /// Points.
    pub points: u16,
    /// Regulation wins.
    pub rw: u16,
    /// Regulation plus overtime wins.
    pub row: u16,
    /// Goals for.
    pub gf: u16,
    /// Goals against.
    pub ga: u16,
}

/// Season-to-date counters for every team, struct-of-arrays layout.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SeasonAccumulator {
    n: usize,
    points_system: PointsSystem,
    /// Games played.
    pub gp: Vec<u16>,
    /// Wins in any manner.
    pub w: Vec<u16>,
    /// Regulation losses.
    pub l: Vec<u16>,
    /// Overtime and shootout losses.
    pub otl: Vec<u16>,
    /// Regulation wins.
    pub rw: Vec<u16>,
    /// Regulation plus overtime wins.
    pub row: Vec<u16>,
    /// Goals for (shootout win adds one).
    pub gf: Vec<u16>,
    /// Goals against (shootout loss adds one).
    pub ga: Vec<u16>,
    /// Points.
    pub points: Vec<u16>,
    /// `h2h_points[a * n + b]`: points `a` earned against `b` in games
    /// that count for head-to-head (odd games excluded).
    pub h2h_points: Vec<u16>,
    /// `h2h_games[a * n + b]`: counted head-to-head games between `a` and
    /// `b` (symmetric).
    pub h2h_games: Vec<u16>,
}

impl SeasonAccumulator {
    /// Empty accumulator for a league.
    pub fn new(cfg: &LeagueConfig) -> Self {
        Self::with_points(cfg.n_teams(), cfg.points)
    }

    /// Empty accumulator for `n` teams with an explicit points system.
    pub fn with_points(n: usize, points_system: PointsSystem) -> Self {
        SeasonAccumulator {
            n,
            points_system,
            gp: vec![0; n],
            w: vec![0; n],
            l: vec![0; n],
            otl: vec![0; n],
            rw: vec![0; n],
            row: vec![0; n],
            gf: vec![0; n],
            ga: vec![0; n],
            points: vec![0; n],
            h2h_points: vec![0; n * n],
            h2h_games: vec![0; n * n],
        }
    }

    /// Number of teams.
    #[inline]
    pub fn n_teams(&self) -> usize {
        self.n
    }

    /// Zero every counter, keeping the allocations.
    pub fn reset(&mut self) {
        for v in [
            &mut self.gp,
            &mut self.w,
            &mut self.l,
            &mut self.otl,
            &mut self.rw,
            &mut self.row,
            &mut self.gf,
            &mut self.ga,
            &mut self.points,
            &mut self.h2h_points,
            &mut self.h2h_games,
        ] {
            v.fill(0);
        }
    }

    /// Overwrite this accumulator with `other` without reallocating. Both
    /// must be for the same number of teams. Use this to restore a
    /// season-to-date snapshot at the start of each simulation.
    pub fn copy_from(&mut self, other: &SeasonAccumulator) {
        assert_eq!(self.n, other.n, "team count mismatch");
        self.points_system = other.points_system;
        self.gp.copy_from_slice(&other.gp);
        self.w.copy_from_slice(&other.w);
        self.l.copy_from_slice(&other.l);
        self.otl.copy_from_slice(&other.otl);
        self.rw.copy_from_slice(&other.rw);
        self.row.copy_from_slice(&other.row);
        self.gf.copy_from_slice(&other.gf);
        self.ga.copy_from_slice(&other.ga);
        self.points.copy_from_slice(&other.points);
        self.h2h_points.copy_from_slice(&other.h2h_points);
        self.h2h_games.copy_from_slice(&other.h2h_games);
    }

    /// Record one final result for a scheduled game.
    ///
    /// The result must have a winner (`home_goals != away_goals`).
    #[inline]
    pub fn apply(&mut self, game: &ScheduledGame, r: &GameResult) {
        debug_assert_ne!(r.home_goals, r.away_goals, "games cannot end tied");
        self.apply_outcome(game, r.home_goals > r.away_goals, r.end);
        self.add_goals(game, r.home_goals, r.away_goals);
    }

    /// Add a game's goals to GF and GA only. Together with
    /// [`SeasonAccumulator::apply_outcome`] this equals
    /// [`SeasonAccumulator::apply`].
    #[inline(always)]
    pub fn add_goals(&mut self, game: &ScheduledGame, home_goals: u8, away_goals: u8) {
        let (h, a) = (game.home as usize, game.away as usize);
        self.gf[h] += home_goals as u16;
        self.ga[h] += away_goals as u16;
        self.gf[a] += away_goals as u16;
        self.ga[a] += home_goals as u16;
    }

    /// Record everything about a result except goals: games played, wins,
    /// losses, points, RW, ROW, and head-to-head points.
    #[inline(always)]
    pub fn apply_outcome(&mut self, game: &ScheduledGame, home_wins: bool, end: EndType) {
        let (h, a) = (game.home as usize, game.away as usize);
        let (win, lose) = if home_wins { (h, a) } else { (a, h) };
        let ps = self.points_system;
        self.gp[h] += 1;
        self.gp[a] += 1;
        self.w[win] += 1;
        self.points[win] += ps.win;
        let lose_pts = match end {
            EndType::Regulation => {
                self.rw[win] += 1;
                self.row[win] += 1;
                self.l[lose] += 1;
                ps.loss
            }
            EndType::Overtime => {
                self.row[win] += 1;
                self.otl[lose] += 1;
                ps.otl
            }
            EndType::Shootout => {
                self.otl[lose] += 1;
                ps.otl
            }
            EndType::OvertimeForfeit => {
                self.row[win] += 1;
                self.l[lose] += 1;
                ps.loss
            }
        };
        self.points[lose] += lose_pts;
        if game.counts_h2h {
            let n = self.n;
            self.h2h_points[win * n + lose] += ps.win;
            self.h2h_points[lose * n + win] += lose_pts;
            self.h2h_games[h * n + a] += 1;
            self.h2h_games[a * n + h] += 1;
        }
    }

    /// Record the result of game `idx` of `schedule`.
    #[inline]
    pub fn apply_indexed(&mut self, schedule: &Schedule, idx: usize, r: &GameResult) {
        self.apply(&schedule.games()[idx], r);
    }

    /// Goal differential of team `t`.
    #[inline]
    pub fn goal_diff(&self, t: TeamIdx) -> i32 {
        self.gf[t as usize] as i32 - self.ga[t as usize] as i32
    }

    /// Record snapshot for team `t`.
    pub fn record(&self, t: TeamIdx) -> TeamRecord {
        let i = t as usize;
        TeamRecord {
            gp: self.gp[i],
            w: self.w[i],
            l: self.l[i],
            otl: self.otl[i],
            points: self.points[i],
            rw: self.rw[i],
            row: self.row[i],
            gf: self.gf[i],
            ga: self.ga[i],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ps() -> PointsSystem {
        PointsSystem {
            win: 2,
            otl: 1,
            loss: 0,
        }
    }

    fn res(h: u8, a: u8, end: EndType) -> GameResult {
        GameResult {
            home_goals: h,
            away_goals: a,
            end,
        }
    }

    #[test]
    fn counts_each_end_type() {
        let s = Schedule::new(2, &[(0, 1), (0, 1), (1, 0)]).unwrap();
        let mut acc = SeasonAccumulator::with_points(2, ps());
        acc.apply_indexed(&s, 0, &res(3, 1, EndType::Regulation));
        acc.apply_indexed(&s, 1, &res(2, 3, EndType::Overtime));
        acc.apply_indexed(&s, 2, &res(4, 3, EndType::Shootout));
        let a = acc.record(0);
        let b = acc.record(1);
        assert_eq!((a.gp, a.w, a.l, a.otl, a.points), (3, 1, 0, 2, 4));
        assert_eq!((a.rw, a.row, a.gf, a.ga), (1, 1, 8, 8));
        assert_eq!((b.gp, b.w, b.l, b.otl, b.points), (3, 2, 1, 0, 4));
        assert_eq!((b.rw, b.row), (0, 1));
        // Game 0 is the odd game (team 0 hosts two of three): excluded.
        assert_eq!(acc.h2h_games[1], 2);
        assert_eq!(acc.h2h_points[1], 2); // team 0: OTL + OTL
        assert_eq!(acc.h2h_points[2], 4); // team 1: two wins
    }

    #[test]
    fn overtime_forfeit_charges_a_regulation_loss() {
        // Two meetings, so game 0 counts for head-to-head.
        let s = Schedule::new(2, &[(0, 1), (1, 0)]).unwrap();
        let mut acc = SeasonAccumulator::with_points(2, ps());
        acc.apply_indexed(&s, 0, &res(1, 2, EndType::OvertimeForfeit));
        let (home, away) = (acc.record(0), acc.record(1));
        assert_eq!((home.l, home.otl, home.points), (1, 0, 0));
        assert_eq!((away.w, away.rw, away.row, away.points), (1, 0, 1, 2));
        assert_eq!((acc.h2h_points[1], acc.h2h_points[2]), (0, 2));
    }

    #[test]
    fn copy_and_reset() {
        let s = Schedule::new(2, &[(0, 1)]).unwrap();
        let mut a = SeasonAccumulator::with_points(2, ps());
        a.apply_indexed(&s, 0, &res(1, 0, EndType::Regulation));
        let mut b = SeasonAccumulator::with_points(2, ps());
        b.copy_from(&a);
        assert_eq!(a, b);
        b.reset();
        assert_eq!(b, SeasonAccumulator::with_points(2, ps()));
    }

    #[test]
    fn end_type_codes() {
        assert_eq!(EndType::from_code("SO"), Some(EndType::Shootout));
        assert_eq!(EndType::from_code("OT"), Some(EndType::Overtime));
        assert_eq!(EndType::from_code("REG"), Some(EndType::Regulation));
        assert_eq!(EndType::from_code("SOX"), None);
    }
}
