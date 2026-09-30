//! Aftershock core: league rules, standings, tiebreakers, and Monte Carlo
//! season simulation.

pub mod league;
pub mod playoffs;
pub mod ranking;
pub mod rng;
pub mod schedule;
pub mod sim;
pub mod standings;
#[doc(hidden)]
pub mod testkit;
pub mod tiebreak;

pub use league::{ConfigError, LeagueConfig, TeamIdx};
pub use playoffs::{home_ice, playoff_bracket, Matchup, PlayoffBracket};
pub use ranking::{better_record, rank_league, sort_teams, Ranking, StandingsScratch};
pub use schedule::{Schedule, ScheduleError, ScheduledGame};
pub use sim::{GameStatus, Metric, SimError, SimInput, SimResult, Simulator};
pub use standings::{EndType, GameResult, SeasonAccumulator, TeamRecord};
pub use tiebreak::{TiebreakChain, TiebreakStep};
