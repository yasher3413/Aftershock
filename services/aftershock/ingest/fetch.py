"""Fetch raw NHL data into the on-disk cache.

This is the network half of the backfill. It pulls season metadata, final
standings, every team's season schedule, and the play-by-play of every
finished regular-season and playoff game. Everything immutable is cached
gzipped, so the job is resumable: rerunning it only fetches what is missing.
Loading the cache into Postgres is a separate step (see ``ingest.load``).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import date
from typing import Any

import structlog

from aftershock.nhl.client import FINISHED_STATES, NhlClient, NhlNotFound

log = structlog.get_logger(__name__)

GAME_TYPES = (2, 3)


@dataclass(frozen=True)
class SeasonInfo:
    season: int
    standings_start: date
    standings_end: date


async def season_infos(client: NhlClient) -> dict[int, SeasonInfo]:
    body = await client.standings_seasons()
    out: dict[int, SeasonInfo] = {}
    for row in body["seasons"]:
        out[int(row["id"])] = SeasonInfo(
            season=int(row["id"]),
            standings_start=date.fromisoformat(row["standingsStart"]),
            standings_end=date.fromisoformat(row["standingsEnd"]),
        )
    return out


def current_season(infos: dict[int, SeasonInfo]) -> int:
    return max(infos)


async def season_teams(client: NhlClient, info: SeasonInfo, *, final: bool) -> list[str]:
    body = await client.standings(info.standings_end, final=final)
    return sorted(row["teamAbbrev"]["default"] for row in body["standings"])


async def season_games(
    client: NhlClient, season: int, teams: list[str], *, final: bool
) -> dict[int, dict[str, Any]]:
    """All regular-season and playoff games of ``season``, deduped by id."""
    games: dict[int, dict[str, Any]] = {}

    async def one(team: str) -> None:
        try:
            body = await client.club_schedule_season(team, season, final=final)
        except NhlNotFound:
            log.warning("fetch.no_club_schedule", team=team, season=season)
            return
        for game in body.get("games", []):
            if game.get("gameType") in GAME_TYPES:
                games.setdefault(int(game["id"]), game)

    await asyncio.gather(*(one(t) for t in teams))
    return dict(sorted(games.items()))


async def fetch_season(client: NhlClient, info: SeasonInfo, *, is_current: bool) -> dict[str, int]:
    final = not is_current
    teams = await season_teams(client, info, final=final)
    games = await season_games(client, info.season, teams, final=final)
    finished = [gid for gid, g in games.items() if g.get("gameState") in FINISHED_STATES]
    missing = [gid for gid in finished if client.read_cache("play-by-play", str(gid)) is None]
    log.info(
        "fetch.season",
        season=info.season,
        teams=len(teams),
        games=len(games),
        finished=len(finished),
        to_fetch=len(missing),
    )

    done = 0

    async def pbp(gid: int) -> None:
        nonlocal done
        try:
            await client.play_by_play(gid)
        except NhlNotFound:
            log.warning("fetch.pbp_missing", game=gid)
        done += 1
        if done % 200 == 0:
            log.info("fetch.progress", season=info.season, done=done, total=len(missing))

    # Bounded by the client's semaphore and rate limiter; chunk to keep memory flat.
    for i in range(0, len(missing), 64):
        await asyncio.gather(*(pbp(g) for g in missing[i : i + 64]))
    return {"teams": len(teams), "games": len(games), "fetched": len(missing)}


async def fetch_all(client: NhlClient, first_season: int, last_season: int | None = None) -> None:
    infos = await season_infos(client)
    cur = current_season(infos)
    last = last_season or cur
    # Newest first: the current and last two seasons matter most and land soonest.
    for season in sorted((s for s in infos if first_season <= s <= last), reverse=True):
        result = await fetch_season(client, infos[season], is_current=season == cur)
        log.info("fetch.season_done", season=season, **result)
