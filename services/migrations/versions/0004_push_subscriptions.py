"""push subscriptions

Revision ID: 0004_push_subscriptions
Revises: 0003_plays_raw_nullable
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004_push_subscriptions"
down_revision: str | None = "0003_plays_raw_nullable"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "push_subscriptions",
        sa.Column("endpoint", sa.Text(), primary_key=True),
        sa.Column("keys", postgresql.JSONB(), nullable=False),
        sa.Column("team", sa.String(length=3), nullable=False),
        sa.Column("min_magnitude", sa.Float(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("ix_push_subscriptions_team", "push_subscriptions", ["team"])


def downgrade() -> None:
    op.drop_table("push_subscriptions")
