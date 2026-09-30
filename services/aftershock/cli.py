"""Command line entry point."""

import typer

from aftershock import __version__

app = typer.Typer(help="Aftershock command line tools.", no_args_is_help=True)


@app.callback()
def main() -> None:
    """Aftershock command line tools."""


@app.command()
def version() -> None:
    """Print the package version."""
    typer.echo(__version__)
