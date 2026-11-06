"""second factor for the owner login (ADR-013)

New table owner_mfa, at most one row (id is fixed at 1); no row means MFA is off. It holds the
TOTP secret, the newest accepted time step (replay protection) and the hashed recovery codes.
Nothing existing changes. Downgrade drops the table, which turns MFA off.

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "owner_mfa",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("secret", sa.String(length=64), nullable=False),
        sa.Column("last_step", sa.BigInteger(), nullable=False),
        sa.Column("recovery_hashes", postgresql.ARRAY(sa.String(length=300)), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name=op.f("ck_owner_mfa_single_row")),
        sa.CheckConstraint(
            "char_length(secret) BETWEEN 16 AND 64", name=op.f("ck_owner_mfa_secret_valid")
        ),
        sa.CheckConstraint("last_step >= 0", name=op.f("ck_owner_mfa_step_valid")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_owner_mfa")),
    )


def downgrade() -> None:
    op.drop_table("owner_mfa")
