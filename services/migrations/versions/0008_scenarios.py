"""saved What-If scenarios, for short share links

A scenario's picks can run to thousands of characters, too long for a post
on X, so a share link names a short id instead. ``digest`` (sha256 of the
canonical encoding) makes saving the same picks twice return the same id.

Revision ID: 0008_scenarios
Revises: 0007_discipline
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_scenarios"
down_revision: str | None = "0007_discipline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "scenarios",
        sa.Column("id", sa.String(length=16), primary_key=True),
        sa.Column("encoded", sa.Text(), nullable=False),
        sa.Column("digest", sa.String(length=64), nullable=False, unique=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("scenarios")
