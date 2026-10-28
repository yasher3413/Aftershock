"""player values and lineups for the Roster Lab

``player_values`` is each player's worth from the player value model (five on
five RAPM, finishing, goalie GSAx) and his recent ice time. ``roster_spots``
is each team's current roster with who is dressing lately and how much.
Both are rebuilt by the nightly ``player-values`` job.

Revision ID: 0010_player_values
Revises: 0009_bot_posts
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010_player_values"
down_revision: str | None = "0009_bot_posts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "player_values",
        sa.Column("player_id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("position", sa.String(length=1), nullable=False),
        sa.Column("last_team", sa.String(length=3), nullable=True),
        sa.Column("off60", sa.Float(), nullable=False),
        sa.Column("def60", sa.Float(), nullable=False),
        sa.Column("finish_per_shot", sa.Float(), nullable=False),
        sa.Column("shots_per60", sa.Float(), nullable=False),
        sa.Column("gsax_per_shot", sa.Float(), nullable=False),
        sa.Column("ev_toi_pg", sa.Float(), nullable=False),
        sa.Column("pp_toi_pg", sa.Float(), nullable=False),
        sa.Column("games", sa.Integer(), nullable=False),
        sa.Column("model_version", sa.String(length=32), nullable=False),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "roster_spots",
        sa.Column("team", sa.String(length=3), primary_key=True),
        sa.Column("player_id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("position", sa.String(length=1), nullable=False),
        sa.Column("in_lineup", sa.Boolean(), nullable=False),
        sa.Column("ev_toi_pg", sa.Float(), nullable=False),
        sa.Column("pp_toi_pg", sa.Float(), nullable=False),
        sa.Column("toi_share", sa.Float(), nullable=False),
        sa.Column("computed_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("roster_spots")
    op.drop_table("player_values")
