"""The goal bot's words: fixed rules over a goal's own data, nothing invented.

See docs/superpowers/specs/2026-10-23-goal-bot-design.md for the agreed shape
of a post.
"""

from __future__ import annotations

from typing import Any

from aftershock.api import schemas as S

MAX_LENGTH = 280

# Nickname for text, and the club's own hashtag (2026-27, one per team).
TEAM_VOICE: dict[str, tuple[str, str]] = {
    "ANA": ("Ducks", "#FlyTogether"),
    "BOS": ("Bruins", "#NHLBruins"),
    "BUF": ("Sabres", "#LetsGoBuffalo"),
    "CAR": ("Hurricanes", "#CarolinaCulture"),
    "CBJ": ("Blue Jackets", "#CBJ"),
    "CGY": ("Flames", "#Flames"),
    "CHI": ("Blackhawks", "#Blackhawks"),
    "COL": ("Avalanche", "#GoAvsGo"),
    "DAL": ("Stars", "#TexasHockey"),
    "DET": ("Red Wings", "#LGRW"),
    "EDM": ("Oilers", "#LetsGoOilers"),
    "FLA": ("Panthers", "#FlaPanthers"),
    "LAK": ("Kings", "#GoKingsGo"),
    "MIN": ("Wild", "#MNWild"),
    "MTL": ("Canadiens", "#GoHabsGo"),
    "NJD": ("Devils", "#NJDevils"),
    "NSH": ("Predators", "#Preds"),
    "NYI": ("Islanders", "#Isles"),
    "NYR": ("Rangers", "#NYR"),
    "OTT": ("Senators", "#GoSensGo"),
    "PHI": ("Flyers", "#LetsGoFlyers"),
    "PIT": ("Penguins", "#LetsGoPens"),
    "SEA": ("Kraken", "#SeaKraken"),
    "SJS": ("Sharks", "#SJSharks"),
    "STL": ("Blues", "#STLBlues"),
    "TBL": ("Lightning", "#GoBolts"),
    "TOR": ("Leafs", "#Leafs"),
    "UTA": ("Mammoth", "#TusksUp"),
    "VAN": ("Canucks", "#Canucks"),
    "VGK": ("Golden Knights", "#VegasBorn"),
    "WPG": ("Jets", "#GoJetsGo"),
    "WSH": ("Capitals", "#ALLCAPS"),
}

# X counts these code points as one character and everything else (arrows,
# emoji, most non-Latin scripts) as two (twitter-text, version 3).
_LIGHT = ((0, 4351), (8192, 8205), (8208, 8223), (8242, 8247))


def x_length(text: str) -> int:
    n = 0
    for ch in text:
        cp = ord(ch)
        if cp == 0xFE0F:  # emoji presentation selector, part of the emoji before it
            continue
        n += 1 if any(lo <= cp <= hi for lo, hi in _LIGHT) else 2
    return n


def nickname(team: str) -> str:
    return TEAM_VOICE.get(team, (team, ""))[0]


def _scores(t: S.Tremor, score: S.Score) -> tuple[int, int]:
    """(scoring team, other team)."""
    return (score.home, score.away) if t.team == t.home else (score.away, score.home)


def _pair(a: int, b: int) -> str:
    return f"{max(a, b)}-{min(a, b)}"


def _left(seconds: int) -> str:
    return f"{seconds} seconds" if seconds < 60 else f"{seconds // 60}:{seconds % 60:02d}"


def moment(t: S.Tremor) -> str:
    if t.shootout:
        return "wins it in the shootout"
    if t.period_type == "OT":
        return "wins it in overtime"
    us_before, them_before = _scores(t, t.score_before)
    us, them = _scores(t, t.score_after)
    left = 20 * 60 - t.t_period_s
    # A goal at 0-0 opens the scoring even late: "breaks a 0-0 tie" reads oddly.
    if us_before == them_before == 0:
        phrase = "opens the scoring"
    elif us_before == them_before and t.period == 3 and left <= 300:
        phrase = f"breaks a {us_before}-{them_before} tie with {_left(left)} left"
    elif us == them:
        phrase = f"ties it {us}-{them}"
    elif us_before == them_before:
        phrase = f"puts the {nickname(t.team)} ahead {_pair(us, them)}"
    elif us_before > them_before:
        phrase = f"makes it {_pair(us, them)}"
    else:
        phrase = f"cuts it to {_pair(us, them)}"
    if t.goalie is None:
        phrase += " into the empty net"
    return phrase


def _period(t: S.Tremor) -> str:
    if t.shootout or t.period_type == "SO":
        return "SO"
    if t.period_type == "OT":
        n = t.period - 3
        return "OT" if n <= 1 else f"{n}OT"
    return {1: "1st period", 2: "2nd period", 3: "3rd period"}.get(t.period, f"Period {t.period}")


def _ordinal(rank: int) -> str:
    return "biggest" if rank == 1 else {2: "2nd-biggest", 3: "3rd-biggest"}[rank]


def context_clause(
    magnitude: float, night_mags: list[float], season_rank: int | None
) -> str | None:
    """``night_mags`` are tonight's earlier goals; ``season_rank`` is this
    goal's rank by magnitude this season."""
    if season_rank is not None and season_rank <= 3:
        return f"the {_ordinal(season_rank)} goal of the season"
    if len(night_mags) + 1 >= 3 and all(m <= magnitude for m in night_mags):
        return "the biggest goal of the night"
    return None


def _last(name: str) -> str:
    return name.split(" ", 1)[1] if " " in name else name


def _odds_line(t: S.Tremor, team: str) -> str | None:
    d = next((d for d in t.deltas if d.team == team), None)
    if d is None:
        return None
    before = d.p_playoffs_after - d.d_playoffs
    return f"{nickname(team)}: {before * 100:.1f}% → {d.p_playoffs_after * 100:.1f}%"


def compose(t: S.Tremor, context: str | None) -> str:
    who = t.scorer.name if t.scorer else f"{nickname(t.team)} goal"
    home, away = t.score_after.home, t.score_after.away
    if t.shootout and home == away:
        # The NHL gives the shootout winner one more goal in the final score.
        home, away = (home + 1, away) if t.team == t.home else (home, away + 1)
    head = [
        f"🚨 {who} {moment(t)}",
        f"{t.away} {away}, {t.home} {home} · {_period(t)}",
    ]
    odds = [x for x in (_odds_line(t, t.team), _odds_line(t, t.opponent)) if x]
    assists = f"Assists: {', '.join(_last(a.name) for a in t.assists)}" if t.assists else None
    tags = " ".join(TEAM_VOICE[x][1] for x in (t.team, t.opponent) if x in TEAM_VOICE)

    def build(with_context: bool, with_assists: bool) -> str:
        mag = f"Magnitude {t.magnitude:.1f}"
        if with_context and context:
            mag += f", {context}"
        blocks = ["\n".join([*head, mag])]
        if odds:
            blocks.append("\n".join(["Playoff odds", *odds]))
        tail = [x for x in (assists if with_assists else None, tags) if x]
        if tail:
            blocks.append("\n".join(tail))
        return "\n\n".join(blocks)

    for with_context, with_assists in ((True, True), (False, True), (False, False)):
        text = build(with_context, with_assists)
        if x_length(text) <= MAX_LENGTH:
            return text
    return text[:MAX_LENGTH]


CREDIT_KEYS = ("scorer", "assist1", "assist2")


def correction(changes: dict[str, Any], before: dict[str, str | None]) -> str:
    """A one-line reply for changed credit; empty when nothing posted changed
    (a goalie or clock correction). ``changes`` values are player refs or
    None, ``before`` holds the names as posted."""

    def name(v: Any) -> str | None:
        if v is None:
            return None
        return str(v.name if isinstance(v, S.PlayerRef) else v.get("name"))

    parts = []
    if "scorer" in changes:
        new = name(changes["scorer"])
        old = before.get("scorer")
        if new and new != old:
            parts.append(f"goal now credited to {new}" + (f" (from {old})" if old else ""))
    if "assist1" in changes or "assist2" in changes:
        merged = [
            name(changes[k]) if k in changes else before.get(k) for k in ("assist1", "assist2")
        ]
        names = [_last(n) for n in merged if n]
        parts.append(f"assists now {', '.join(names)}" if names else "now unassisted")
    if not parts:
        return ""
    return "Correction: " + "; ".join(parts) + "."


def _points(d: float) -> str:
    v = d * 100
    return f"{'+' if v >= 0 else '−'}{abs(v):.1f}"


def alt_text(t: S.Tremor) -> str:
    who = t.scorer.name if t.scorer else f"a {nickname(t.team)} player"
    deltas = {d.team: d.d_playoffs for d in t.deltas}
    teams = [x for x in (t.team, t.opponent) if x in deltas]
    parts = [
        f"{nickname(team)} playoff odds {_points(deltas[team])} points"
        if i == 0
        else f"{nickname(team)} {_points(deltas[team])}"
        for i, team in enumerate(teams)
    ]
    return f"Magnitude {t.magnitude:.1f} goal by {who}. " + ", ".join(parts) + "."
