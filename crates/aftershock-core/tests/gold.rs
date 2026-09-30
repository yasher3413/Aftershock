//! Gold test: replay every real regular-season result of each validated
//! season and require the engine to reproduce the official NHL standings,
//! playoff field, and first-round matchups exactly.

use std::collections::BTreeSet;
use std::io::Read;
use std::path::PathBuf;

use aftershock_core::{
    playoff_bracket, rank_league, EndType, GameResult, LeagueConfig, PlayoffBracket, Schedule,
    SeasonAccumulator, StandingsScratch, TeamIdx,
};
use serde::Deserialize;

/// Seasons validated against official standings (2019-20 and 2020-21 used
/// non-standard formats and are excluded).
const VALIDATED: &[u32] = &[
    20152016, 20162017, 20172018, 20182019, 20212022, 20222023, 20232024, 20242025, 20252026,
];

/// Overtime losses where the loser had pulled its goalkeeper, so the NHL
/// took away its overtime-loss point and recorded a regulation loss. The
/// feed marks these games as plain `OT`, so they are listed here by game id.
///
/// - 2023021166, 2024-03-30, VGK 2 at MIN 1 (OT): Minnesota pulled Filip
///   Gustavsson for an extra attacker in overtime and Jonathan Marchessault
///   scored into the empty net. Official 2023-24 standings: MIN 87 points,
///   34 L, 9 OTL. Sources:
///   <https://www.startribune.com/minnesota-wild-vegas-golden-knights-overtime-empty-net-nhl-filip-gustavsson/600355226>,
///   <https://thehockeynews.com/nhl/minnesota-wild/game-day/wild-fall-2-1-to-vegas-in-overtime-forfeit-point-for-pulling-goalie>.
const OVERTIME_FORFEITS: &[u64] = &[2023021166];

#[derive(Deserialize)]
struct Fixture {
    season: u32,
    tiebreak: String,
    teams: Vec<FixtureTeam>,
    results: Vec<FixtureResult>,
    official: Vec<Official>,
    round1: Vec<[String; 2]>,
}

#[derive(Deserialize)]
struct FixtureTeam {
    abbrev: String,
    conference: String,
    division: String,
}

#[derive(Deserialize)]
struct FixtureResult {
    id: u64,
    date: String,
    home: String,
    away: String,
    home_goals: u8,
    away_goals: u8,
    end: String,
}

#[derive(Deserialize)]
struct Official {
    abbrev: String,
    points: u16,
    gp: u16,
    w: u16,
    l: u16,
    otl: u16,
    rw: u16,
    row: u16,
    gf: u16,
    ga: u16,
    league_seq: u16,
    conference_seq: u16,
    division_seq: u16,
    wildcard_seq: u16,
    clinch: Option<String>,
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn load_fixture(season: u32) -> Option<Fixture> {
    let path = repo_root().join(format!("tests/fixtures/gold/{season}.json.gz"));
    let file = std::fs::File::open(path).ok()?;
    let mut text = String::new();
    flate2::read::GzDecoder::new(file)
        .read_to_string(&mut text)
        .expect("gunzip fixture");
    Some(serde_json::from_str(&text).expect("parse fixture"))
}

fn load_config(season: u32) -> LeagueConfig {
    let y1 = season / 10000;
    let y2 = season % 100;
    let path = repo_root().join(format!("config/leagues/nhl-{y1}-{y2:02}.toml"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path:?}: {e}"));
    LeagueConfig::from_toml_str(&text).expect("valid config")
}

/// Outcome of one season's comparison.
#[derive(Default)]
struct SeasonReport {
    season: u32,
    chain: String,
    teams: usize,
    results: usize,
    records: bool,
    division: bool,
    wildcard: bool,
    conference: bool,
    league: bool,
    playoff_teams: bool,
    round1: bool,
    errors: Vec<String>,
}

fn check_season(fx: &Fixture) -> SeasonReport {
    let cfg = load_config(fx.season);
    let mut rep = SeasonReport {
        season: fx.season,
        chain: fx.tiebreak.clone(),
        teams: fx.teams.len(),
        results: fx.results.len(),
        ..Default::default()
    };
    let err = |rep: &mut SeasonReport, m: String| rep.errors.push(m);

    // Config must agree with the fixture's alignment.
    assert_eq!(cfg.tiebreak.name(), fx.tiebreak, "{} chain", fx.season);
    assert_eq!(cfg.n_teams(), fx.teams.len(), "{} team count", fx.season);
    for t in &fx.teams {
        let i = cfg.team(&t.abbrev).expect("team in config") as usize;
        let d = &cfg.divisions[cfg.team_division[i] as usize];
        assert_eq!(d.name, t.division, "{} {}", fx.season, t.abbrev);
        assert_eq!(cfg.conferences[d.conference as usize].name, t.conference);
    }

    // Schedule in the order games were played: date, then game id.
    let mut games: Vec<&FixtureResult> = fx.results.iter().collect();
    games.sort_by(|a, b| a.date.cmp(&b.date).then(a.id.cmp(&b.id)));
    let pairs: Vec<(TeamIdx, TeamIdx)> = games
        .iter()
        .map(|g| (cfg.team(&g.home).unwrap(), cfg.team(&g.away).unwrap()))
        .collect();
    let schedule = Schedule::new(cfg.n_teams(), &pairs).unwrap();
    let mut acc = SeasonAccumulator::new(&cfg);
    for (i, g) in games.iter().enumerate() {
        let mut end = EndType::from_code(&g.end).expect("end code");
        if OVERTIME_FORFEITS.contains(&g.id) {
            assert_eq!(end, EndType::Overtime, "forfeit game {} not OT", g.id);
            end = EndType::OvertimeForfeit;
        }
        let r = GameResult {
            home_goals: g.home_goals,
            away_goals: g.away_goals,
            end,
        };
        acc.apply_indexed(&schedule, i, &r);
    }

    // Records.
    rep.records = true;
    for o in &fx.official {
        let t = cfg.team(&o.abbrev).unwrap();
        let r = acc.record(t);
        let got = (r.points, r.gp, r.w, r.l, r.otl, r.rw, r.row, r.gf, r.ga);
        let want = (o.points, o.gp, o.w, o.l, o.otl, o.rw, o.row, o.gf, o.ga);
        if got != want {
            rep.records = false;
            err(&mut rep, format!("{} record {got:?} != {want:?}", o.abbrev));
        }
    }

    let mut scratch = StandingsScratch::new(&cfg);
    let ranking = rank_league(&acc, &cfg, &mut scratch).clone();
    let name = |t: TeamIdx| cfg.abbrev(t).to_string();

    // Order within each division, wild-card order, conference and league.
    let official_order = |key: &dyn Fn(&Official) -> bool, seq: &dyn Fn(&Official) -> u16| {
        let mut v: Vec<&Official> = fx.official.iter().filter(|o| key(o)).collect();
        v.sort_by_key(|o| seq(o));
        v.iter().map(|o| o.abbrev.clone()).collect::<Vec<_>>()
    };
    let conf_of = |a: &str| cfg.team_conference[cfg.team(a).unwrap() as usize] as usize;
    let div_of = |a: &str| cfg.team_division[cfg.team(a).unwrap() as usize] as usize;

    rep.division = true;
    for (di, d) in cfg.divisions.iter().enumerate() {
        let want = official_order(&|o| div_of(&o.abbrev) == di, &|o| o.division_seq);
        let got: Vec<String> = ranking.division[di].iter().map(|&t| name(t)).collect();
        if got != want {
            rep.division = false;
            err(&mut rep, format!("{} division {got:?} != {want:?}", d.name));
        }
    }
    rep.wildcard = true;
    rep.conference = true;
    for (ci, c) in cfg.conferences.iter().enumerate() {
        let want = official_order(&|o| conf_of(&o.abbrev) == ci && o.wildcard_seq > 0, &|o| {
            o.wildcard_seq
        });
        let got: Vec<String> = ranking.wildcard[ci].iter().map(|&t| name(t)).collect();
        if got != want {
            rep.wildcard = false;
            err(&mut rep, format!("{} wildcard {got:?} != {want:?}", c.name));
        }
        let want = official_order(&|o| conf_of(&o.abbrev) == ci, &|o| o.conference_seq);
        let got: Vec<String> = ranking.conference[ci].iter().map(|&t| name(t)).collect();
        if got != want {
            rep.conference = false;
            err(
                &mut rep,
                format!("{} conference {got:?} != {want:?}", c.name),
            );
        }
    }
    let want = official_order(&|_| true, &|o| o.league_seq);
    let got: Vec<String> = ranking.league.iter().map(|&t| name(t)).collect();
    rep.league = got == want;
    if !rep.league {
        err(&mut rep, format!("league {got:?} != {want:?}"));
    }

    // Playoff field: the teams appearing in the actual first round.
    let want: BTreeSet<String> = fx.round1.iter().flatten().cloned().collect();
    let got: BTreeSet<String> = (0..cfg.n_teams())
        .filter(|&t| ranking.qualified[t])
        .map(|t| name(t as TeamIdx))
        .collect();
    rep.playoff_teams = got == want && want.len() == 16;
    if !rep.playoff_teams {
        err(&mut rep, format!("playoff teams {got:?} != {want:?}"));
    }
    // Clinch markers agree where present: every playoff team has one of the
    // clinch codes x, y, z, p; eliminated teams have e.
    for o in &fx.official {
        if let Some(c) = o.clinch.as_deref() {
            let q = want.contains(&o.abbrev);
            if q != (c != "e") {
                err(
                    &mut rep,
                    format!("{} clinch {c} vs qualified {q}", o.abbrev),
                );
            }
        }
    }

    let mut bracket = PlayoffBracket::new(&cfg);
    playoff_bracket(&ranking, &acc, &cfg, &mut bracket);
    let got: BTreeSet<(String, String)> = bracket
        .round1
        .iter()
        .map(|m| (name(m.home_ice), name(m.other())))
        .collect();
    let want: BTreeSet<(String, String)> = fx
        .round1
        .iter()
        .map(|[a, b]| (a.clone(), b.clone()))
        .collect();
    rep.round1 = got == want;
    if !rep.round1 {
        err(&mut rep, format!("round1 {got:?} != {want:?}"));
    }
    rep
}

#[test]
fn gold_seasons_match_official_standings() {
    let mut reports = Vec::new();
    let mut missing = Vec::new();
    for &season in VALIDATED {
        match load_fixture(season) {
            Some(fx) => {
                assert_eq!(fx.season, season);
                reports.push(check_season(&fx));
            }
            None => missing.push(season),
        }
    }
    let yn = |b: bool| if b { "yes" } else { "NO" };
    eprintln!("| Season | Chain | Teams | Results fed | Records | Division order | Wild-card order | Conference order | League order | Playoff teams | Round-1 matchups |");
    for r in &reports {
        eprintln!(
            "| {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} |",
            r.season,
            r.chain,
            r.teams,
            r.results,
            yn(r.records),
            yn(r.division),
            yn(r.wildcard),
            yn(r.conference),
            yn(r.league),
            yn(r.playoff_teams),
            yn(r.round1)
        );
    }
    for r in &reports {
        for e in &r.errors {
            eprintln!("{}: {e}", r.season);
        }
    }
    assert!(missing.is_empty(), "missing gold fixtures: {missing:?}");
    assert!(
        reports.iter().all(|r| r.errors.is_empty()),
        "gold mismatches, see stderr"
    );
}
