//! Playoff qualification bracket and home ice.
//!
//! Division-wildcard format (NHL since 2013-14), per conference with
//! divisions A and B (config order):
//!
//! ```text
//! side A: A1 vs WC(x)     side B: B1 vs WC(y)
//!         A2 vs A3                B2 vs B3
//! ```
//!
//! The division winner with the better conference standing plays the
//! second wild card (WC2); the other division winner plays WC1. Round 2
//! pairs the two series on each side, the conference final pairs the two
//! sides, and the conference champions meet in the final.
//!
//! Home ice in every series goes to the club with the better
//! regular-season record ([`better_record`]), not the higher seed.

use crate::league::{LeagueConfig, PlayoffFormatKind, TeamIdx};
use crate::ranking::{better_record, Ranking};
use crate::standings::SeasonAccumulator;

/// One playoff series pairing.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Matchup {
    /// Higher bracket seed (division winner, or division 2nd place).
    pub high_seed: TeamIdx,
    /// Lower bracket seed (wild card, or division 3rd place).
    pub low_seed: TeamIdx,
    /// Club with home ice (hosts game 1): the one with the better record.
    pub home_ice: TeamIdx,
}

impl Matchup {
    /// Build a matchup, assigning home ice by record.
    pub fn new(acc: &SeasonAccumulator, cfg: &LeagueConfig, high: TeamIdx, low: TeamIdx) -> Self {
        let (home_ice, _) = home_ice(acc, cfg, high, low);
        Matchup {
            high_seed: high,
            low_seed: low,
            home_ice,
        }
    }

    /// The club without home ice.
    #[inline]
    pub fn other(&self) -> TeamIdx {
        if self.home_ice == self.high_seed {
            self.low_seed
        } else {
            self.high_seed
        }
    }
}

/// First-round bracket for all conferences.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PlayoffBracket {
    /// Four series per conference, conference `c` at `4c..4c + 4`, in
    /// bracket order: `[A1 vs WC, A2 vs A3, B1 vs WC, B2 vs B3]`. Round 2
    /// pairs series `4c` with `4c + 1` and `4c + 2` with `4c + 3`.
    pub round1: Vec<Matchup>,
}

impl PlayoffBracket {
    /// Allocate a bracket sized for `cfg`.
    pub fn new(cfg: &LeagueConfig) -> Self {
        PlayoffBracket {
            round1: vec![Matchup::default(); 4 * cfg.conferences.len()],
        }
    }

    /// Round-1 series of conference `c`, in bracket order.
    pub fn conference(&self, c: usize) -> &[Matchup] {
        &self.round1[4 * c..4 * c + 4]
    }
}

/// Home ice for a series between `a` and `b`: returns `(home, away)` where
/// `home` has the better regular-season record and hosts games marked `H`
/// in the config's home pattern.
#[inline]
pub fn home_ice(
    acc: &SeasonAccumulator,
    cfg: &LeagueConfig,
    a: TeamIdx,
    b: TeamIdx,
) -> (TeamIdx, TeamIdx) {
    if better_record(acc, cfg, b, a) {
        (b, a)
    } else {
        (a, b)
    }
}

/// Fill `out` with the first-round bracket from a ranking produced by
/// [`crate::rank_league`] for the same accumulator. Allocation free.
pub fn playoff_bracket(
    ranking: &Ranking,
    acc: &SeasonAccumulator,
    cfg: &LeagueConfig,
    out: &mut PlayoffBracket,
) {
    match cfg.playoffs.kind {
        PlayoffFormatKind::DivisionWildcard => division_wildcard(ranking, acc, cfg, out),
    }
}

fn division_wildcard(
    ranking: &Ranking,
    acc: &SeasonAccumulator,
    cfg: &LeagueConfig,
    out: &mut PlayoffBracket,
) {
    for (ci, conf) in cfg.conferences.iter().enumerate() {
        let (da, db) = (conf.divisions[0] as usize, conf.divisions[1] as usize);
        let a = &ranking.division[da];
        let b = &ranking.division[db];
        let wc = &ranking.wildcard[ci];
        let (wc1, wc2) = (wc[0], wc[1]);
        // The division winner higher in the conference standings meets WC2.
        let a_first =
            ranking.conference_rank[a[0] as usize] < ranking.conference_rank[b[0] as usize];
        let (wc_a, wc_b) = if a_first { (wc2, wc1) } else { (wc1, wc2) };
        let s = &mut out.round1[4 * ci..4 * ci + 4];
        s[0] = Matchup::new(acc, cfg, a[0], wc_a);
        s[1] = Matchup::new(acc, cfg, a[1], a[2]);
        s[2] = Matchup::new(acc, cfg, b[0], wc_b);
        s[3] = Matchup::new(acc, cfg, b[1], b[2]);
    }
}

/// Whether the club with home ice hosts game `game` (0-based) of a series.
#[inline]
pub fn home_ice_team_hosts(cfg: &LeagueConfig, game: usize) -> bool {
    cfg.playoffs.home_pattern[game]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ranking::{rank_league, StandingsScratch};

    /// 20-team league: four divisions of five, so each conference has four
    /// wild-card candidates for two spots.
    fn cfg16() -> LeagueConfig {
        let mut teams = String::new();
        for i in 0..20 {
            teams.push_str(&format!("\"T{i}\","));
        }
        let div = |name: &str, lo: usize| {
            let t: Vec<String> = (lo..lo + 5).map(|i| format!("\"T{i}\"")).collect();
            format!(
                "[[divisions]]\nname = \"{name}\"\nteams = [{}]\n",
                t.join(",")
            )
        };
        let text = format!(
            "name = \"t\"\nseason = 1\ngames_per_team = 82\ntiebreak = \"nhl-2019\"\n\
             teams = [{teams}]\n[points]\nwin = 2\notl = 1\n[overtime]\not_minutes = 5\n\
             shootout = true\n[playoffs]\nformat = \"division-wildcard\"\ndivision_top = 3\n\
             wildcards_per_conference = 2\nseries_length = 7\nhome_pattern = \"HHAAHAH\"\n\
             [[conferences]]\nname = \"E\"\ndivisions = [\"A\", \"B\"]\n\
             [[conferences]]\nname = \"W\"\ndivisions = [\"C\", \"D\"]\n{}{}{}{}",
            div("A", 0),
            div("B", 5),
            div("C", 10),
            div("D", 15)
        );
        LeagueConfig::from_toml_str(&text).unwrap()
    }

    fn with_points(cfg: &LeagueConfig, pts: &[u16]) -> SeasonAccumulator {
        let mut acc = SeasonAccumulator::new(cfg);
        for (t, &p) in pts.iter().enumerate() {
            acc.points[t] = p;
            acc.gp[t] = 82;
        }
        acc
    }

    #[test]
    fn better_division_winner_plays_second_wildcard() {
        let cfg = cfg16();
        // East: A = T0..T4, B = T5..T9. B's winner (T5, 110) beats A's
        // winner (T0, 100) in the standings. Wild cards: T3 (95) is WC1,
        // T8 (90) is WC2.
        #[rustfmt::skip]
        let pts = [
            100, 99, 98, 95, 50,
            110, 97, 96, 90, 60,
            100, 99, 98, 95, 50,
            100, 99, 98, 95, 50,
        ];
        let acc = with_points(&cfg, &pts);
        let mut scratch = StandingsScratch::new(&cfg);
        let r = rank_league(&acc, &cfg, &mut scratch).clone();
        assert_eq!(r.wildcard[0][..2], [3, 8]);
        let mut b = PlayoffBracket::new(&cfg);
        playoff_bracket(&r, &acc, &cfg, &mut b);
        let e = b.conference(0);
        assert_eq!((e[0].high_seed, e[0].low_seed), (0, 3)); // A1 vs WC1
        assert_eq!((e[1].high_seed, e[1].low_seed), (1, 2));
        assert_eq!((e[2].high_seed, e[2].low_seed), (5, 8)); // B1 vs WC2
        assert_eq!((e[3].high_seed, e[3].low_seed), (6, 7));
        let qualified: Vec<usize> = (0..10).filter(|&t| r.qualified[t]).collect();
        assert_eq!(qualified, vec![0, 1, 2, 3, 5, 6, 7, 8]);
    }

    #[test]
    fn home_ice_goes_to_better_record_not_seed() {
        let cfg = cfg16();
        // Division A is weak: its winner T0 has 90 points, while wild card
        // T8 from division B has 101. T0 plays a wild card with more points.
        #[rustfmt::skip]
        let pts = [
            90, 85, 84, 70, 60,
            110, 105, 102, 101, 60,
            100, 99, 98, 95, 50,
            100, 99, 98, 95, 50,
        ];
        let acc = with_points(&cfg, &pts);
        let mut scratch = StandingsScratch::new(&cfg);
        let r = rank_league(&acc, &cfg, &mut scratch).clone();
        let mut b = PlayoffBracket::new(&cfg);
        playoff_bracket(&r, &acc, &cfg, &mut b);
        let e = b.conference(0);
        // B1 (T5) is the better division winner and meets WC2; T8 (101) is
        // WC1 and crosses over to meet A1 (T0, 90).
        assert_eq!((e[0].high_seed, e[0].low_seed), (0, 8));
        assert_eq!(e[0].home_ice, 8);
        assert_eq!(e[0].other(), 0);
        assert_eq!(e[2].home_ice, 5);
        assert_eq!(home_ice(&acc, &cfg, 0, 8), (8, 0));
    }

    #[test]
    fn home_ice_tie_uses_chain() {
        let cfg = cfg16();
        let mut acc = with_points(&cfg, &[100; 20]);
        acc.rw[3] = 40;
        acc.rw[1] = 30;
        assert_eq!(home_ice(&acc, &cfg, 1, 3), (3, 1));
        assert!(home_ice_team_hosts(&cfg, 0));
        assert!(!home_ice_team_hosts(&cfg, 2));
        assert!(home_ice_team_hosts(&cfg, 6));
    }
}
