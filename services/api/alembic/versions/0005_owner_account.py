"""owner_account

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "owner_account",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("singleton", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("password_hash", sa.String(length=300), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("singleton", name=op.f("ck_owner_account_singleton_true")),
        sa.CheckConstraint(
            "char_length(username) BETWEEN 3 AND 64 AND username = lower(username)",
            name=op.f("ck_owner_account_username_valid"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_owner_account")),
        sa.UniqueConstraint("singleton", name=op.f("uq_owner_account_singleton")),
    )


def downgrade() -> None:
    op.drop_table("owner_account")
