from __future__ import annotations

from typing import Any

from aftershock.api import schemas as S
from aftershock.bot.text import (
    TEAM_VOICE,
    alt_text,
    compose,
    context_clause,
    correction,
    moment,
    x_length,
)
from tests.test_share import tremor


# tremor() has no goalie, which would read as an empty net; give the base one.
def base(**kw: Any) -> S.Tremor:
    return tremor().model_copy(update={"goalie": S.PlayerRef(id=7, name="Juuse Saros"), **kw})


def test_moment_rules() -> None:
    t = base()  # ties it late
    assert moment(t) == "ties it 2-2"
    late_go_ahead = t.model_copy(
        update={"score_before": S.Score(home=2, away=2), "score_after": S.Score(home=3, away=2)}
    )
    assert moment(late_go_ahead) == "breaks a 2-2 tie with 20 seconds left"
    early = late_go_ahead.model_copy(update={"t_period_s": 300})
    assert moment(early) == "puts the Canadiens ahead 3-2"
    two_min = late_go_ahead.model_copy(update={"t_period_s": 20 * 60 - 192})
    assert moment(two_min) == "breaks a 2-2 tie with 3:12 left"
    assert moment(t.model_copy(update={"period_type": "OT", "period": 4})) == "wins it in overtime"
    assert (
        moment(t.model_copy(update={"shootout": True, "period_type": "SO"}))
        == "wins it in the shootout"
    )
    first = t.model_copy(
        update={"score_before": S.Score(home=0, away=0), "score_after": S.Score(home=1, away=0)}
    )
    assert moment(first) == "opens the scoring"
    lead = t.model_copy(
        update={"score_before": S.Score(home=3, away=1), "score_after": S.Score(home=4, away=1)}
    )
    assert moment(lead) == "makes it 4-1"
    cut = t.model_copy(
        update={"score_before": S.Score(home=1, away=3), "score_after": S.Score(home=2, away=3)}
    )
    assert moment(cut) == "cuts it to 3-2"
    en = lead.model_copy(update={"goalie": None})
    assert moment(en) == "makes it 4-1 into the empty net"


def test_compose_matches_agreed_shape() -> None:
    t = base().model_copy(
        update={
            "assists": [
                S.PlayerRef(id=2, name="Nick Suzuki"),
                S.PlayerRef(id=3, name="Lane Hutson"),
            ]
        }
    )
    assert compose(t, "the biggest goal of the night") == (
        "🚨 Cole Caufield & Co ties it 2-2\n"
        "NSH 2, MTL 2 · 3rd period\n"
        "Magnitude 6.4, the biggest goal of the night\n\n"
        "Playoff odds\n"
        "Canadiens: 32.6% → 38.0%\n"
        "Predators: 35.6% → 33.0%\n\n"
        "Assists: Suzuki, Hutson\n"
        "#GoHabsGo #Preds"
    )


def test_compose_shootout_shows_final_score() -> None:
    t = base().model_copy(
        update={"shootout": True, "period_type": "SO", "score_after": S.Score(home=2, away=2)}
    )
    assert "NSH 2, MTL 3 · SO" in compose(t, None)


def test_compose_budget_and_missing_parts() -> None:
    long = base().model_copy(
        update={
            "scorer": S.PlayerRef(id=9, name="X" * 120),
            "assists": [S.PlayerRef(id=2, name="Y" * 60), S.PlayerRef(id=3, name="Z" * 60)],
        }
    )
    text = compose(long, "the 2nd-biggest goal of the season")
    assert x_length(text) <= 280 and "season" not in text and "Assists" not in text
    bare = base().model_copy(update={"scorer": None, "assists": []})
    assert compose(bare, None).startswith("🚨 Canadiens goal ties it 2-2")
    assert "Assists" not in compose(bare, None)


def test_x_counts_arrows_and_emoji_twice() -> None:
    # X weighs characters outside its light ranges (arrows, emoji) as two.
    assert x_length("abc") == 3
    assert x_length("a → b") == 6
    assert x_length("🚨 x") == 4
    assert x_length("NSH 2 · SO") == 10


def test_context_clause() -> None:
    assert context_clause(6.0, [5.0, 4.0], None) == "the biggest goal of the night"
    assert context_clause(6.0, [5.0], None) is None  # fewer than 3 goals tonight incl. this one
    assert context_clause(6.0, [6.5, 4.0], None) is None
    assert context_clause(6.0, [5.0, 4.0], 2) == "the 2nd-biggest goal of the season"
    assert context_clause(6.0, [5.0, 4.0], 1) == "the biggest goal of the season"
    assert context_clause(6.0, [5.0, 4.0], 4) == "the biggest goal of the night"


def test_correction_and_alt_text() -> None:
    assert (
        correction({"scorer": S.PlayerRef(id=5, name="Morgan Rielly")}, {"scorer": "Troy Stecher"})
        == "Correction: goal now credited to Morgan Rielly (from Troy Stecher)."
    )
    assert (
        correction(
            {"assist1": S.PlayerRef(id=6, name="Brandon Duhaime"), "assist2": None},
            {"assist1": "Morgan Rielly", "assist2": "John Tavares"},
        )
        == "Correction: assists now Duhaime."
    )
    assert (
        alt_text(base())
        == "Magnitude 6.4 goal by Cole Caufield & Co. Canadiens playoff odds +5.4 points, "
        "Predators −2.6."
    )


def test_clock_and_goalie_corrections_say_nothing() -> None:
    assert correction({"t_period_s": 1182, "t_game_s": 3582}, {"scorer": "A B"}) == ""
    assert correction({"goalie": {"id": 1, "name": "C D"}}, {}) == ""


def test_every_team_has_a_voice() -> None:
    assert len(TEAM_VOICE) == 32 and all(tag.startswith("#") for _, tag in TEAM_VOICE.values())
