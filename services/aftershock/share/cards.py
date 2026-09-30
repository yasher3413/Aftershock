"""Share images: SVG templates rendered to PNG with cairosvg.

Open Graph images are 1200 by 630; the downloadable tremor card is 1080 by
1350. Fonts are bundled (both under the SIL Open Font License) and exposed to
Cairo through a private fontconfig file, so rendering does not depend on
what is installed on the machine.
"""

from __future__ import annotations

import json
import math
import os
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

from aftershock.api import schemas as S

HERE = Path(__file__).resolve().parent
FONTS = HERE / "fonts"

# Light theme tokens (docs/DESIGN.md).
ICE = "#eef3f6"
LAND = "#dde7ed"
SCRATCH = "#c9d6df"
INK = "#14212b"
INK_SOFT = "#5d707e"
GOAL = "#c8102e"
BLUE = "#0b4fa8"
DISPLAY = "Big Shoulders Display"
TEXT = "Instrument Sans"
ATTRIBUTION = "Data from NHL.com. Aftershock is not affiliated with or endorsed by the NHL."


class CairoUnavailable(RuntimeError):
    """The Cairo C library could not be loaded."""


@lru_cache(maxsize=1)
def _svg2png() -> Any:
    conf_dir = Path(tempfile.mkdtemp(prefix="aftershock-fc-"))
    conf = conf_dir / "fonts.conf"
    conf.write_text(
        '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>'
        f'<dir>{FONTS}</dir><include ignore_missing="yes">/etc/fonts/fonts.conf</include>'
        f"<cachedir>{conf_dir / 'cache'}</cachedir></fontconfig>"
    )
    os.environ.setdefault("FONTCONFIG_FILE", str(conf))
    try:
        import cairosvg
    except OSError as exc:  # libcairo missing
        raise CairoUnavailable(
            "Share images need the Cairo library (brew install cairo, or apt install "
            "libcairo2). On macOS also export DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib."
        ) from exc
    return cairosvg.svg2png


def render_png(svg: str) -> bytes:
    data: bytes = _svg2png()(bytestring=svg.encode("utf-8"))
    return data


# ----------------------------------------------------------------------
# Projection: the web map's conic conformal (parallels 30 and 55, rotate
# -96, center 40), fit to a box.


def _conic(lon: float, lat: float) -> tuple[float, float]:
    phi1, phi2 = math.radians(30), math.radians(55)
    n = math.log(math.cos(phi1) / math.cos(phi2)) / math.log(
        math.tan(math.pi / 4 + phi2 / 2) / math.tan(math.pi / 4 + phi1 / 2)
    )
    f = math.cos(phi1) * math.tan(math.pi / 4 + phi1 / 2) ** n / n
    lam = math.radians(lon + 96)
    phi = math.radians(max(min(lat, 89), -89))
    rho = f / math.tan(math.pi / 4 + phi / 2) ** n
    rho0 = f / math.tan(math.pi / 4 + math.radians(40) / 2) ** n
    return rho * math.sin(n * lam), rho0 - rho * math.cos(n * lam)


FRAME = [(-125.5, 49.5), (-114, 54.5), (-66.5, 46), (-80.5, 24.8), (-118, 32), (-97, 25.5)]


class Projection:
    def __init__(self, x: float, y: float, w: float, h: float, pad: float = 10) -> None:
        pts = [_conic(lo, la) for lo, la in FRAME]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        self.k = min((w - 2 * pad) / (max(xs) - min(xs)), (h - 2 * pad) / (max(ys) - min(ys)))
        self.x0 = x + pad + ((w - 2 * pad) - (max(xs) - min(xs)) * self.k) / 2 - min(xs) * self.k
        self.y0 = y + pad + ((h - 2 * pad) - (max(ys) - min(ys)) * self.k) / 2 + max(ys) * self.k
        self.box = (x, y, w, h)

    def __call__(self, lon: float, lat: float) -> tuple[float, float]:
        if lon > -50 or lon < -170:  # off the map: the eastern or western edge
            x, y, w, h = self.box
            yy = y + h * (0.25 + 0.5 * (55 - max(30, min(55, lat))) / 25)
            return (x + w - 8, yy) if lon > -50 else (x + 8, yy)
        px, py = _conic(lon, lat)
        return self.x0 + px * self.k, self.y0 - py * self.k


@lru_cache(maxsize=1)
def _land() -> list[list[list[tuple[float, float]]]]:
    data = json.loads((HERE / "land.geo.json").read_text())
    polys: list[list[list[tuple[float, float]]]] = []
    for feat in data["features"]:
        geom = feat["geometry"]
        rings = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
        for poly in rings:
            polys.append([[(float(a), float(b)) for a, b in ring] for ring in poly])
    return polys


def land_path(proj: Projection) -> str:
    parts = []
    for poly in _land():
        for ring in poly:
            pts = [proj(lo, la) for lo, la in ring]
            parts.append("M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in pts) + "Z")
    return "".join(parts)


# ----------------------------------------------------------------------
# Templates


def _svg(w: int, h: int, body: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}"><rect width="{w}" height="{h}" fill="{ICE}"/>{body}</svg>'
    )


def _text(
    x: float,
    y: float,
    s: str,
    size: float,
    *,
    family: str = TEXT,
    weight: int = 400,
    fill: str = INK,
    anchor: str = "start",
) -> str:
    return (
        f'<text x="{x:.1f}" y="{y:.1f}" font-family="{family}" font-weight="{weight}" '
        f'font-size="{size}" fill="{fill}" text-anchor="{anchor}">{escape(s)}</text>'
    )


def _pp(d: float) -> str:
    v = round(d * 100, 1)
    sign = "+" if v > 0 else ("−" if v < 0 else "")
    return f"{sign}{abs(v):.1f} pp"


def _mini_map(t: S.Tremor, teams: list[S.TeamInfo], x: float, y: float, w: float, h: float) -> str:
    proj = Projection(x, y, w, h)
    ox, oy = proj(t.origin.lon, t.origin.lat)
    reach = math.hypot(w, h) * 0.42
    deltas = {d.team: d.d_playoffs for d in t.deltas}
    out = [
        f'<path d="{land_path(proj)}" fill="{LAND}" stroke="{SCRATCH}" stroke-width="1"/>',
        f'<clipPath id="mm"><rect x="{x}" y="{y}" width="{w}" height="{h}"/></clipPath>',
        '<g clip-path="url(#mm)">',
        f'<circle cx="{ox:.1f}" cy="{oy:.1f}" r="{reach:.1f}" fill="none" stroke="{GOAL}" '
        f'stroke-width="{2 + t.magnitude * 0.6:.1f}" opacity="0.55"/>',
        f'<circle cx="{ox:.1f}" cy="{oy:.1f}" r="{reach * 0.72:.1f}" fill="none" '
        f'stroke="{GOAL}" stroke-width="1.5" opacity="0.3"/>',
        f'<circle cx="{ox:.1f}" cy="{oy:.1f}" r="{9 + t.magnitude:.1f}" fill="{GOAL}" '
        'opacity="0.85"/>',
    ]
    for tm in teams:
        px, py = proj(tm.lon, tm.lat)
        d = deltas.get(tm.abbrev, 0.0)
        big = abs(d) >= 0.001 and math.hypot(px - ox, py - oy) <= reach
        color = (BLUE if d > 0 else GOAL) if big else INK_SOFT
        out.append(
            f'<circle cx="{px:.1f}" cy="{py:.1f}" r="{5.5 if big else 3.5}" fill="{color}"/>'
        )
    out.append("</g>")
    return "".join(out)


def _headline(t: S.Tremor) -> tuple[str, str]:
    who = t.scorer.name if t.scorer else f"{t.team} goal"
    when = (
        "Shootout winner"
        if t.shootout
        else f"Period {t.period}, {t.t_period_s // 60}:{t.t_period_s % 60:02d}"
    )
    return who, f"{t.away} {t.score_after.away}, {t.home} {t.score_after.home}. {when}."


def tremor_og(t: S.Tremor, teams: list[S.TeamInfo]) -> str:
    w, h = 1200, 630
    who, line = _headline(t)
    parts = [
        _text(60, 88, f"{t.night_date:%B %-d, %Y}", 26, fill=INK_SOFT),
        _text(52, 300, f"{t.magnitude:.1f}", 250, family=DISPLAY, weight=800, fill=GOAL),
        _text(60, 340, "Magnitude", 24, fill=INK_SOFT),
        _text(60, 410, who, 46, weight=600),
        _text(60, 455, line, 26, fill=INK_SOFT),
    ]
    y = 510
    for d in t.deltas[:3]:
        parts.append(_text(60, y, d.team, 30, family=DISPLAY, weight=800))
        parts.append(_text(140, y, _pp(d.d_playoffs), 26, fill=BLUE if d.d_playoffs > 0 else GOAL))
        y += 36
    parts.append(_mini_map(t, teams, 560, 100, 600, 470))
    parts.append(_text(1140, 88, "Aftershock", 40, family=DISPLAY, weight=800, anchor="end"))
    parts.append(_text(1140, 605, ATTRIBUTION, 15, fill=INK_SOFT, anchor="end"))
    return _svg(w, h, "".join(parts))


def tremor_card(t: S.Tremor, teams: list[S.TeamInfo]) -> str:
    w, h = 1080, 1350
    who, line = _headline(t)
    parts = [
        _text(70, 110, "Aftershock", 52, family=DISPLAY, weight=800),
        _text(70, 160, f"{t.night_date:%B %-d, %Y}", 30, fill=INK_SOFT),
        _text(60, 400, f"{t.magnitude:.1f}", 260, family=DISPLAY, weight=800, fill=GOAL),
        _text(70, 450, "Magnitude", 30, fill=INK_SOFT),
        _text(70, 530, who, 54, weight=600),
        _text(70, 580, line, 30, fill=INK_SOFT),
        _mini_map(t, teams, 520, 190, 500, 400),
        _text(70, 680, "Change in playoff odds", 30, weight=600),
    ]
    top = t.deltas[:12]
    m = max((abs(d.d_playoffs) for d in top), default=1e-6) or 1e-6
    y = 740
    mid = 560
    for d in top:
        bw = abs(d.d_playoffs) / m * 300
        x = mid if d.d_playoffs > 0 else mid - bw
        color = BLUE if d.d_playoffs > 0 else GOAL
        parts.append(_text(70, y, d.team, 34, family=DISPLAY, weight=800))
        parts.append(
            f'<rect x="{x:.1f}" y="{y - 22}" width="{max(bw, 2):.1f}" height="20" fill="{color}"/>'
        )
        parts.append(f'<line x1="{mid}" x2="{mid}" y1="{y - 30}" y2="{y + 6}" stroke="{SCRATCH}"/>')
        parts.append(_text(1010, y, _pp(d.d_playoffs), 30, fill=color, anchor="end"))
        y += 44
    parts.append(_text(70, 1300, ATTRIBUTION, 20, fill=INK_SOFT))
    return _svg(w, h, "".join(parts))


def team_og(team: S.TeamInfo, odds: S.TeamOdds | None) -> str:
    w, h = 1200, 630
    parts = [
        f'<rect x="60" y="70" width="90" height="10" fill="{team.color_primary}"/>',
        _text(56, 190, team.name, 92, family=DISPLAY, weight=800),
        _text(
            60, 240, f"{team.division} Division, {team.conference} Conference", 28, fill=INK_SOFT
        ),
        _text(60, 330, "Playoff odds", 30, fill=INK_SOFT),
    ]
    if odds is not None:
        parts += [
            _text(52, 480, f"{odds.p_playoffs * 100:.1f}%", 170, family=DISPLAY, weight=800),
            _text(
                60,
                540,
                f"Stanley Cup {odds.p_cup * 100:.1f}%. Projected {odds.exp_points:.0f} points.",
                30,
                fill=INK_SOFT,
            ),
        ]
    parts.append(_text(1140, 590, "Aftershock", 40, family=DISPLAY, weight=800, anchor="end"))
    parts.append(_text(60, 600, ATTRIBUTION, 15, fill=INK_SOFT))
    return _svg(w, h, "".join(parts))


def night_og(night: Any, tremors: list[S.Tremor], n_games: int) -> str:
    w, h = 1200, 630
    parts = [
        _text(56, 150, f"{night:%B %-d, %Y}", 96, family=DISPLAY, weight=800),
        _text(60, 210, f"{n_games} games, {len(tremors)} tremors", 32, fill=INK_SOFT),
    ]
    y = 300
    for t in sorted(tremors, key=lambda x: -x.magnitude)[:4]:
        who, _ = _headline(t)
        parts.append(_text(60, y, f"{t.magnitude:.1f}", 64, family=DISPLAY, weight=800, fill=GOAL))
        parts.append(_text(190, y - 10, f"{who} ({t.team})", 32, weight=600))
        parts.append(_text(190, y + 22, f"{t.team} playoff odds {_pp(t.ppa)}", 24, fill=INK_SOFT))
        y += 80
    parts.append(_text(1140, 590, "Aftershock", 40, family=DISPLAY, weight=800, anchor="end"))
    parts.append(_text(60, 600, ATTRIBUTION, 15, fill=INK_SOFT))
    return _svg(w, h, "".join(parts))
