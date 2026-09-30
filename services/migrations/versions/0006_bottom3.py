"""team_odds.p_bottom3

Revision ID: 0006_bottom3
Revises: 0005_on_ice
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_bottom3"
down_revision: str | None = "0005_on_ice"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "team_odds", sa.Column("p_bottom3", sa.Float(), nullable=False, server_default="0")
    )


def downgrade() -> None:
    op.drop_column("team_odds", "p_bottom3")
