//! Aftershock core: league rules, standings, tiebreakers, and Monte Carlo
//! season simulation.

pub mod league;
pub mod ranking;
pub mod rng;
pub mod schedule;
pub mod standings;
pub mod tiebreak;

pub use league::{ConfigError, LeagueConfig, TeamIdx};
pub use ranking::{better_record, rank_league, sort_teams, Ranking, StandingsScratch};
pub use schedule::{Schedule, ScheduleError, ScheduledGame};
pub use standings::{EndType, GameResult, SeasonAccumulator, TeamRecord};
pub use tiebreak::{TiebreakChain, TiebreakStep};
