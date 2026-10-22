"""expense

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "expense",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("category", sa.String(length=30), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(length=3), server_default="MYR", nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "category IN ('charging', 'insurance', 'road_tax', 'parking', 'tolls', 'tyres', "
            "'accessories', 'cleaning', 'fines', 'warranty', 'other')",
            name=op.f("ck_expense_category_valid"),
        ),
        sa.CheckConstraint(
            "amount_minor BETWEEN 1 AND 1000000000000", name=op.f("ck_expense_amount_range")
        ),
        sa.CheckConstraint("currency = 'MYR'", name=op.f("ck_expense_currency_myr")),
        sa.CheckConstraint("date >= DATE '2000-01-01'", name=op.f("ck_expense_date_min")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_expense")),
    )
    op.create_index(
        "ix_expense_history",
        "expense",
        [sa.text("date DESC"), sa.text("created_at DESC"), sa.text("id DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_expense_history", table_name="expense")
    op.drop_table("expense")
