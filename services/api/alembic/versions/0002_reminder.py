"""reminder

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "reminder",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=30), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("due_odometer", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("completed_on", sa.Date(), nullable=True),
        sa.Column("template_ref", sa.String(length=100), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "kind IN ('service', 'insurance_renewal', 'road_tax_renewal')",
            name=op.f("ck_reminder_kind_valid"),
        ),
        sa.CheckConstraint(
            "char_length(title) BETWEEN 1 AND 200", name=op.f("ck_reminder_title_length")
        ),
        sa.CheckConstraint(
            "due_date IS NOT NULL OR due_odometer IS NOT NULL",
            name=op.f("ck_reminder_has_due_field"),
        ),
        sa.CheckConstraint(
            "due_odometer IS NULL OR due_odometer BETWEEN 0 AND 10000000",
            name=op.f("ck_reminder_due_odometer_range"),
        ),
        sa.CheckConstraint(
            "due_odometer IS NULL OR kind = 'service'",
            name=op.f("ck_reminder_due_odometer_service_only"),
        ),
        sa.CheckConstraint(
            "due_date IS NULL OR due_date BETWEEN DATE '2000-01-01' AND DATE '2200-12-31'",
            name=op.f("ck_reminder_due_date_range"),
        ),
        sa.CheckConstraint(
            "template_ref IS NULL OR char_length(template_ref) <= 100",
            name=op.f("ck_reminder_template_ref_length"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reminder")),
    )


def downgrade() -> None:
    op.drop_table("reminder")
