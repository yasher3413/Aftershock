/** The league's 32 clubs by division, as aligned in config/leagues/nhl-2026-27.toml.
 * Kept here so the footer and search can list every team before any data loads. */
export const DIVISIONS = [
  {
    name: "Atlantic",
    conference: "Eastern",
    teams: [
      ["BOS", "Boston Bruins"],
      ["BUF", "Buffalo Sabres"],
      ["DET", "Detroit Red Wings"],
      ["FLA", "Florida Panthers"],
      ["MTL", "Montreal Canadiens"],
      ["OTT", "Ottawa Senators"],
      ["TBL", "Tampa Bay Lightning"],
      ["TOR", "Toronto Maple Leafs"],
    ],
  },
  {
    name: "Metropolitan",
    conference: "Eastern",
    teams: [
      ["CAR", "Carolina Hurricanes"],
      ["CBJ", "Columbus Blue Jackets"],
      ["NJD", "New Jersey Devils"],
      ["NYI", "New York Islanders"],
      ["NYR", "New York Rangers"],
      ["PHI", "Philadelphia Flyers"],
      ["PIT", "Pittsburgh Penguins"],
      ["WSH", "Washington Capitals"],
    ],
  },
  {
    name: "Central",
    conference: "Western",
    teams: [
      ["CHI", "Chicago Blackhawks"],
      ["COL", "Colorado Avalanche"],
      ["DAL", "Dallas Stars"],
      ["MIN", "Minnesota Wild"],
      ["NSH", "Nashville Predators"],
      ["STL", "St. Louis Blues"],
      ["UTA", "Utah Mammoth"],
      ["WPG", "Winnipeg Jets"],
    ],
  },
  {
    name: "Pacific",
    conference: "Western",
    teams: [
      ["ANA", "Anaheim Ducks"],
      ["CGY", "Calgary Flames"],
      ["EDM", "Edmonton Oilers"],
      ["LAK", "Los Angeles Kings"],
      ["SEA", "Seattle Kraken"],
      ["SJS", "San Jose Sharks"],
      ["VAN", "Vancouver Canucks"],
      ["VGK", "Vegas Golden Knights"],
    ],
  },
] as const;

export const TEAMS = DIVISIONS.flatMap((d) =>
  d.teams.map(([abbrev, name]) => ({ abbrev, name, division: d.name })),
);
