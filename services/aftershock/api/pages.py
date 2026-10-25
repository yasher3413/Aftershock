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
import time
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import httpx
import structlog
from sqlalchemy import desc, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from aftershock.api.scenarios import ID_RE as SCENARIO_ID
from aftershock.config import Settings
from aftershock.db.models import Game, ReplayBundle, SavedScenario, Team, Tremor

log = structlog.get_logger(__name__)

SITE = "Puckquake"
TAGLINE = "Every goal in the NHL is an earthquake. See how far it travels."
HOME_TITLE = "Puckquake: how every NHL goal moves the playoff race"
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
        "The models and the simulator behind Puckquake, with measured results.",
    ),
    "/status": ("Pipeline status", TAGLINE),
    "/standings": (
        "Standings",
        "NHL standings by division, wild card, conference, and league, with every team's "
        "playoff and Stanley Cup odds.",
    ),
    "/about": (
        "About",
        "Who makes Puckquake, how to send feedback, and the math behind it in five steps.",
    ),
}


@dataclass
class PageMeta:
    title: str
    description: str
    image: str | None = None  # path under the site, made absolute on render
    found: bool = True  # False sends a 404, so search engines skip dead addresses
    path: str | None = None  # the page's address for og:url, if not the request path


NOT_FOUND = PageMeta(SITE, TAGLINE, found=False)


def _pct(p: float) -> str:
    return f"{p * 100:.1f}%"


async def page_meta(
    session: AsyncSession, path: str, query: Mapping[str, str] | None = None
) -> PageMeta:
    path = "/" + path.strip("/")
    scenario = (query or {}).get("id", "")
    if path == "/what-if" and SCENARIO_ID.fullmatch(scenario):
        saved = await session.get(SavedScenario, scenario)
        if saved is not None:
            return PageMeta(
                f"My NHL what-if | {SITE}",
                "My picks for upcoming NHL games and how they move every team's playoff odds. "
                "Pick your own in the What-If Lab.",
                f"/api/og/scenario/{saved.id}.png",
                path=f"/what-if?id={saved.id}",
            )
    if re.fullmatch(r"/embed/[A-Za-z]{3}", path):
        return PageMeta(SITE, TAGLINE)
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
            return NOT_FOUND
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
            return NOT_FOUND
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
    if path == "/night/today":
        return PageMeta(f"Tonight's games | {SITE}", "Tonight's NHL schedule, scores, and odds.")
    if m := re.fullmatch(r"/night/(\d{4}-\d{2}-\d{2})", path):
        try:
            night = date.fromisoformat(m.group(1))
        except ValueError:
            return NOT_FOUND
        label = night.strftime("%B %-d, %Y")
        return PageMeta(
            f"{label}: every goal, replayed | {SITE}",
            f"Every NHL goal of {label} and how far it moved the playoff race.",
            f"/api/og/night/{night}.png",
        )
    if m := re.fullmatch(r"/game/(\d+)", path):
        g = await session.get(Game, int(m.group(1)))
        if g is None:
            return NOT_FOUND
        score = (
            f"{g.away} {g.away_score}, {g.home} {g.home_score}"
            if g.home_score is not None
            else f"{g.away} at {g.home}"
        )
        return PageMeta(
            f"{score} | {SITE}",
            f"{g.away} at {g.home}: win probability, shots, and how every goal moved the "
            "playoff race.",
            f"/api/og/game/{g.id}.png",
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
    return NOT_FOUND


# Pages worth a search result: the sections, every team, every night replayed
# this season, and everyone who scored or assisted on a goal this season.
SECTIONS = ["/", *STATIC]


async def sitemap(session: AsyncSession, base_url: str) -> str:
    base = base_url.rstrip("/")
    season = await session.scalar(select(Tremor.season).order_by(desc(Tremor.season)).limit(1))
    teams = (await session.execute(select(Team.abbrev).order_by(Team.abbrev))).scalars()
    paths = [p for p in SECTIONS if p != "/status"] + [f"/team/{t}" for t in teams]
    if season is not None:
        nights = (
            await session.execute(
                select(ReplayBundle.night_date)
                .where(ReplayBundle.season == season, ReplayBundle.n_tremors > 0)
                .order_by(ReplayBundle.night_date)
            )
        ).scalars()
        paths += [f"/night/{n}" for n in nights]
        players: list[int] = list(
            (
                await session.execute(
                    text(
                        "SELECT DISTINCT p FROM tremors, "
                        "unnest(ARRAY[scorer_id, assist1_id, assist2_id]) AS p "
                        "WHERE season = :s AND p IS NOT NULL ORDER BY p"
                    ),
                    {"s": season},
                )
            ).scalars()
        )
        paths += [f"/player/{p}" for p in players]
    urls = "".join(f"<url><loc>{html.escape(base + p)}</loc></url>" for p in paths)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>'
    )


def robots(base_url: str) -> str:
    return (
        "User-agent: *\n"
        "Disallow: /embed/\n"
        "Disallow: /status\n"
        f"\nSitemap: {base_url.rstrip('/')}/sitemap.xml\n"
    )


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
# Each site deploy renames its hashed assets, so the shell is fetched again
# after this long rather than kept for the life of the process.
TEMPLATE_TTL_S = 60.0


async def index_template(settings: Settings) -> str | None:
    """The built index.html from the web server (or a file), cached briefly.
    If a refresh fails, the last copy is served."""
    if "html" in _template and time.monotonic() - _template["at"] < TEMPLATE_TTL_S:
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
        if "html" in _template:
            _template["at"] = time.monotonic()
            return str(_template["html"])
        return None
    _template.update(html=body, at=time.monotonic())
    return body
