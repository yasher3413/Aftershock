//! League rules as data.
//!
//! A [`LeagueConfig`] is parsed from a TOML file in `config/leagues/`. It
//! names the teams, conferences, divisions, points system, overtime format,
//! playoff format, and the tiebreak chain. Realignment or expansion is a
//! config change: nothing in the engine hard-codes a team or a division.
//!
//! Teams are addressed by a dense index (`u16`), which is the position of the
//! abbreviation in the config `teams` list.

use serde::Deserialize;
use std::collections::HashMap;

use crate::tiebreak::TiebreakChain;

/// Dense team index: position of the team in [`LeagueConfig::teams`].
pub type TeamIdx = u16;

/// Errors raised while loading or validating a league config.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// The TOML text did not parse or did not match the schema.
    #[error("invalid league TOML: {0}")]
    Toml(#[from] toml::de::Error),
    /// The config parsed but is internally inconsistent.
    #[error("invalid league config: {0}")]
    Invalid(String),
}

/// Points awarded per game outcome.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PointsSystem {
    /// Points for any win (regulation, overtime, or shootout).
    pub win: u16,
    /// Points for an overtime or shootout loss.
    pub otl: u16,
    /// Points for a regulation loss.
    #[serde(default)]
    pub loss: u16,
}

/// Regular-season overtime format.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct OvertimeFormat {
    /// Length of the sudden-death overtime period in minutes.
    pub ot_minutes: u8,
    /// Skaters per side in overtime (3 means 3-on-3).
    #[serde(default = "default_ot_skaters")]
    pub ot_skaters: u8,
    /// Whether a shootout follows a scoreless overtime.
    pub shootout: bool,
}

fn default_ot_skaters() -> u8 {
    3
}

/// Playoff qualification and bracket shape.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PlayoffFormatKind {
    /// NHL format since 2013-14: top N of each division plus wild cards,
    /// bracketed within the conference. Requires two divisions per
    /// conference.
    DivisionWildcard,
}

/// Playoff format.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlayoffFormat {
    /// Bracket shape.
    pub kind: PlayoffFormatKind,
    /// Number of automatic qualifiers per division.
    pub division_top: u8,
    /// Number of wild cards per conference.
    pub wildcards_per_conference: u8,
    /// Best-of length of every series.
    pub series_length: u8,
    /// Per game of a series: `true` when the team with home ice hosts.
    pub home_pattern: Vec<bool>,
}

/// A conference: a name and the indices of its divisions.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Conference {
    /// Display name, e.g. `Eastern`.
    pub name: String,
    /// Indices into [`LeagueConfig::divisions`].
    pub divisions: Vec<u16>,
    /// Member teams (union of the divisions), in config order.
    pub teams: Vec<TeamIdx>,
}

/// A division: a name, its conference, and member teams.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Division {
    /// Display name, e.g. `Atlantic`.
    pub name: String,
    /// Index into [`LeagueConfig::conferences`].
    pub conference: u16,
    /// Member teams.
    pub teams: Vec<TeamIdx>,
}

/// A validated league definition for one season.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LeagueConfig {
    /// Display name, e.g. `NHL 2025-26`.
    pub name: String,
    /// Season id, e.g. `20252026`.
    pub season: u32,
    /// Regular-season games per team.
    pub games_per_team: u16,
    /// Team abbreviations; the position is the [`TeamIdx`].
    pub teams: Vec<String>,
    /// Conferences in config order.
    pub conferences: Vec<Conference>,
    /// Divisions in config order.
    pub divisions: Vec<Division>,
    /// Points system.
    pub points: PointsSystem,
    /// Overtime format.
    pub overtime: OvertimeFormat,
    /// Playoff format.
    pub playoffs: PlayoffFormat,
    /// Named tiebreak chain.
    pub tiebreak: TiebreakChain,
    /// Division index of each team.
    pub team_division: Vec<u16>,
    /// Conference index of each team.
    pub team_conference: Vec<u16>,
    index: HashMap<String, TeamIdx>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawConfig {
    name: String,
    season: u32,
    games_per_team: u16,
    tiebreak: String,
    teams: Vec<String>,
    points: PointsSystem,
    overtime: OvertimeFormat,
    playoffs: RawPlayoffs,
    conferences: Vec<RawConference>,
    divisions: Vec<RawDivision>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawPlayoffs {
    format: PlayoffFormatKind,
    division_top: u8,
    wildcards_per_conference: u8,
    series_length: u8,
    home_pattern: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawConference {
    name: String,
    divisions: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawDivision {
    name: String,
    teams: Vec<String>,
}

fn invalid<T>(msg: impl Into<String>) -> Result<T, ConfigError> {
    Err(ConfigError::Invalid(msg.into()))
}

impl LeagueConfig {
    /// Parse and validate a league config from TOML text.
    pub fn from_toml_str(text: &str) -> Result<Self, ConfigError> {
        let raw: RawConfig = toml::from_str(text)?;
        Self::from_raw(raw)
    }

    fn from_raw(raw: RawConfig) -> Result<Self, ConfigError> {
        let n = raw.teams.len();
        if n < 2 || n > u16::MAX as usize {
            return invalid(format!("bad team count {n}"));
        }
        let mut index = HashMap::with_capacity(n);
        for (i, t) in raw.teams.iter().enumerate() {
            if index.insert(t.clone(), i as TeamIdx).is_some() {
                return invalid(format!("duplicate team {t}"));
            }
        }
        let tiebreak = TiebreakChain::from_name(&raw.tiebreak)
            .ok_or_else(|| ConfigError::Invalid(format!("unknown tiebreak {}", raw.tiebreak)))?;

        let mut div_index = HashMap::new();
        for (i, d) in raw.divisions.iter().enumerate() {
            if div_index.insert(d.name.clone(), i as u16).is_some() {
                return invalid(format!("duplicate division {}", d.name));
            }
        }

        const UNSET: u16 = u16::MAX;
        let mut team_division = vec![UNSET; n];
        let mut team_conference = vec![UNSET; n];
        let mut division_conf = vec![UNSET; raw.divisions.len()];
        let mut conferences = Vec::with_capacity(raw.conferences.len());
        for (ci, c) in raw.conferences.iter().enumerate() {
            let mut divs = Vec::new();
            for dn in &c.divisions {
                let Some(&di) = div_index.get(dn) else {
                    return invalid(format!("conference {} names unknown division {dn}", c.name));
                };
                if division_conf[di as usize] != UNSET {
                    return invalid(format!("division {dn} is in two conferences"));
                }
                division_conf[di as usize] = ci as u16;
                divs.push(di);
            }
            conferences.push(Conference {
                name: c.name.clone(),
                divisions: divs,
                teams: Vec::new(),
            });
        }

        let mut divisions = Vec::with_capacity(raw.divisions.len());
        for (di, d) in raw.divisions.iter().enumerate() {
            let conf = division_conf[di];
            if conf == UNSET {
                return invalid(format!("division {} is in no conference", d.name));
            }
            let mut teams = Vec::with_capacity(d.teams.len());
            for tn in &d.teams {
                let Some(&t) = index.get(tn) else {
                    return invalid(format!("division {} names unknown team {tn}", d.name));
                };
                if team_division[t as usize] != UNSET {
                    return invalid(format!("team {tn} is in two divisions"));
                }
                team_division[t as usize] = di as u16;
                team_conference[t as usize] = conf;
                teams.push(t);
            }
            divisions.push(Division {
                name: d.name.clone(),
                conference: conf,
                teams,
            });
        }
        if let Some(t) = team_division.iter().position(|&d| d == UNSET) {
            return invalid(format!("team {} is in no division", raw.teams[t]));
        }
        for t in 0..n {
            conferences[team_conference[t] as usize]
                .teams
                .push(t as TeamIdx);
        }

        let p = &raw.playoffs;
        let home_pattern: Vec<bool> = p
            .home_pattern
            .chars()
            .map(|c| match c {
                'H' | 'h' => Ok(true),
                'A' | 'a' => Ok(false),
                _ => Err(ConfigError::Invalid(format!("bad home_pattern char {c:?}"))),
            })
            .collect::<Result<_, _>>()?;
        if home_pattern.len() != p.series_length as usize {
            return invalid("home_pattern length must equal series_length");
        }
        if p.series_length.is_multiple_of(2) {
            return invalid("series_length must be odd");
        }
        match p.format {
            PlayoffFormatKind::DivisionWildcard => {
                // The bracket is defined for 2 divisions per conference,
                // top 3 per division, and 2 wild cards: 8 teams per
                // conference, each division winner meeting one wild card.
                if p.division_top != 3 || p.wildcards_per_conference != 2 {
                    return invalid("division-wildcard needs division_top = 3 and 2 wildcards");
                }
                if conferences.len() != 2 {
                    return invalid("division-wildcard needs exactly 2 conferences");
                }
                for c in &conferences {
                    if c.divisions.len() != 2 {
                        return invalid(format!(
                            "division-wildcard needs 2 divisions in conference {}",
                            c.name
                        ));
                    }
                }
                for d in &divisions {
                    if d.teams.len() < p.division_top as usize {
                        return invalid(format!("division {} is too small", d.name));
                    }
                }
            }
        }
        if raw.points.win <= raw.points.otl || raw.points.otl < raw.points.loss {
            return invalid("points must satisfy win > otl >= loss");
        }

        Ok(LeagueConfig {
            name: raw.name,
            season: raw.season,
            games_per_team: raw.games_per_team,
            teams: raw.teams,
            conferences,
            divisions,
            points: raw.points,
            overtime: raw.overtime,
            playoffs: PlayoffFormat {
                kind: p.format,
                division_top: p.division_top,
                wildcards_per_conference: p.wildcards_per_conference,
                series_length: p.series_length,
                home_pattern,
            },
            tiebreak,
            team_division,
            team_conference,
            index,
        })
    }

    /// Number of teams.
    #[inline]
    pub fn n_teams(&self) -> usize {
        self.teams.len()
    }

    /// Look up a team index by abbreviation.
    pub fn team(&self, abbrev: &str) -> Option<TeamIdx> {
        self.index.get(abbrev).copied()
    }

    /// Abbreviation of a team index.
    #[inline]
    pub fn abbrev(&self, t: TeamIdx) -> &str {
        &self.teams[t as usize]
    }

    /// Total regular-season games in the league.
    pub fn total_games(&self) -> usize {
        self.n_teams() * self.games_per_team as usize / 2
    }
}

/// League configs shipped with the crate, keyed by file stem
/// (e.g. `nhl-2025-26`). Embedded at compile time so they work on wasm32.
pub const BUILTIN_CONFIGS: &[(&str, &str)] = &[
    (
        "nhl-2024-25",
        include_str!("../../../config/leagues/nhl-2024-25.toml"),
    ),
    (
        "nhl-2025-26",
        include_str!("../../../config/leagues/nhl-2025-26.toml"),
    ),
    (
        "nhl-2026-27",
        include_str!("../../../config/leagues/nhl-2026-27.toml"),
    ),
];

impl LeagueConfig {
    /// Load an embedded config by file stem, e.g. `nhl-2026-27`.
    pub fn builtin(name: &str) -> Result<Self, ConfigError> {
        match BUILTIN_CONFIGS.iter().find(|(k, _)| *k == name) {
            Some((_, text)) => Self::from_toml_str(text),
            None => invalid(format!("no builtin league config {name}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_2026() -> &'static str {
        BUILTIN_CONFIGS
            .iter()
            .find(|(k, _)| *k == "nhl-2026-27")
            .unwrap()
            .1
    }

    #[test]
    fn all_builtin_configs_load() {
        for (name, _) in BUILTIN_CONFIGS {
            let cfg = LeagueConfig::builtin(name).unwrap();
            assert_eq!(cfg.conferences.len(), 2, "{name}");
            let n: usize = cfg.divisions.iter().map(|d| d.teams.len()).sum();
            assert_eq!(n, cfg.n_teams(), "{name}");
        }
    }

    #[test]
    fn season_2026_27_alignment() {
        let cfg = LeagueConfig::builtin("nhl-2026-27").unwrap();
        assert_eq!(cfg.n_teams(), 32);
        assert_eq!(cfg.games_per_team, 84);
        assert_eq!(cfg.total_games(), 1344);
        assert_eq!(cfg.tiebreak, TiebreakChain::Nhl2019);
        let uta = cfg.team("UTA").unwrap();
        let d = &cfg.divisions[cfg.team_division[uta as usize] as usize];
        assert_eq!(d.name, "Central");
        assert_eq!(cfg.conferences[d.conference as usize].name, "Western");
        assert_eq!(
            cfg.playoffs.home_pattern,
            vec![true, true, false, false, true, false, true]
        );
    }

    #[test]
    fn rejects_team_in_two_divisions() {
        let bad = text_2026().replace("\"CAR\", \"CBJ\"", "\"BOS\", \"CBJ\"");
        assert!(LeagueConfig::from_toml_str(&bad).is_err());
    }

    #[test]
    fn rejects_unknown_chain() {
        let bad = text_2026().replace("tiebreak = \"nhl-2019\"", "tiebreak = \"nhl-1999\"");
        assert!(LeagueConfig::from_toml_str(&bad).is_err());
    }
}
