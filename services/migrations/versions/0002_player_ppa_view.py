"""player_ppa_season materialized view

Revision ID: 0002_player_ppa_view
Revises: 62484e322cba
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0002_player_ppa_view"
down_revision: str | None = "62484e322cba"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

VIEW_SQL = """
CREATE MATERIALIZED VIEW player_ppa_season AS
WITH t AS (
    SELECT * FROM tremors WHERE NOT overturned AND NOT shootout
),
scorers AS (
    SELECT season, scorer_id AS player_id, count(*) AS goals,
           sum(ppa) AS ppa, sum(cpa) AS cpa
    FROM t WHERE scorer_id IS NOT NULL GROUP BY 1, 2
),
assists AS (
    SELECT season, pid AS player_id, count(*) AS assists, sum(ppa) AS assist_ppa
    FROM (
        SELECT season, assist1_id AS pid, ppa FROM t
        UNION ALL
        SELECT season, assist2_id AS pid, ppa FROM t
    ) a
    WHERE pid IS NOT NULL GROUP BY 1, 2
),
goalies AS (
    SELECT season, goalie_id AS player_id, count(*) AS goals_allowed,
           sum((deltas -> opponent ->> 'd_playoffs')::float) AS goalie_ppa_allowed
    FROM t WHERE goalie_id IS NOT NULL GROUP BY 1, 2
)
SELECT season, player_id,
       coalesce(goals, 0) AS goals,
       coalesce(ppa, 0) AS ppa,
       coalesce(cpa, 0) AS cpa,
       coalesce(assists, 0) AS assists,
       coalesce(assist_ppa, 0) AS assist_ppa,
       coalesce(goals_allowed, 0) AS goals_allowed,
       coalesce(goalie_ppa_allowed, 0) AS goalie_ppa_allowed
FROM scorers
FULL JOIN assists USING (season, player_id)
FULL JOIN goalies USING (season, player_id)
"""


def upgrade() -> None:
    op.execute(VIEW_SQL)
    op.execute("CREATE UNIQUE INDEX uq_player_ppa_season ON player_ppa_season (season, player_id)")
    op.execute("CREATE INDEX ix_player_ppa_season_ppa ON player_ppa_season (season, ppa DESC)")


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS player_ppa_season")
