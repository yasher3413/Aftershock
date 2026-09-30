//! Aftershock core: league rules, standings, tiebreakers, and Monte Carlo
//! season simulation.

pub mod league;
pub mod rng;
pub mod tiebreak;

pub use league::{ConfigError, LeagueConfig, TeamIdx};
pub use tiebreak::{TiebreakChain, TiebreakStep};
