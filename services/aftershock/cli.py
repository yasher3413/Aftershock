"""Command line entry point."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated

import typer

from aftershock import __version__
from aftershock.config import get_settings
from aftershock.logging import configure_logging

app = typer.Typer(help="Aftershock command line tools.", no_args_is_help=True)


@app.callback()
def main(json_logs: Annotated[bool, typer.Option(help="Emit JSON log lines.")] = False) -> None:
    """Aftershock command line tools."""
    configure_logging(get_settings().log_level, json_output=json_logs)


@app.command()
def version() -> None:
    """Print the package version."""
    typer.echo(__version__)


@app.command("record-live")
def record_live(
    hours: Annotated[float, typer.Option(help="Stop after this many hours.")] = 24.0,
    out: Annotated[Path | None, typer.Option(help="Output directory.")] = None,
) -> None:
    """Record every distinct live play-by-play response for tests."""
    from aftershock.nhl.client import NhlClient
    from aftershock.nhl.recorder import LiveRecorder

    settings = get_settings()
    out_dir = out or settings.data_dir / "recordings"

    async def run() -> None:
        async with NhlClient(settings) as client:
            recorder = LiveRecorder(
                client,
                out_dir,
                live_interval=settings.poll_live_seconds,
                score_interval=settings.poll_score_seconds,
            )
            await recorder.run(until=datetime.now(UTC) + timedelta(hours=hours))

    asyncio.run(run())


@app.command("fetch-raw")
def fetch_raw(
    from_season: Annotated[int, typer.Option(help="First season id, e.g. 20152016.")] = 20152016,
    to_season: Annotated[int | None, typer.Option(help="Last season id (default current).")] = None,
) -> None:
    """Fetch schedules, standings, and play-by-play into the raw cache."""
    from aftershock.ingest.fetch import fetch_all
    from aftershock.nhl.client import NhlClient

    async def run() -> None:
        async with NhlClient() as client:
            await fetch_all(client, from_season, to_season)

    asyncio.run(run())


@app.command()
def backfill(
    from_season: Annotated[int, typer.Option(help="First season id.")] = 20152016,
    to_season: Annotated[int | None, typer.Option(help="Last season id (default current).")] = None,
) -> None:
    """Fetch and load history into Postgres (resumable)."""
    from aftershock.jobs.backfill import run_backfill

    asyncio.run(run_backfill(from_season, to_season))


train_app = typer.Typer(help="Train models and write evaluation reports.", no_args_is_help=True)
app.add_typer(train_app, name="train")


@train_app.command("xg")
def train_xg(
    build: Annotated[bool, typer.Option(help="Rebuild feature tables first.")] = True,
) -> None:
    """Train the expected-goals model."""
    from aftershock.ml import xg

    if build:
        for year in (*xg.TRAIN_SEASONS, xg.VAL_SEASON, xg.TEST_SEASON):
            xg.build_season_features(year)
    xg.train()
    xg.train_backtest_variant()


@train_app.command("strength")
def train_strength(
    build: Annotated[bool, typer.Option(help="Rebuild the per-game tables first.")] = True,
) -> None:
    """Tune and backtest the team-strength model."""
    from aftershock.ml import games_table, strength_fit, xg

    if build:
        games_table.build_games_table(xg.BACKTEST_VERSION)
        games_table.build_games_table(xg.MODEL_VERSION)
    strength_fit.fit()


@train_app.command("wp")
def train_wp(
    build: Annotated[bool, typer.Option(help="Rebuild feature tables first.")] = True,
) -> None:
    """Train and evaluate the in-game win-probability model."""
    from aftershock.ml import strength_fit, wp, xg

    years = (*wp.TRAIN_SEASONS, wp.VAL_SEASON, wp.TEST_SEASON)
    if build:
        pregame = strength_fit.asof_pregame(xg.MODEL_VERSION)
        for year in years:
            wp.build_season_features(year, pregame, xg.MODEL_VERSION)
    ot = wp.measure_overtime(wp.TRAIN_SEASONS)
    wp.train(ot)


@train_app.command("all")
def train_all() -> None:
    """Train xG, then team strength, then win probability."""
    train_xg(build=True)
    train_strength(build=True)
    train_wp(build=True)
