"""Short links for What-If Lab scenarios.

The Lab keeps a scenario's picks in the address (``?s=2026020170.hr_...``),
which grows by 14 characters a pick. Saving the picks gives a short id for
``/what-if?id=...`` instead.
"""

from __future__ import annotations

import hashlib
import re
import secrets
import string

from starlette.requests import Request

CODES = ("hr", "ho", "hs", "ar", "ao", "as")
# A whole regular season is 1,312 games; anything longer is not a scenario.
MAX_PICKS = 1400
MAX_CHARS = MAX_PICKS * 15
ID_ALPHABET = string.ascii_letters + string.digits
ID_LENGTH = 8
ID_RE = re.compile(rf"[A-Za-z0-9]{{{ID_LENGTH}}}")
_PART = re.compile(r"(\d{10})\.(hr|ho|hs|ar|ao|as)")

# Saves allowed per visitor in each window (light, against scripted floods).
RATE_LIMIT = 30
RATE_WINDOW_S = 600


def canonical(encoded: str) -> tuple[str, list[int]]:
    """The picks sorted by game with duplicates refused, and their game ids.
    Raises ValueError on anything that is not a scenario."""
    if not encoded or len(encoded) > MAX_CHARS:
        raise ValueError("A scenario is between 1 and 1,400 picks.")
    picks: dict[int, str] = {}
    for part in encoded.split("_"):
        m = _PART.fullmatch(part)
        if m is None:
            raise ValueError(f"Not a pick: {part[:20]!r}")
        game = int(m.group(1))
        if game in picks:
            raise ValueError(f"Game {game} is picked twice.")
        picks[game] = m.group(2)
    if len(picks) > MAX_PICKS:
        raise ValueError("A scenario is between 1 and 1,400 picks.")
    games = sorted(picks)
    return "_".join(f"{g}.{picks[g]}" for g in games), games


def digest(encoded: str) -> str:
    return hashlib.sha256(encoded.encode("ascii")).hexdigest()


def new_id() -> str:
    return "".join(secrets.choice(ID_ALPHABET) for _ in range(ID_LENGTH))


def client_ip(request: Request) -> str:
    """The visitor's address. Requests arrive through Vercel and Caddy, and
    Caddy replaces X-Forwarded-For with Vercel's address, so Vercel's own
    headers come first."""
    for header in ("x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"):
        value = request.headers.get(header)
        if value:
            return value.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
