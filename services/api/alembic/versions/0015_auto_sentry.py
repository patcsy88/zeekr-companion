"""automatic Sentry on (ADR-011): one settings row, and the command log learns 'auto' and 'skipped'

New table auto_sentry_settings, at most one row (id is fixed at 1). In car_command_log the source
check also allows 'auto', the result check also allows 'skipped', and skip_reason is new. A skipped
row is not a command: nothing was sent. Downgrade deletes the automatic and skipped rows first.

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TABLE = "car_command_log"
OLD_SOURCE = "source IN ('manual')"
NEW_SOURCE = "source IN ('manual', 'auto')"
OLD_RESULT = "result IN ('sent', 'refused', 'failed')"
NEW_RESULT = "result IN ('sent', 'refused', 'failed', 'skipped')"
SKIP_REASON = "skip_reason IS NULL OR skip_reason IN ('quiet_period', 'host_off', 'busy')"
SKIP_MATCHES = "(result = 'skipped') = (skip_reason IS NOT NULL)"
SKIP_IS_AUTO = "result <> 'skipped' OR source = 'auto'"


def _swap(name: str, expression: str) -> None:
    constraint = op.f(f"ck_{TABLE}_{name}")
    op.drop_constraint(constraint, TABLE, type_="check")
    op.create_check_constraint(constraint, TABLE, sa.text(expression))


def upgrade() -> None:
    op.create_table(
        "auto_sentry_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("quiet_minutes", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name=op.f("ck_auto_sentry_settings_single_row")),
        sa.CheckConstraint(
            "quiet_minutes BETWEEN 5 AND 1440", name=op.f("ck_auto_sentry_settings_quiet_valid")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auto_sentry_settings")),
    )
    op.add_column(TABLE, sa.Column("skip_reason", sa.String(length=12), nullable=True))
    _swap("source_valid", NEW_SOURCE)
    _swap("result_valid", NEW_RESULT)
    op.create_check_constraint(op.f(f"ck_{TABLE}_skip_reason_valid"), TABLE, sa.text(SKIP_REASON))
    op.create_check_constraint(
        op.f(f"ck_{TABLE}_skip_reason_matches_result"), TABLE, sa.text(SKIP_MATCHES)
    )
    op.create_check_constraint(op.f(f"ck_{TABLE}_skipped_is_auto"), TABLE, sa.text(SKIP_IS_AUTO))


def downgrade() -> None:
    op.execute("DELETE FROM car_command_log WHERE source = 'auto' OR result = 'skipped'")
    op.drop_constraint(op.f(f"ck_{TABLE}_skipped_is_auto"), TABLE, type_="check")
    op.drop_constraint(op.f(f"ck_{TABLE}_skip_reason_matches_result"), TABLE, type_="check")
    op.drop_constraint(op.f(f"ck_{TABLE}_skip_reason_valid"), TABLE, type_="check")
    _swap("result_valid", OLD_RESULT)
    _swap("source_valid", OLD_SOURCE)
    op.drop_column(TABLE, "skip_reason")
    op.drop_table("auto_sentry_settings")
