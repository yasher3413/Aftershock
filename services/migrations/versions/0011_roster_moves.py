"""saved Roster Lab moves: short ids for shared links (/roster-lab?id=...)

Revision ID: 0011_roster_moves
Revises: 0010_player_values
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_roster_moves"
down_revision: str | None = "0010_player_values"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "roster_moves",
        sa.Column("id", sa.String(length=16), primary_key=True),
        sa.Column("encoded", sa.Text(), nullable=False),
        sa.Column("digest", sa.String(length=64), nullable=False, unique=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("roster_moves")
