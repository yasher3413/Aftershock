"""goal bot posts on X: one row per goal posted (or logged in a dry run)

The row makes posting exactly-once across restarts and duplicate messages,
and lets an overturned goal's post be deleted and a credit change answered
with a reply. The names are as posted, so a correction can say what changed.

Revision ID: 0009_bot_posts
Revises: 0008_scenarios
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009_bot_posts"
down_revision: str | None = "0008_scenarios"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "bot_posts",
        sa.Column("tremor_id", sa.BigInteger(), primary_key=True),
        sa.Column("post_id", sa.Text(), nullable=True),
        sa.Column("mode", sa.String(length=8), nullable=False),
        sa.Column("scorer", sa.Text(), nullable=True),
        sa.Column("assist1", sa.Text(), nullable=True),
        sa.Column("assist2", sa.Text(), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("deleted", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("bot_posts")
