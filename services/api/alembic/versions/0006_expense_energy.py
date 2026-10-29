"""expense energy_wh

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("expense", sa.Column("energy_wh", sa.Integer(), nullable=True))
    op.create_check_constraint(
        op.f("ck_expense_energy_valid"),
        "expense",
        "energy_wh IS NULL OR (category = 'charging' AND energy_wh BETWEEN 1 AND 1000000)",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_expense_energy_valid"), "expense", type_="check")
    op.drop_column("expense", "energy_wh")
