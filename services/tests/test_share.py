from __future__ import annotations

from datetime import UTC, date, datetime

from aftershock.api import schemas as S
from aftershock.share.cards import Projection, team_og, tremor_card, tremor_og

SIX = S.SixWay(home_reg=0.4, home_ot=0.07, home_so=0.04, away_reg=0.38, away_ot=0.07, away_so=0.04)


def tremor() -> S.Tremor:
    return S.Tremor(
        id=1,
        season=20252026,
        game_id=2025020001,
        event_id=5,
        night_date=date(2025, 10, 16),
        team="MTL",
        opponent="NSH",
        home="MTL",
        away="NSH",
        scorer=S.PlayerRef(id=1, name="Cole Caufield & Co"),
        period=3,
        period_type="REG",
        t_period_s=1180,
        t_game_s=3580,
        score_before=S.Score(home=1, away=2),
        score_after=S.Score(home=2, away=2),
        wp_before=SIX,
        wp_after=SIX,
        deltas=[
            S.TeamDelta(
                team="MTL", d_playoffs=0.054, d_division=0.01, d_cup=0.002, p_playoffs_after=0.38
            ),
            S.TeamDelta(
                team="NSH", d_playoffs=-0.026, d_division=0, d_cup=0, p_playoffs_after=0.33
            ),
        ],
        total_shift=0.16,
        magnitude=6.4,
        ppa=0.054,
        cpa=0.002,
        origin=S.Origin(venue="Centre Bell", lat=45.496, lon=-73.569),
        created_at=datetime(2025, 10, 17, 2, tzinfo=UTC),
    )


def team(abbrev: str, lat: float, lon: float) -> S.TeamInfo:
    return S.TeamInfo(
        abbrev=abbrev,
        name=abbrev,
        conference="Eastern",
        division="Atlantic",
        arena="Arena",
        lat=lat,
        lon=lon,
        color_primary="#AF1E2D",
        color_secondary="#192168",
    )


def test_projection_orientation() -> None:
    p = Projection(0, 0, 600, 400)
    van, mtl = p(-123.1, 49.28), p(-73.57, 45.5)
    fla, tor = p(-80.33, 26.16), p(-79.38, 43.64)
    assert van[0] < mtl[0]
    assert fla[1] > tor[1]
    for x, y in (van, mtl, fla, tor):
        assert 0 <= x <= 600 and 0 <= y <= 400
    helsinki = p(24.9, 60.2)
    assert helsinki[0] > 580


def test_cards_are_escaped_svg_with_the_facts() -> None:
    teams = [team("MTL", 45.496, -73.569), team("NSH", 36.159, -86.779)]
    og = tremor_og(tremor(), teams)
    assert og.startswith("<svg") and 'width="1200"' in og and 'height="630"' in og
    assert "6.4" in og and "Cole Caufield &amp; Co" in og and "+5.4 pp" in og
    assert "not affiliated" in og
    card = tremor_card(tremor(), teams)
    assert 'width="1080"' in card and 'height="1350"' in card
    assert chr(0x2014) not in og + card
    t = team_og(teams[0], None)
    assert "Playoff odds" in t
