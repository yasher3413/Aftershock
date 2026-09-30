"""on-ice PPA

Revision ID: 0005_on_ice
Revises: 0004_push_subscriptions
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_on_ice"
down_revision: str | None = "0004_push_subscriptions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tremor_on_ice",
        sa.Column(
            "tremor_id",
            sa.BigInteger(),
            sa.ForeignKey("tremors.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("player_id", sa.Integer(), primary_key=True),
        sa.Column("team", sa.String(length=3), nullable=False),
        sa.Column("scored", sa.Boolean(), nullable=False),
    )
    op.execute(
        """
        CREATE MATERIALIZED VIEW player_onice_ppa AS
        SELECT t.season, o.player_id,
               count(*) FILTER (WHERE o.scored) AS goals_for,
               count(*) FILTER (WHERE NOT o.scored) AS goals_against,
               sum(CASE WHEN o.scored THEN (t.deltas -> o.team ->> 'd_playoffs')::float
                        ELSE (t.deltas -> o.team ->> 'd_playoffs')::float END) AS on_ice_ppa,
               mode() WITHIN GROUP (ORDER BY o.team) AS team
        FROM tremor_on_ice o JOIN tremors t ON t.id = o.tremor_id
        WHERE NOT t.overturned AND NOT t.shootout
        GROUP BY t.season, o.player_id
        """
    )
    op.execute("CREATE UNIQUE INDEX uq_player_onice ON player_onice_ppa (season, player_id)")


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS player_onice_ppa")
    op.drop_table("tremor_on_ice")
