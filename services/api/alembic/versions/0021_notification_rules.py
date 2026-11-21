"""notification rules (ADR-015, owner approved 2026-11-21)

New table notification_rules: up to 5 owner-defined rules. Each holds the owner's label, AND/OR,
one to four conditions (fixed fields and codes, a radius for the location condition) and a
cooldown. Only the last true/false result, one fixed result phrase and the last send time are kept.
No vehicle reading, position, distance, home or office is stored. Downgrade drops the table, so
every rule is lost.

Revision ID: 0021
Revises: 0020
Create Date: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_RESULTS = (
    "'matched, sent', 'matched, held by cooldown', 'not matched', 'no reading', "
    "'reading too old', 'home not set', 'push not set up'"
)


def upgrade() -> None:
    op.create_table(
        "notification_rules",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("match", sa.Text(), server_default="all", nullable=False),
        sa.Column("conditions", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("cooldown_minutes", sa.Integer(), server_default="10", nullable=False),
        sa.Column("last_matched", sa.Boolean(), nullable=True),
        sa.Column("last_result", sa.Text(), nullable=True),
        sa.Column("last_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_notification_rules")),
        sa.CheckConstraint(
            "char_length(name) BETWEEN 1 AND 60", name=op.f("ck_notification_rules_name_valid")
        ),
        sa.CheckConstraint(
            "match IN ('all', 'any')", name=op.f("ck_notification_rules_match_valid")
        ),
        sa.CheckConstraint(
            "jsonb_typeof(conditions) = 'array' AND jsonb_array_length(conditions) BETWEEN 1 AND 4",
            name=op.f("ck_notification_rules_conditions_valid"),
        ),
        sa.CheckConstraint(
            "cooldown_minutes BETWEEN 0 AND 1440",
            name=op.f("ck_notification_rules_cooldown_valid"),
        ),
        sa.CheckConstraint(
            f"last_result IS NULL OR last_result IN ({_RESULTS})",
            name=op.f("ck_notification_rules_result_valid"),
        ),
    )


def downgrade() -> None:
    op.drop_table("notification_rules")
