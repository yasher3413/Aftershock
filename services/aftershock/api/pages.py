"""Share previews for every page.

Link-preview bots (X, Facebook, iMessage, Discord, Slack, Reddit) do not run
JavaScript, so they never see the titles and images the app sets in the
browser. nginx sends page requests here instead of straight to index.html;
this fills each page's title, description, and share image into the built
index.html and returns it. The app then takes over as usual.
"""

from __future__ import annotations

import asyncio
import html
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import httpx
import structlog
from sqlalchemy import desc, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from aftershock.config import Settings
from aftershock.db.models import Game, ReplayBundle, Team, Tremor

log = structlog.get_logger(__name__)

SITE = "Aftershock"
TAGLINE = "Every goal in the NHL is an earthquake. See how far it travels."
HOME_TITLE = "Aftershock: how every NHL goal moves the playoff race"
HOME_DESC = (
    "A live map of the NHL: every goal sends a shockwave across the league, and every "
    "team's playoff odds move as it passes."
)
STATIC = {
    "/leaders": (
        "Leaders",
        "Playoff Probability Added leaders and the biggest goals of the season.",
    ),
    "/what-if": (
        "What-If Lab",
        "Pick results for upcoming games and rerun the NHL season in your browser.",
    ),
    "/nights": ("Every night", "Replay any NHL night of the last three seasons, goal by goal."),
    "/method": (
        "How it works",
        "The models and the simulator behind Aftershock, with measured results.",
    ),
    "/status": ("Pipeline status", TAGLINE),
}


@dataclass
class PageMeta:
    title: str
    description: str
    image: str | None = None  # path under the site, made absolute on render


def _pct(p: float) -> str:
    return f"{p * 100:.1f}%"


async def page_meta(session: AsyncSession, path: str) -> PageMeta:
    path = "/" + path.strip("/")
    if path in STATIC:
        title, desc_ = STATIC[path]
        return PageMeta(f"{title} | {SITE}", desc_)
    if path == "/":
        last = await session.scalar(
            select(ReplayBundle.night_date)
            .where(ReplayBundle.n_tremors > 0)
            .order_by(desc(ReplayBundle.night_date))
            .limit(1)
        )
        return PageMeta(HOME_TITLE, HOME_DESC, f"/api/og/night/{last}.png" if last else None)
    if m := re.fullmatch(r"/team/([A-Za-z]{3})", path):
        abbrev = m.group(1).upper()
        team = await session.get(Team, abbrev)
        if team is None:
            return PageMeta(SITE, TAGLINE)
        odds = (
            await session.execute(
                text(
                    "SELECT o.p_playoffs FROM team_odds o JOIN sim_runs r ON r.id = o.sim_run_id "
                    "WHERE o.team = :t ORDER BY r.id DESC LIMIT 1"
                ),
                {"t": abbrev},
            )
        ).scalar_one_or_none()
        desc_ = (
            f"{team.name}: {_pct(float(odds))} to make the playoffs, and every goal that moved it."
            if odds is not None
            else f"{team.name} playoff odds and every goal that moved them."
        )
        return PageMeta(f"{team.name} playoff odds | {SITE}", desc_, f"/api/og/team/{abbrev}.png")
    if m := re.fullmatch(r"/tremor/(\d+)", path):
        t = await session.get(Tremor, int(m.group(1)))
        if t is None:
            return PageMeta(SITE, TAGLINE)
        scorer = await session.scalar(
            text("SELECT name FROM players WHERE id = :p"), {"p": t.scorer_id}
        )
        d = (t.deltas or {}).get(t.team, {}).get("d_playoffs", 0.0)
        return PageMeta(
            f"{scorer or t.team}: a magnitude {t.magnitude:.1f} goal | {SITE}",
            f"{t.team} goal against {t.opponent}. {t.team} playoff odds {d * 100:+.1f} "
            "percentage points, and every other team it moved.",
            f"/api/og/tremor/{t.id}.png",
        )
    if m := re.fullmatch(r"/night/(\d{4}-\d{2}-\d{2})", path):
        night = date.fromisoformat(m.group(1))
        label = night.strftime("%B %-d, %Y")
        return PageMeta(
            f"{label}: every goal, replayed | {SITE}",
            f"Every NHL goal of {label} and how far it moved the playoff race.",
            f"/api/og/night/{night}.png",
        )
    if m := re.fullmatch(r"/game/(\d+)", path):
        g = await session.get(Game, int(m.group(1)))
        if g is None:
            return PageMeta(SITE, TAGLINE)
        score = (
            f"{g.away} {g.away_score}, {g.home} {g.home_score}"
            if g.home_score is not None
            else f"{g.away} at {g.home}"
        )
        return PageMeta(
            f"{score} | {SITE}",
            f"{g.away} at {g.home}: win probability, shots, and how every goal moved the "
            "playoff race.",
            f"/api/og/night/{g.night_date}.png",
        )
    if m := re.fullmatch(r"/player/(\d+)", path):
        name = await session.scalar(
            text("SELECT name FROM players WHERE id = :p"), {"p": int(m.group(1))}
        )
        if name:
            return PageMeta(
                f"{name} | {SITE}",
                f"{name}: every goal's effect on the NHL playoff race, plus discipline "
                "and defense.",
            )
    return PageMeta(SITE, TAGLINE)


def render(template: str, meta: PageMeta, base_url: str, path: str) -> str:
    """Fill the page's tags into index.html (replacing the generic title and
    description)."""
    base = base_url.rstrip("/")
    e = html.escape
    card = "summary_large_image" if meta.image else "summary"
    tags = [
        f'<meta name="description" content="{e(meta.description)}" />',
        f'<meta property="og:site_name" content="{SITE}" />',
        '<meta property="og:type" content="website" />',
        f'<meta property="og:title" content="{e(meta.title)}" />',
        f'<meta property="og:description" content="{e(meta.description)}" />',
        f'<meta property="og:url" content="{e(base + path)}" />',
        f'<meta name="twitter:card" content="{card}" />',
        f'<meta name="twitter:title" content="{e(meta.title)}" />',
        f'<meta name="twitter:description" content="{e(meta.description)}" />',
    ]
    if meta.image:
        img = e(base + meta.image)
        tags += [
            f'<meta property="og:image" content="{img}" />',
            '<meta property="og:image:width" content="1200" />',
            '<meta property="og:image:height" content="630" />',
            f'<meta name="twitter:image" content="{img}" />',
        ]
    out = re.sub(r"<title>.*?</title>", f"<title>{e(meta.title)}</title>", template, flags=re.S)
    out = re.sub(r'\s*<meta\s+name="description"[^>]*/>', "", out, flags=re.S)
    return out.replace("</head>", "    " + "\n    ".join(tags) + "\n  </head>", 1)


_template: dict[str, Any] = {}


async def index_template(settings: Settings) -> str | None:
    """The built index.html, fetched once from the web server (or a file)."""
    if "html" in _template:
        return str(_template["html"])
    src = settings.index_html
    try:
        if src.startswith("http"):
            async with httpx.AsyncClient(timeout=5) as c:
                r = await c.get(src)
                r.raise_for_status()
                body = r.text
        else:
            body = await asyncio.to_thread(Path(src).read_text, encoding="utf-8")
    except Exception as exc:
        log.warning("pages.template_failed", src=src, error=str(exc))
        return None
    _template["html"] = body
    return body
