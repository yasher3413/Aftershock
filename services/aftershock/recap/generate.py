"""Nightly recap: structured data in, a short validated write-up out.

The recap is written by the Anthropic Messages API when ``ANTHROPIC_API_KEY``
is set, and by a deterministic template otherwise. Model output is only
stored if it passes validation: valid JSON with the expected fields, a body
of 150 to 250 words, no em dash, and every number in the text traceable to
the supplied data (allowing one-decimal rounding). Two retries, then the
template.
"""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable
from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import structlog
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from aftershock.api import queries as Q
from aftershock.config import Settings, get_settings
from aftershock.db.models import Game, Recap, Team, Tremor
from aftershock.db.session import session_scope

log = structlog.get_logger(__name__)

EASTERN = ZoneInfo("America/New_York")
EM_DASH = chr(0x2014)
MIN_WORDS, MAX_WORDS = 150, 250
NUMBER = re.compile(r"\d+(?:\.\d+)?")

SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {"type": "string"},
        "body": {"type": "string"},
        "key_numbers": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["headline", "body", "key_numbers"],
    "additionalProperties": False,
}

SYSTEM = (
    "You write the nightly recap for Aftershock, a site that measures how every NHL goal "
    "moves every team's playoff odds. Write for hockey fans: plain, specific, punchy, no hype. "
    "Use only facts and numbers present in the supplied JSON. Write odds changes as "
    "percentage points (for example '2.3 percentage points' or '2.3 pp'), never as percent "
    "changes. Never use an em dash; use commas, periods, colons, or parentheses. Return JSON "
    "with a headline (under 90 characters), a body of 150 to 250 words, and key_numbers: 3 to "
    "5 short phrases that each quote one number from the data."
)


def _pp(x: float) -> float:
    return round(x * 100, 1)


def _clock(seconds: int) -> str:
    return f"{seconds // 60}:{seconds % 60:02d}"


async def gather(session: AsyncSession, night: date) -> dict[str, Any]:
    names = {t.abbrev: t.name for t in (await session.execute(select(Team))).scalars()}
    games = (
        await session.execute(
            select(Game)
            .where(Game.night_date == night, Game.game_type.in_((2, 3)))
            .order_by(Game.start_utc)
        )
    ).scalars()
    game_list = [
        {
            "away": names.get(g.away, g.away),
            "home": names.get(g.home, g.home),
            "away_score": g.away_score,
            "home_score": g.home_score,
            "ended_in": g.last_period_type or "REG",
        }
        for g in games
    ]
    rows = list(
        (
            await session.execute(
                select(Tremor)
                .where(Tremor.night_date == night, Tremor.overturned.is_(False))
                .order_by(Tremor.magnitude.desc())
            )
        ).scalars()
    )
    tremors = await Q.tremors_out(session, rows)
    top = []
    for t in tremors[:8]:
        others = [d for d in t.deltas if d.team != t.team]
        mover = max(others, key=lambda d: abs(d.d_playoffs), default=None)
        top.append(
            {
                "team": names.get(t.team, t.team),
                "opponent": names.get(t.opponent, t.opponent),
                "scorer": t.scorer.name if t.scorer else None,
                "period": t.period,
                "time_in_period": _clock(t.t_period_s),
                "magnitude": round(t.magnitude, 1),
                "scoring_team_change_pp": _pp(t.ppa),
                "biggest_other_mover": names.get(mover.team, mover.team) if mover else None,
                "biggest_other_mover_change_pp": _pp(mover.d_playoffs) if mover else None,
            }
        )
    start = datetime.combine(night, time(6), EASTERN)
    end = start + timedelta(days=1)
    runs: Any = (
        (
            await session.execute(
                text(
                    "SELECT id FROM sim_runs WHERE as_of >= :a AND as_of < :b "
                    "AND trigger <> 'drift' "
                    "AND EXISTS (SELECT 1 FROM team_odds o WHERE o.sim_run_id = sim_runs.id) "
                    "ORDER BY as_of, id"
                ),
                {"a": start, "b": end},
            )
        )
        .scalars()
        .all()
    )
    movers = []
    if len(runs) >= 2:
        first: dict[str, float] = dict(
            (
                await session.execute(
                    text("SELECT team, p_playoffs FROM team_odds WHERE sim_run_id = :r"),
                    {"r": runs[0]},
                )
            ).all()
        )
        last: dict[str, float] = dict(
            (
                await session.execute(
                    text("SELECT team, p_playoffs FROM team_odds WHERE sim_run_id = :r"),
                    {"r": runs[-1]},
                )
            ).all()
        )
        changes = sorted(
            ((t, last[t] - first[t]) for t in last if t in first), key=lambda kv: -abs(kv[1])
        )
        movers = [
            {
                "team": names.get(t, t),
                "change_pp": _pp(d),
                "playoff_odds_now_pct": round(last[t] * 100, 1),
            }
            for t, d in changes[:5]
        ]
    ppa: dict[str, float] = {}
    for t in tremors:
        if t.scorer:
            ppa[t.scorer.name] = ppa.get(t.scorer.name, 0.0) + t.ppa
    top_ppa = max(ppa.items(), key=lambda kv: kv[1], default=None)
    tomorrow = await _tomorrow_stakes(session, night + timedelta(days=1), names)
    return {
        "date": night.isoformat(),
        "games": game_list,
        "tremor_count": len(tremors),
        "top_tremors": top,
        "biggest_movers": movers,
        "top_ppa": {"player": top_ppa[0], "ppa_pp": _pp(top_ppa[1])} if top_ppa else None,
        "tomorrow_highest_stakes": tomorrow,
    }


async def _tomorrow_stakes(
    session: AsyncSession, day: date, names: dict[str, str]
) -> dict[str, Any] | None:
    row = (
        await session.execute(
            text("SELECT data FROM conditional_tables ORDER BY sim_run_id DESC LIMIT 1")
        )
    ).first()
    if row is None:
        return None
    ids = {
        int(g.id): g
        for g in (await session.execute(select(Game).where(Game.night_date == day))).scalars()
    }
    best = max(
        (g for g in row[0]["games"] if int(g["game_id"]) in ids),
        key=lambda g: g["stakes"],
        default=None,
    )
    if best is None:
        return None
    g = ids[int(best["game_id"])]
    return {
        "away": names.get(g.away, g.away),
        "home": names.get(g.home, g.home),
        "stakes": round(float(best["stakes"]), 2),
    }


# ----------------------------------------------------------------------
# Validation


def allowed_numbers(data: Any) -> set[str]:
    """Every number in the data, as it may legitimately be written."""
    out: set[str] = set()

    def walk(v: Any) -> None:
        if isinstance(v, bool) or v is None:
            return
        if isinstance(v, int | float):
            f = abs(float(v))
            for s in (f"{f:.1f}", f"{f:.0f}", f"{f:g}", f"{f:.2f}"):
                out.add(s)
                out.add(s.rstrip("0").rstrip(".") if "." in s else s)
        elif isinstance(v, str):
            out.update(NUMBER.findall(v))
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    walk(data)
    return out


def validate(obj: Any, data: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if not isinstance(obj, dict) or not all(k in obj for k in ("headline", "body", "key_numbers")):
        return ["missing fields"]
    words = len(str(obj["body"]).split())
    if not MIN_WORDS <= words <= MAX_WORDS:
        errors.append(f"body has {words} words")
    blob = " ".join([str(obj["headline"]), str(obj["body"]), *map(str, obj["key_numbers"])])
    if EM_DASH in blob:
        errors.append("contains an em dash")
    allowed = allowed_numbers(data)
    bad = sorted({n for n in NUMBER.findall(blob) if n not in allowed})
    if bad:
        errors.append(f"numbers not in the data: {', '.join(bad[:8])}")
    return errors


# ----------------------------------------------------------------------
# Writers


def template_recap(data: dict[str, Any]) -> dict[str, Any]:
    """Deterministic recap built only from the data."""
    night = datetime.fromisoformat(data["date"]).strftime("%B %-d")
    tremors = data["top_tremors"]
    parts: list[str] = []
    games = data["games"]
    if games:
        results = "; ".join(
            f"{g['away']} {g['away_score']}, {g['home']} {g['home_score']}"
            + ("" if g["ended_in"] == "REG" else f" ({g['ended_in']})")
            for g in games
            if g["home_score"] is not None
        )
        parts.append(f"Final scores on {night}: {results}.")
    if tremors:
        t = tremors[0]
        parts.append(
            f"The biggest tremor was {t['scorer'] or 'a goal'} for the {t['team']} against the "
            f"{t['opponent']} in period {t['period']} at {t['time_in_period']}, magnitude "
            f"{t['magnitude']}. It moved the {t['team']} playoff odds by "
            f"{t['scoring_team_change_pp']} percentage points."
        )
        if t["biggest_other_mover"]:
            parts.append(
                f"The ripple hit the {t['biggest_other_mover']} hardest, a change of "
                f"{t['biggest_other_mover_change_pp']} percentage points."
            )
        for extra in tremors[1:4]:
            parts.append(
                f"{extra['scorer'] or 'A goal'} ({extra['team']}) registered magnitude "
                f"{extra['magnitude']}, worth {extra['scoring_team_change_pp']} pp to the "
                f"{extra['team']}."
            )
    if data["biggest_movers"]:
        m = data["biggest_movers"]
        parts.append(
            "Across the whole night, the biggest movers were "
            + "; ".join(
                f"the {x['team']} ({x['change_pp']} pp, now {x['playoff_odds_now_pct']}%)"
                for x in m[:4]
            )
            + "."
        )
    if data["top_ppa"]:
        parts.append(
            f"{data['top_ppa']['player']} led the night in Playoff Probability Added with "
            f"{data['top_ppa']['ppa_pp']} pp."
        )
    if data["tomorrow_highest_stakes"]:
        g = data["tomorrow_highest_stakes"]
        parts.append(f"Tomorrow's highest-stakes game is the {g['away']} at the {g['home']}.")
    parts.append(
        f"In all, {data['tremor_count']} goals shook the standings tonight. Early in a season "
        "each one moves the odds only a little, and the tremors grow as the race tightens "
        "toward April, when a single goal can swing a playoff spot."
    )
    body = " ".join(parts)
    words = body.split()
    if len(words) > MAX_WORDS:
        body = " ".join(words[:MAX_WORDS]).rstrip(",;") + "."
    headline = (
        f"{tremors[0]['scorer']} and the {tremors[0]['team']} shake the standings"
        if tremors and tremors[0]["scorer"]
        else f"The {night} tremor report"
    )
    keys = []
    if tremors:
        keys.append(f"Magnitude {tremors[0]['magnitude']}: the night's biggest tremor")
    if data["top_ppa"]:
        keys.append(f"{data['top_ppa']['ppa_pp']} pp: top Playoff Probability Added")
    keys.append(f"{data['tremor_count']} goals scored")
    return {"headline": headline, "body": body, "key_numbers": keys}


class _Retry(Exception):
    """A transient provider failure: try again."""


class _GiveUp(Exception):
    """A provider failure retrying will not fix."""


Draft = Callable[[str], Awaitable[str]]


def _anthropic_draft(settings: Settings) -> Draft:
    import anthropic

    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    async def draft(prompt: str) -> str:
        try:
            resp = await client.messages.create(
                model=settings.recap_model,
                max_tokens=16000,
                system=SYSTEM,
                messages=[{"role": "user", "content": prompt}],
                output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
            )
        except anthropic.RateLimitError as exc:
            raise _Retry(str(exc)) from exc
        except anthropic.APIStatusError as exc:
            if exc.status_code < 500:
                raise _GiveUp(str(exc)) from exc
            raise _Retry(str(exc)) from exc
        except anthropic.APIConnectionError as exc:
            raise _Retry(str(exc)) from exc
        if resp.stop_reason == "refusal":
            raise _GiveUp("refused")
        return next((b.text for b in resp.content if b.type == "text"), "")

    return draft


def _openai_draft(settings: Settings) -> Draft:
    import openai

    client = openai.AsyncOpenAI(api_key=settings.openai_api_key, max_retries=1)

    async def draft(prompt: str) -> str:
        try:
            resp = await client.responses.create(
                model=settings.openai_recap_model,
                instructions=SYSTEM,
                input=prompt,
                max_output_tokens=16000,
                text={
                    "format": {
                        "type": "json_schema",
                        "name": "recap",
                        "schema": SCHEMA,
                        "strict": True,
                    }
                },
            )
        except openai.RateLimitError as exc:
            # A 429 is also how OpenAI reports an empty credit balance.
            if exc.type == "insufficient_quota":
                raise _GiveUp(str(exc)) from exc
            raise _Retry(str(exc)) from exc
        except openai.APIStatusError as exc:
            if exc.status_code < 500:
                raise _GiveUp(str(exc)) from exc
            raise _Retry(str(exc)) from exc
        except openai.APIConnectionError as exc:
            raise _Retry(str(exc)) from exc
        for item in resp.output:
            for part in getattr(item, "content", None) or []:
                if part.type == "refusal":
                    raise _GiveUp("refused")
        return resp.output_text

    return draft


def recap_writer(settings: Settings) -> tuple[str, Draft] | None:
    """(model name, draft function) for the configured provider, if any."""
    if settings.openai_api_key:
        return settings.openai_recap_model, _openai_draft(settings)
    if settings.anthropic_api_key:
        return settings.recap_model, _anthropic_draft(settings)
    return None


async def llm_recap(data: dict[str, Any], draft: Draft) -> dict[str, Any] | None:
    prompt = "Write tonight's recap from this data.\n\n" + json.dumps(data, indent=2, default=str)
    feedback = ""
    for attempt in range(3):
        try:
            text_out = await draft(prompt + feedback)
        except _Retry as exc:
            log.warning("recap.retry", attempt=attempt, error=str(exc))
            continue
        except _GiveUp as exc:
            log.warning("recap.gave_up", error=str(exc))
            return None
        try:
            obj = json.loads(text_out)
        except json.JSONDecodeError:
            feedback = "\n\nYour last answer was not valid JSON. Return only the JSON object."
            continue
        errors = validate(obj, data)
        if not errors:
            return dict(obj)
        log.info("recap.invalid", attempt=attempt, errors=errors)
        feedback = (
            "\n\nYour previous draft failed validation: "
            + "; ".join(errors)
            + ". Fix these and try again."
        )
    return None


async def generate_recap(night: date, settings: Settings | None = None) -> dict[str, Any]:
    s = settings or get_settings()
    async with session_scope() as session:
        data = await gather(session, night)
    recap = None
    model = "template"
    writer = recap_writer(s)
    if writer is not None:
        recap = await llm_recap(data, writer[1])
        if recap is not None:
            model = writer[0]
    if recap is None:
        recap = template_recap(data)
    validated = not validate(recap, data)
    async with session_scope() as session:
        row = {
            "night_date": night,
            "headline": recap["headline"],
            "body": recap["body"],
            "data": {**data, "key_numbers": recap["key_numbers"]},
            "model": model,
            "validated": validated,
        }
        stmt = insert(Recap).values(row)
        await session.execute(
            stmt.on_conflict_do_update(
                index_elements=["night_date"],
                set_={
                    k: stmt.excluded[k] for k in ("headline", "body", "data", "model", "validated")
                },
            )
        )
    log.info("recap.stored", night=str(night), model=model, validated=validated)
    return recap
