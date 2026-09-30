//! Named, versioned tiebreak chains.
//!
//! A chain is the ordered list of steps applied to clubs tied in points. The
//! league config selects a chain by name; the steps themselves live here in
//! code so each named chain is fixed and reviewable. See `docs/SIMULATOR.md`
//! for the official text and sources.

/// One step of a tiebreak chain. Every step ranks the larger value first,
/// except [`TiebreakStep::FewerGamesPlayed`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TiebreakStep {
    /// Fewer games played (superior points percentage when points are tied).
    FewerGamesPlayed,
    /// Regulation wins (RW).
    RegulationWins,
    /// Regulation plus overtime wins (ROW): all wins except shootout wins.
    RegulationOvertimeWins,
    /// Total wins in any manner.
    TotalWins,
    /// Head-to-head among the tied clubs, excluding "odd" games. Compared as
    /// the percentage of available points earned in games among the tied
    /// clubs, which for two clubs is equivalent to comparing points.
    HeadToHead,
    /// Goal differential for the whole season (shootout wins count as one
    /// goal for, shootout losses one goal against).
    GoalDifferential,
    /// Goals for, whole season (same shootout rule).
    GoalsFor,
}

/// A named tiebreak chain selected by the league config.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TiebreakChain {
    /// NHL procedure from 2019-20 onward: points percentage, RW, ROW, total
    /// wins, head-to-head, goal differential, goals for.
    Nhl2019,
    /// NHL procedure 2010-11 through 2018-19: points percentage, ROW,
    /// head-to-head, goal differential.
    Nhl2010,
}

const NHL_2019: &[TiebreakStep] = &[
    TiebreakStep::FewerGamesPlayed,
    TiebreakStep::RegulationWins,
    TiebreakStep::RegulationOvertimeWins,
    TiebreakStep::TotalWins,
    TiebreakStep::HeadToHead,
    TiebreakStep::GoalDifferential,
    TiebreakStep::GoalsFor,
];

const NHL_2010: &[TiebreakStep] = &[
    TiebreakStep::FewerGamesPlayed,
    TiebreakStep::RegulationOvertimeWins,
    TiebreakStep::HeadToHead,
    TiebreakStep::GoalDifferential,
];

impl TiebreakChain {
    /// Look up a chain by its config name (`nhl-2019`, `nhl-2010`).
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "nhl-2019" => Some(Self::Nhl2019),
            "nhl-2010" => Some(Self::Nhl2010),
            _ => None,
        }
    }

    /// Config name of the chain.
    pub fn name(self) -> &'static str {
        match self {
            Self::Nhl2019 => "nhl-2019",
            Self::Nhl2010 => "nhl-2010",
        }
    }

    /// The ordered steps of the chain.
    pub fn steps(self) -> &'static [TiebreakStep] {
        match self {
            Self::Nhl2019 => NHL_2019,
            Self::Nhl2010 => NHL_2010,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_round_trip() {
        for c in [TiebreakChain::Nhl2019, TiebreakChain::Nhl2010] {
            assert_eq!(TiebreakChain::from_name(c.name()), Some(c));
        }
        assert_eq!(TiebreakChain::from_name("nhl-2005"), None);
    }

    #[test]
    fn nhl_2010_has_no_rw_step() {
        assert!(!TiebreakChain::Nhl2010
            .steps()
            .contains(&TiebreakStep::RegulationWins));
        assert_eq!(
            TiebreakChain::Nhl2010.steps()[1],
            TiebreakStep::RegulationOvertimeWins
        );
    }
}
