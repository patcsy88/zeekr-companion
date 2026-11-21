"""renewal details on reminder (owner approved 2026-11-21)

Five optional columns. Insurance reminders may carry insurer, cover_type, premium_minor and
insurer_phone; road tax reminders may carry amount_minor. No policy number, plate or VIN.
Downgrade drops the columns and the values in them.

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_INSURANCE_ONLY = (
    "insurer IS NULL AND cover_type IS NULL AND premium_minor IS NULL AND insurer_phone IS NULL"
    " OR kind = 'insurance_renewal'"
)


def upgrade() -> None:
    op.add_column("reminder", sa.Column("insurer", sa.String(length=200), nullable=True))
    op.add_column("reminder", sa.Column("cover_type", sa.String(length=30), nullable=True))
    op.add_column("reminder", sa.Column("premium_minor", sa.BigInteger(), nullable=True))
    op.add_column("reminder", sa.Column("insurer_phone", sa.String(length=30), nullable=True))
    op.add_column("reminder", sa.Column("amount_minor", sa.BigInteger(), nullable=True))
    op.create_check_constraint(
        op.f("ck_reminder_cover_type_valid"),
        "reminder",
        "cover_type IS NULL OR cover_type IN ('comprehensive', 'third_party',"
        " 'third_party_fire_theft')",
    )
    op.create_check_constraint(
        op.f("ck_reminder_premium_range"),
        "reminder",
        "premium_minor IS NULL OR premium_minor BETWEEN 0 AND 100000000",
    )
    op.create_check_constraint(
        op.f("ck_reminder_amount_range"),
        "reminder",
        "amount_minor IS NULL OR amount_minor BETWEEN 0 AND 100000000",
    )
    op.create_check_constraint(
        op.f("ck_reminder_insurance_fields_insurance_only"), "reminder", _INSURANCE_ONLY
    )
    op.create_check_constraint(
        op.f("ck_reminder_amount_road_tax_only"),
        "reminder",
        "amount_minor IS NULL OR kind = 'road_tax_renewal'",
    )


def downgrade() -> None:
    for name in (
        "ck_reminder_amount_road_tax_only",
        "ck_reminder_insurance_fields_insurance_only",
        "ck_reminder_amount_range",
        "ck_reminder_premium_range",
        "ck_reminder_cover_type_valid",
    ):
        op.drop_constraint(op.f(name), "reminder", type_="check")
    for column in ("amount_minor", "insurer_phone", "premium_minor", "cover_type", "insurer"):
        op.drop_column("reminder", column)
