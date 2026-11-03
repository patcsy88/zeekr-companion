"""service record: reminder_id, so a replay is matched to its own reminder (ADR-009 review)

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("service_record", sa.Column("reminder_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_service_record_reminder_id_reminder"),
        "service_record",
        "reminder",
        ["reminder_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("fk_service_record_reminder_id_reminder"), "service_record", type_="foreignkey"
    )
    op.drop_column("service_record", "reminder_id")
