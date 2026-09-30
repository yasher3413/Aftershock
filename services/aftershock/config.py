"""Runtime settings, read from the environment (and `.env` at the repo root)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    database_url: str = "postgresql+asyncpg://aftershock:aftershock@localhost:55432/aftershock"
    redis_url: str = "redis://localhost:6379/0"
    nhl_api_base: str = "https://api-web.nhle.com/v1"
    nhl_stats_api_base: str = "https://api.nhle.com/stats/rest/en"
    poll_live_seconds: float = 5.0
    poll_score_seconds: float = 30.0
    poll_pregame_seconds: float = 60.0
    sim_n: int = 20_000
    sim_n_backfill: int = 5_000
    demo_mode: Literal["auto", "on", "off"] = "auto"
    anthropic_api_key: str = ""
    recap_model: str = "claude-sonnet-5-5"
    public_base_url: str = "http://localhost:8080"
    repo_url: str = "https://github.com/yasher3413/Aftershock"
    log_level: str = "INFO"
    # Web push (optional). Generate with `aftershock vapid-keys`.
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:aftershock@example.com"
    # Discord webhook for magnitude 6+ tremors (optional).
    discord_webhook_url: str = ""

    data_dir: Path = REPO_ROOT / "data"
    config_dir: Path = REPO_ROOT / "config"
    ml_dir: Path = REPO_ROOT / "ml"

    # NHL API politeness (section 4.5 of the brief).
    nhl_max_concurrency: int = 4
    nhl_max_rps: float = 8.0
    nhl_timeout_seconds: float = 10.0
    nhl_max_tries: int = 6

    @property
    def raw_cache_dir(self) -> Path:
        return self.data_dir / "raw"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
