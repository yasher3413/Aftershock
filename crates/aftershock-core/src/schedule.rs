//! The full regular-season schedule.
//!
//! The schedule is known before the season starts, so the head-to-head "odd
//! game" exclusion can be precomputed per game: when two clubs meet an odd
//! number of times, the first game played in the city that hosts the extra
//! game does not count toward head-to-head tiebreaking.

use crate::league::TeamIdx;

/// One scheduled game. Games are stored in chronological order; the index
/// in [`Schedule::games`] is the game's order index.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ScheduledGame {
    /// Home team.
    pub home: TeamIdx,
    /// Away team.
    pub away: TeamIdx,
    /// `false` for the pair's "odd game", which head-to-head tiebreaking
    /// ignores.
    pub counts_h2h: bool,
}

/// A full season schedule in chronological order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Schedule {
    n_teams: usize,
    games: Vec<ScheduledGame>,
}

/// Errors building a schedule.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ScheduleError {
    /// A game references a team index outside the league.
    #[error("game {0} references an unknown team")]
    UnknownTeam(usize),
    /// A team plays itself.
    #[error("game {0} has the same home and away team")]
    SelfGame(usize),
}

impl Schedule {
    /// Build a schedule from `(home, away)` pairs in chronological order
    /// (the slice position is the order index) for a league of `n_teams`.
    pub fn new(n_teams: usize, games: &[(TeamIdx, TeamIdx)]) -> Result<Self, ScheduleError> {
        for (i, &(h, a)) in games.iter().enumerate() {
            if h as usize >= n_teams || a as usize >= n_teams {
                return Err(ScheduleError::UnknownTeam(i));
            }
            if h == a {
                return Err(ScheduleError::SelfGame(i));
            }
        }
        // Per ordered pair (host, visitor): games hosted.
        let mut hosted = vec![0u32; n_teams * n_teams];
        for &(h, a) in games {
            hosted[h as usize * n_teams + a as usize] += 1;
        }
        let mut excluded_done = vec![false; n_teams * n_teams];
        let mut out = Vec::with_capacity(games.len());
        for &(h, a) in games {
            let (hu, au) = (h as usize, a as usize);
            let h_hosts = hosted[hu * n_teams + au];
            let a_hosts = hosted[au * n_teams + hu];
            let odd = (h_hosts + a_hosts) % 2 == 1;
            let mut counts = true;
            // The extra game's city is the one hosting more meetings. Drop
            // the first game played there.
            if odd && h_hosts > a_hosts {
                let key = hu.min(au) * n_teams + hu.max(au);
                if !excluded_done[key] {
                    excluded_done[key] = true;
                    counts = false;
                }
            }
            out.push(ScheduledGame {
                home: h,
                away: a,
                counts_h2h: counts,
            });
        }
        Ok(Schedule {
            n_teams,
            games: out,
        })
    }

    /// Number of teams in the league.
    #[inline]
    pub fn n_teams(&self) -> usize {
        self.n_teams
    }

    /// Games in chronological order.
    #[inline]
    pub fn games(&self) -> &[ScheduledGame] {
        &self.games
    }

    /// Number of games.
    #[inline]
    pub fn len(&self) -> usize {
        self.games.len()
    }

    /// Whether the schedule has no games.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.games.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn odd_game_is_first_game_in_extra_city() {
        // A hosts twice, B once: the first game at A is the odd game.
        let s = Schedule::new(2, &[(1, 0), (0, 1), (0, 1)]).unwrap();
        let c: Vec<bool> = s.games().iter().map(|g| g.counts_h2h).collect();
        assert_eq!(c, vec![true, false, true]);
    }

    #[test]
    fn even_series_counts_every_game() {
        let s = Schedule::new(2, &[(0, 1), (1, 0), (0, 1), (1, 0)]).unwrap();
        assert!(s.games().iter().all(|g| g.counts_h2h));
    }

    #[test]
    fn single_meeting_is_excluded() {
        let s = Schedule::new(3, &[(0, 1), (1, 2), (2, 1)]).unwrap();
        let c: Vec<bool> = s.games().iter().map(|g| g.counts_h2h).collect();
        assert_eq!(c, vec![false, true, true]);
    }

    #[test]
    fn rejects_bad_games() {
        assert_eq!(
            Schedule::new(2, &[(0, 2)]),
            Err(ScheduleError::UnknownTeam(0))
        );
        assert_eq!(Schedule::new(2, &[(1, 1)]), Err(ScheduleError::SelfGame(0)));
    }
}
