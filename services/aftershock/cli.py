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
