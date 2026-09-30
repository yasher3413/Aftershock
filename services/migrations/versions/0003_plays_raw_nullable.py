"""plays.raw nullable

Revision ID: 0003_plays_raw_nullable
Revises: 0002_player_ppa_view
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0003_plays_raw_nullable"
down_revision: str | None = "0002_player_ppa_view"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("plays", "raw", nullable=True)


def downgrade() -> None:
    op.execute("UPDATE plays SET raw = '{}'::jsonb WHERE raw IS NULL")
    op.alter_column("plays", "raw", nullable=False)
