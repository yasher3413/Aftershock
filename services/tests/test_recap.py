from __future__ import annotations

import json
from typing import Any

from aftershock.config import Settings
from aftershock.recap.generate import (
    EM_DASH,
    _GiveUp,
    _Retry,
    llm_recap,
    recap_writer,
    template_recap,
    validate,
)

DATA: dict[str, Any] = {
    "date": "2026-10-01",
    "games": [
        {
            "away": "Philadelphia Flyers",
            "home": "New Jersey Devils",
            "away_score": 2,
            "home_score": 3,
            "ended_in": "OT",
        },
        {
            "away": "Tampa Bay Lightning",
            "home": "New York Rangers",
            "away_score": 4,
            "home_score": 1,
            "ended_in": "REG",
        },
    ],
    "tremor_count": 10,
    "top_tremors": [
        {
            "team": "New Jersey Devils",
            "opponent": "Philadelphia Flyers",
            "scorer": "Jack Hughes",
            "period": 4,
            "time_in_period": "2:41",
            "magnitude": 3.4,
            "scoring_team_change_pp": 1.9,
            "biggest_other_mover": "Philadelphia Flyers",
            "biggest_other_mover_change_pp": -1.2,
        },
        {
            "team": "Tampa Bay Lightning",
            "opponent": "New York Rangers",
            "scorer": "Brayden Point",
            "period": 3,
            "time_in_period": "15:02",
            "magnitude": 2.2,
            "scoring_team_change_pp": 0.6,
            "biggest_other_mover": "New York Rangers",
            "biggest_other_mover_change_pp": -0.4,
        },
    ],
    "biggest_movers": [
        {"team": "New Jersey Devils", "change_pp": 2.8, "playoff_odds_now_pct": 61.4},
        {"team": "New York Rangers", "change_pp": -2.1, "playoff_odds_now_pct": 44.0},
    ],
    "top_ppa": {"player": "Jack Hughes", "ppa_pp": 2.5},
    "tomorrow_highest_stakes": {"away": "Boston Bruins", "home": "Winnipeg Jets", "stakes": 0.31},
}


def test_template_uses_only_supplied_numbers_and_no_em_dash() -> None:
    recap = template_recap(DATA)
    errors = validate(recap, DATA)
    assert not [e for e in errors if "numbers" in e or "em dash" in e], errors
    assert EM_DASH not in recap["body"]
    assert "percentage points" in recap["body"]
    assert "%" not in recap["body"].replace("61.4%", "").replace("44.0%", "")


def test_validation_catches_bad_drafts() -> None:
    good_body = " ".join(["word"] * 180) + " magnitude 3.4"
    ok = {"headline": "Hughes shakes it up", "body": good_body, "key_numbers": ["3.4 magnitude"]}
    assert validate(ok, DATA) == []
    invented = {**ok, "body": good_body + " a 7.7 swing"}
    assert any("7.7" in e for e in validate(invented, DATA))
    dashed = {**ok, "headline": f"Hughes {EM_DASH} again"}
    assert "contains an em dash" in validate(dashed, DATA)
    short = {**ok, "body": "Too short."}
    assert any("words" in e for e in validate(short, DATA))
    assert validate({"headline": "x"}, DATA) == ["missing fields"]


async def test_llm_loop_retries_and_feeds_back_validation_errors() -> None:
    good = template_recap(DATA)
    bad = {**good, "body": good["body"] + " A swing of 7.7 pp."}
    prompts: list[str] = []
    replies: list[object] = [_Retry("503"), json.dumps(bad), json.dumps(good)]

    async def draft(prompt: str) -> str:
        prompts.append(prompt)
        r = replies.pop(0)
        if isinstance(r, Exception):
            raise r
        return str(r)

    assert await llm_recap(DATA, draft) == good
    assert len(prompts) == 3
    assert "7.7" in prompts[2] and "failed validation" in prompts[2]


async def test_llm_loop_gives_up_on_a_hard_failure() -> None:
    async def draft(prompt: str) -> str:
        raise _GiveUp("401")

    assert await llm_recap(DATA, draft) is None


def test_openai_is_preferred_when_both_keys_are_set() -> None:
    both = Settings(openai_api_key="sk-test", anthropic_api_key="sk-ant-test")
    only_anthropic = Settings(openai_api_key="", anthropic_api_key="sk-ant-test")
    neither = Settings(openai_api_key="", anthropic_api_key="")
    w = recap_writer(both)
    assert w is not None and w[0] == both.openai_recap_model
    w = recap_writer(only_anthropic)
    assert w is not None and w[0] == only_anthropic.recap_model
    assert recap_writer(neither) is None
