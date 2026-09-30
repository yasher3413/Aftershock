"""SQLAlchemy models. All times are UTC. See docs/ARCHITECTURE.md for the data flow."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def _now() -> Any:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Team(Base):
    __tablename__ = "teams"
    abbrev: Mapped[str] = mapped_column(String(3), primary_key=True)
    nhl_id: Mapped[int] = mapped_column(Integer, unique=True)
    name: Mapped[str] = mapped_column(String(64))
    conference: Mapped[str] = mapped_column(String(16))
    division: Mapped[str] = mapped_column(String(16))
    arena: Mapped[str] = mapped_column(String(96))
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    color_primary: Mapped[str] = mapped_column(String(7))
    color_secondary: Mapped[str] = mapped_column(String(7))


class TeamSeason(Base):
    __tablename__ = "team_seasons"
    season: Mapped[int] = mapped_column(Integer, primary_key=True)
    abbrev: Mapped[str] = mapped_column(String(3), primary_key=True)
    nhl_id: Mapped[int | None] = mapped_column(Integer)
    conference: Mapped[str] = mapped_column(String(16))
    division: Mapped[str] = mapped_column(String(16))


class Venue(Base):
    __tablename__ = "venues"
    name: Mapped[str] = mapped_column(String(96), primary_key=True)
    city: Mapped[str] = mapped_column(String(96))
    country: Mapped[str] = mapped_column(String(2))
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    home_team: Mapped[str | None] = mapped_column(String(3))


class Game(Base):
    __tablename__ = "games"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    season: Mapped[int] = mapped_column(Integer, index=True)
    game_type: Mapped[int] = mapped_column(SmallInteger)
    night_date: Mapped[date] = mapped_column(Date, index=True)
    start_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    home: Mapped[str] = mapped_column(String(3))
    away: Mapped[str] = mapped_column(String(3))
    venue: Mapped[str | None] = mapped_column(String(96))
    neutral_site: Mapped[bool] = mapped_column(Boolean, default=False)
    state: Mapped[str] = mapped_column(String(8))
    schedule_state: Mapped[str | None] = mapped_column(String(8))
    period: Mapped[int | None] = mapped_column(SmallInteger)
    period_type: Mapped[str | None] = mapped_column(String(3))
    clock_seconds: Mapped[int | None] = mapped_column(Integer)
    in_intermission: Mapped[bool] = mapped_column(Boolean, default=False)
    home_score: Mapped[int | None] = mapped_column(SmallInteger)
    away_score: Mapped[int | None] = mapped_column(SmallInteger)
    home_sog: Mapped[int | None] = mapped_column(SmallInteger)
    away_sog: Mapped[int | None] = mapped_column(SmallInteger)
    last_period_type: Mapped[str | None] = mapped_column(String(3))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_games_season_type", "season", "game_type"),
        Index("ix_games_home", "home"),
        Index("ix_games_away", "away"),
    )


class Play(Base):
    __tablename__ = "plays"
    game_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("games.id", ondelete="CASCADE"), primary_key=True
    )
    event_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sort_order: Mapped[int] = mapped_column(Integer)
    period: Mapped[int] = mapped_column(SmallInteger)
    period_type: Mapped[str] = mapped_column(String(3))
    t_period_s: Mapped[int] = mapped_column(SmallInteger)
    t_game_s: Mapped[int] = mapped_column(Integer)
    situation_code: Mapped[str | None] = mapped_column(String(4))
    type: Mapped[str] = mapped_column(String(24))
    owner_team: Mapped[str | None] = mapped_column(String(3))
    x: Mapped[float | None] = mapped_column(Float)
    y: Mapped[float | None] = mapped_column(Float)
    x_norm: Mapped[float | None] = mapped_column(Float)
    y_norm: Mapped[float | None] = mapped_column(Float)
    zone: Mapped[str | None] = mapped_column(String(1))
    shot_type: Mapped[str | None] = mapped_column(String(16))
    shooter_id: Mapped[int | None] = mapped_column(Integer)
    scorer_id: Mapped[int | None] = mapped_column(Integer)
    assist1_id: Mapped[int | None] = mapped_column(Integer)
    assist2_id: Mapped[int | None] = mapped_column(Integer)
    goalie_id: Mapped[int | None] = mapped_column(Integer)
    home_score: Mapped[int | None] = mapped_column(SmallInteger)
    away_score: Mapped[int | None] = mapped_column(SmallInteger)
    penalty_minutes: Mapped[int | None] = mapped_column(SmallInteger)
    # Full event JSON, kept only for live-season games (see docs/DECISIONS.md).
    raw: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    content_hash: Mapped[str] = mapped_column(String(16))
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    first_seen_at: Mapped[datetime] = _now()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_plays_game_sort", "game_id", "sort_order"),
        Index("ix_plays_type", "type"),
        Index("ix_plays_scorer", "scorer_id"),
    )


class Player(Base):
    __tablename__ = "players"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    name: Mapped[str] = mapped_column(String(96))
    position: Mapped[str | None] = mapped_column(String(2))
    shoots_catches: Mapped[str | None] = mapped_column(String(1))
    current_team: Mapped[str | None] = mapped_column(String(3))
    sweater: Mapped[int | None] = mapped_column(SmallInteger)


class ShotXg(Base):
    __tablename__ = "shot_xg"
    game_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    event_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    xg: Mapped[float] = mapped_column(Float)
    model_version: Mapped[str] = mapped_column(String(32))


class Rating(Base):
    __tablename__ = "ratings"
    as_of_date: Mapped[date] = mapped_column(Date, primary_key=True)
    team: Mapped[str] = mapped_column(String(3), primary_key=True)
    off: Mapped[float] = mapped_column(Float)
    def_: Mapped[float] = mapped_column("def", Float)
    model_version: Mapped[str] = mapped_column(String(32))


class GamePregame(Base):
    __tablename__ = "game_pregame"
    game_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    p_home_reg: Mapped[float] = mapped_column(Float)
    p_away_reg: Mapped[float] = mapped_column(Float)
    p_home_ot: Mapped[float] = mapped_column(Float)
    p_away_ot: Mapped[float] = mapped_column(Float)
    p_home_so: Mapped[float] = mapped_column(Float)
    p_away_so: Mapped[float] = mapped_column(Float)
    exp_home_goals: Mapped[float] = mapped_column(Float)
    exp_away_goals: Mapped[float] = mapped_column(Float)
    model_version: Mapped[str] = mapped_column(String(32))


class WpTimeline(Base):
    __tablename__ = "wp_timeline"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    game_id: Mapped[int] = mapped_column(BigInteger, index=True)
    t_game_s: Mapped[int] = mapped_column(Integer)
    event_id: Mapped[int | None] = mapped_column(Integer)
    p_home_reg: Mapped[float] = mapped_column(Float)
    p_away_reg: Mapped[float] = mapped_column(Float)
    p_home_ot: Mapped[float] = mapped_column(Float)
    p_away_ot: Mapped[float] = mapped_column(Float)
    p_home_so: Mapped[float] = mapped_column(Float)
    p_away_so: Mapped[float] = mapped_column(Float)
    model_version: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = _now()


class SimRun(Base):
    __tablename__ = "sim_runs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    season: Mapped[int] = mapped_column(Integer, index=True)
    created_at: Mapped[datetime] = _now()
    as_of: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    trigger: Mapped[str] = mapped_column(String(24))
    trigger_ref: Mapped[str | None] = mapped_column(String(64))
    n_sims: Mapped[int] = mapped_column(Integer)
    seed: Mapped[int] = mapped_column(BigInteger)
    state_hash: Mapped[str] = mapped_column(String(64))
    duration_ms: Mapped[float] = mapped_column(Float)


class TeamOdds(Base):
    __tablename__ = "team_odds"
    sim_run_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("sim_runs.id", ondelete="CASCADE"), primary_key=True
    )
    team: Mapped[str] = mapped_column(String(3), primary_key=True)
    p_playoffs: Mapped[float] = mapped_column(Float)
    p_division: Mapped[float] = mapped_column(Float)
    p_top3_div: Mapped[float] = mapped_column(Float)
    p_wildcard: Mapped[float] = mapped_column(Float)
    p_presidents: Mapped[float] = mapped_column(Float)
    p_conf_first: Mapped[float] = mapped_column(Float)
    p_round2: Mapped[float] = mapped_column(Float)
    p_conf_final: Mapped[float] = mapped_column(Float)
    p_final: Mapped[float] = mapped_column(Float)
    p_cup: Mapped[float] = mapped_column(Float)
    p_last: Mapped[float] = mapped_column(Float)
    p_bottom3: Mapped[float] = mapped_column(Float, server_default="0")
    exp_points: Mapped[float] = mapped_column(Float)
    points_hist: Mapped[dict[str, Any]] = mapped_column(JSONB)
    seed_dist: Mapped[dict[str, Any]] = mapped_column(JSONB)

    __table_args__ = (Index("ix_team_odds_team", "team"),)


class Tremor(Base):
    __tablename__ = "tremors"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    season: Mapped[int] = mapped_column(Integer)
    game_id: Mapped[int] = mapped_column(BigInteger, index=True)
    event_id: Mapped[int] = mapped_column(Integer)
    team: Mapped[str] = mapped_column(String(3))
    opponent: Mapped[str] = mapped_column(String(3))
    scorer_id: Mapped[int | None] = mapped_column(Integer)
    assist1_id: Mapped[int | None] = mapped_column(Integer)
    assist2_id: Mapped[int | None] = mapped_column(Integer)
    goalie_id: Mapped[int | None] = mapped_column(Integer)
    period: Mapped[int] = mapped_column(SmallInteger)
    period_type: Mapped[str] = mapped_column(String(3))
    t_period_s: Mapped[int] = mapped_column(SmallInteger)
    t_game_s: Mapped[int] = mapped_column(Integer)
    shootout: Mapped[bool] = mapped_column(Boolean, default=False)
    score_before: Mapped[dict[str, Any]] = mapped_column(JSONB)
    score_after: Mapped[dict[str, Any]] = mapped_column(JSONB)
    wp_before: Mapped[dict[str, Any]] = mapped_column(JSONB)
    wp_after: Mapped[dict[str, Any]] = mapped_column(JSONB)
    deltas: Mapped[dict[str, Any]] = mapped_column(JSONB)
    total_shift: Mapped[float] = mapped_column(Float)
    magnitude: Mapped[float] = mapped_column(Float, index=True)
    ppa: Mapped[float] = mapped_column(Float)
    cpa: Mapped[float] = mapped_column(Float)
    origin_venue: Mapped[str | None] = mapped_column(String(96))
    origin_lat: Mapped[float | None] = mapped_column(Float)
    origin_lon: Mapped[float | None] = mapped_column(Float)
    sim_run_before: Mapped[int | None] = mapped_column(BigInteger)
    sim_run_after: Mapped[int | None] = mapped_column(BigInteger)
    overturned: Mapped[bool] = mapped_column(Boolean, default=False)
    night_date: Mapped[date] = mapped_column(Date, index=True)
    created_at: Mapped[datetime] = _now()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("uq_tremors_game_event", "game_id", "event_id", unique=True),
        Index("ix_tremors_season_mag", "season", "magnitude"),
        Index("ix_tremors_team", "team"),
    )


class ConditionalTable(Base):
    """One compact blob per sim run: P(team outcome | focus game outcome)."""

    __tablename__ = "conditional_tables"
    sim_run_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("sim_runs.id", ondelete="CASCADE"), primary_key=True
    )
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)


class RootingGuide(Base):
    __tablename__ = "rooting_guides"
    sim_run_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("sim_runs.id", ondelete="CASCADE"), primary_key=True
    )
    team: Mapped[str] = mapped_column(String(3), primary_key=True)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)


class ReplayBundle(Base):
    __tablename__ = "replay_bundles"
    night_date: Mapped[date] = mapped_column(Date, primary_key=True)
    season: Mapped[int] = mapped_column(Integer, index=True)
    path: Mapped[str] = mapped_column(Text)
    total_energy: Mapped[float] = mapped_column(Float)
    n_games: Mapped[int] = mapped_column(SmallInteger)
    n_tremors: Mapped[int] = mapped_column(SmallInteger)
    built_at: Mapped[datetime] = _now()


class Recap(Base):
    __tablename__ = "recaps"
    night_date: Mapped[date] = mapped_column(Date, primary_key=True)
    headline: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)
    model: Mapped[str] = mapped_column(String(64))
    validated: Mapped[bool] = mapped_column(Boolean)
    created_at: Mapped[datetime] = _now()


class IngestCursor(Base):
    __tablename__ = "ingest_cursors"
    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class JobRun(Base):
    __tablename__ = "job_runs"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    job: Mapped[str] = mapped_column(String(64), index=True)
    started_at: Mapped[datetime] = _now()
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16))
    detail: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)


class ReconcileEvent(Base):
    """A mismatch between computed standings or scores and the API."""

    __tablename__ = "reconcile_events"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    created_at: Mapped[datetime] = _now()
    kind: Mapped[str] = mapped_column(String(32))
    detail: Mapped[dict[str, Any]] = mapped_column(JSONB)


class PushSubscription(Base):
    """A browser that asked to be told about big tremors involving a team."""

    __tablename__ = "push_subscriptions"
    endpoint: Mapped[str] = mapped_column(Text, primary_key=True)
    keys: Mapped[dict[str, Any]] = mapped_column(JSONB)
    team: Mapped[str] = mapped_column(String(3), index=True)
    min_magnitude: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = _now()


class TremorOnIce(Base):
    """A skater on the ice for a goal (from shift charts)."""

    __tablename__ = "tremor_on_ice"
    tremor_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tremors.id", ondelete="CASCADE"), primary_key=True
    )
    player_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    team: Mapped[str] = mapped_column(String(3))
    scored: Mapped[bool] = mapped_column(Boolean)
