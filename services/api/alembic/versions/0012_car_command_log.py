"""car command log (ADR-010)

One table for the commands sent from the app. No payload, reply body, VIN or position.

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "car_command_log",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("desired", sa.String(length=3), nullable=False),
        sa.Column("source", sa.String(length=10), nullable=False),
        sa.Column("result", sa.String(length=10), nullable=False),
        sa.Column("state_after", sa.String(length=3), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_car_command_log")),
        sa.CheckConstraint(
            "desired IN ('on', 'off')", name=op.f("ck_car_command_log_desired_valid")
        ),
        sa.CheckConstraint("source IN ('manual')", name=op.f("ck_car_command_log_source_valid")),
        sa.CheckConstraint(
            "result IN ('sent', 'refused', 'failed')",
            name=op.f("ck_car_command_log_result_valid"),
        ),
        sa.CheckConstraint(
            "state_after IS NULL OR state_after IN ('on', 'off')",
            name=op.f("ck_car_command_log_state_after_valid"),
        ),
    )
    op.create_index("ix_car_command_log_created_at", "car_command_log", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_car_command_log_created_at", table_name="car_command_log")
    op.drop_table("car_command_log")
