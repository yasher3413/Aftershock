"""discipline and defense: penalties, giveaways, takeaways, plus/minus

All regular season, as the NHL defines these stats. Plus/minus follows the
NHL rule: even-strength and shorthanded goals count, power-play goals and
penalty shots do not.

Revision ID: 0007_discipline
Revises: 0006_bottom3
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_discipline"
down_revision: str | None = "0006_bottom3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Strength of the scoring team at a goal, from the NHL situation code
# (away goalie, away skaters, home skaters, home goalie). A pulled goalie's
# extra attacker does not make a power play.
_STRENGTH = """
    (CASE WHEN t.team = g.home THEN substr(p.situation_code, 3, 1)::int
                                   - (substr(p.situation_code, 4, 1) = '0')::int
          ELSE substr(p.situation_code, 2, 1)::int
               - (substr(p.situation_code, 1, 1) = '0')::int END)
  - (CASE WHEN t.team = g.home THEN substr(p.situation_code, 2, 1)::int
                                   - (substr(p.situation_code, 1, 1) = '0')::int
          ELSE substr(p.situation_code, 3, 1)::int
               - (substr(p.situation_code, 4, 1) = '0')::int END)
"""


def upgrade() -> None:
    op.create_table(
        "player_events",
        sa.Column("game_id", sa.BigInteger(), primary_key=True),
        sa.Column("event_id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(length=10), primary_key=True),
        sa.Column("season", sa.Integer(), nullable=False),
        sa.Column("player_id", sa.Integer(), nullable=False),
        sa.Column("team", sa.String(length=3), nullable=False),
        sa.Column("period", sa.Integer(), nullable=False),
        sa.Column("t_game_s", sa.Integer(), nullable=False),
        sa.Column("minutes", sa.Integer(), nullable=True),
        sa.Column("detail", sa.String(length=64), nullable=True),
        # The goal this event led to (a power-play goal during the penalty,
        # or a goal against within 10 s of a giveaway), and its PPA for
        # this player's team (negative for costs, positive for drawn).
        sa.Column("tremor_id", sa.BigInteger(), nullable=True),
        sa.Column("ppa", sa.Float(), nullable=True),
    )
    op.create_index("ix_player_events_player", "player_events", ["season", "player_id"])
    op.execute(
        """
        CREATE MATERIALIZED VIEW player_discipline_season AS
        SELECT season, player_id,
               mode() WITHIN GROUP (ORDER BY team) AS team,
               coalesce(sum(minutes) FILTER (WHERE kind = 'penalty'), 0) AS pim,
               count(*) FILTER (WHERE kind = 'penalty') AS penalties,
               count(*) FILTER (WHERE kind = 'drawn') AS drawn,
               coalesce(sum(ppa) FILTER (WHERE kind = 'penalty'), 0) AS penalty_ppa,
               count(tremor_id) FILTER (WHERE kind = 'penalty') AS penalty_goals,
               coalesce(sum(ppa) FILTER (WHERE kind = 'drawn'), 0) AS drawn_ppa,
               count(*) FILTER (WHERE kind = 'giveaway') AS giveaways,
               count(*) FILTER (WHERE kind = 'takeaway') AS takeaways,
               count(tremor_id) FILTER (WHERE kind = 'giveaway') AS costly_giveaways,
               coalesce(sum(ppa) FILTER (WHERE kind = 'giveaway'), 0) AS giveaway_ppa
        FROM player_events
        GROUP BY season, player_id
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_player_discipline ON player_discipline_season (season, player_id)"
    )
    op.execute(
        f"""
        CREATE MATERIALIZED VIEW player_plus_minus AS
        SELECT t.season, o.player_id,
               sum(CASE WHEN o.scored THEN 1 ELSE -1 END) AS plus_minus
        FROM tremor_on_ice o
        JOIN tremors t ON t.id = o.tremor_id
        JOIN games g ON g.id = t.game_id
        JOIN plays p ON p.game_id = t.game_id AND p.event_id = t.event_id
        WHERE NOT t.overturned AND NOT t.shootout AND g.game_type = 2
          AND p.situation_code ~ '^[0-9]{{4}}$'
          AND p.situation_code NOT IN ('1010', '0101')
          AND ({_STRENGTH}) <= 0
        GROUP BY t.season, o.player_id
        """
    )
    op.execute("CREATE UNIQUE INDEX uq_player_plus_minus ON player_plus_minus (season, player_id)")


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS player_plus_minus")
    op.execute("DROP MATERIALIZED VIEW IF EXISTS player_discipline_season")
    op.drop_index("ix_player_events_player", table_name="player_events")
    op.drop_table("player_events")
