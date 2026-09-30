"""Historical backfill: fetch into the raw cache, then load into Postgres.

Resumable at both levels: the fetch skips anything cached, and the loader
keeps a per-season cursor (the last game id whose plays were written) in
``ingest_cursors``.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from aftershock.db.models import Game, IngestCursor, JobRun
from aftershock.db.session import session_scope
from aftershock.ingest.fetch import GAME_TYPES, SeasonInfo, current_season, season_infos
from aftershock.ingest.load import (
    load_team_seasons,
    player_rows,
    replace_plays,
    seed_reference,
    update_game_states,
    upsert_games,
    upsert_players,
)
from aftershock.nhl.client import FINISHED_STATES, NhlClient
from aftershock.nhl.parse import ParsedGame, parse_play_by_play, parse_scheduled_game

log = structlog.get_logger(__name__)

BATCH = 50


async def _get_cursor(name: str) -> int:
    async with session_scope() as s:
        row = await s.get(IngestCursor, name)
        return int(row.value) if row else 0


async def _set_cursor(name: str, value: int) -> None:
    async with session_scope() as s:
        stmt = insert(IngestCursor).values(name=name, value=str(value))
        await s.execute(
            stmt.on_conflict_do_update(index_elements=["name"], set_={"value": str(value)})
        )


async def load_season(client: NhlClient, info: SeasonInfo, *, is_current: bool) -> dict[str, Any]:
    """Load one season's teams, games, plays, and players from the raw cache."""
    season = info.season
    final = not is_current
    standings = await client.standings(info.standings_end, final=final)
    teams = sorted(r["teamAbbrev"]["default"] for r in standings["standings"])
    raw_games: dict[int, dict[str, Any]] = {}
    ids: dict[str, int] = {}
    for team in teams:
        body = await client.club_schedule_season(team, season, final=final)
        for g in body.get("games", []):
            for side in ("homeTeam", "awayTeam"):
                ids[g[side]["abbrev"]] = int(g[side]["id"])
            if g.get("gameType") in GAME_TYPES:
                raw_games.setdefault(int(g["id"]), g)
    scheduled = [parse_scheduled_game(g) for _, g in sorted(raw_games.items())]
    async with session_scope() as s:
        await load_team_seasons(s, season, standings, ids)
        await upsert_games(s, scheduled)

    cursor_name = f"plays:{season}"
    cursor = 0 if is_current else await _get_cursor(cursor_name)
    todo = [g.id for g in scheduled if g.state in FINISHED_STATES and g.id > cursor]
    written = 0
    for i in range(0, len(todo), BATCH):
        parsed: list[ParsedGame] = []
        for gid in todo[i : i + BATCH]:
            raw = client.read_cache("play-by-play", str(gid))
            if raw is None:
                raw = await client.play_by_play(gid)
            parsed.append(parse_play_by_play(raw))
        async with session_scope() as s:
            conn = await s.connection()
            written += await replace_plays(conn, parsed, keep_raw=is_current)
            await update_game_states(s, (p.meta for p in parsed))
            await upsert_players(s, [r for p in parsed for r in player_rows(p)])
        if not is_current:
            await _set_cursor(cursor_name, todo[min(i + BATCH, len(todo)) - 1])
        if (i // BATCH) % 10 == 0:
            log.info(
                "load.progress", season=season, done=min(i + BATCH, len(todo)), total=len(todo)
            )
    return {"season": season, "games": len(scheduled), "games_loaded": len(todo), "plays": written}


async def run_backfill(first_season: int, last_season: int | None = None) -> None:
    started = time.monotonic()
    async with session_scope() as s:
        job = JobRun(
            job="backfill", status="running", detail={"from": first_season, "to": last_season}
        )
        s.add(job)
        await s.flush()
        job_id = job.id
        await seed_reference(s)
    results: list[dict[str, Any]] = []
    status = "ok"
    try:
        async with NhlClient() as client:
            infos = await season_infos(client)
            cur = current_season(infos)
            last = last_season or cur
            for season in sorted((x for x in infos if first_season <= x <= last), reverse=True):
                from aftershock.ingest.fetch import fetch_season

                await fetch_season(client, infos[season], is_current=season == cur)
                result = await load_season(client, infos[season], is_current=season == cur)
                log.info("backfill.season_done", **result)
                results.append(result)
    except BaseException:
        status = "error"
        raise
    finally:
        async with session_scope() as s:
            job_row = await s.get(JobRun, job_id)
            if job_row is not None:
                job_row.status = status
                job_row.finished_at = datetime.now(UTC)
                job_row.detail = {
                    **job_row.detail,
                    "seasons": results,
                    "seconds": round(time.monotonic() - started, 1),
                }


async def games_in_db(season: int) -> int:
    async with session_scope() as s:
        res = await s.execute(select(Game.id).where(Game.season == season))
        return len(res.all())
