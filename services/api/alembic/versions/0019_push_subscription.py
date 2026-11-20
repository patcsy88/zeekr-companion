"""push subscriptions (ADR-014, owner approved 2026-11-20)

New table push_subscription: one row per phone that turned alerts on. The endpoint and the two keys
are sensitive and are never logged or returned. No home, office, position or vehicle data is stored.
Downgrade drops the table, so every phone must subscribe again.

Revision ID: 0019
Revises: 0018
Create Date: 2026-11-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "push_subscription",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.Text(), nullable=False),
        sa.Column("auth", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_success_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failure_count", sa.SmallInteger(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_push_subscription")),
        sa.UniqueConstraint("endpoint", name=op.f("uq_push_subscription_endpoint")),
        sa.CheckConstraint(
            "char_length(endpoint) BETWEEN 1 AND 2048",
            name=op.f("ck_push_subscription_endpoint_valid"),
        ),
        sa.CheckConstraint(
            "char_length(p256dh) BETWEEN 1 AND 256 AND char_length(auth) BETWEEN 1 AND 256",
            name=op.f("ck_push_subscription_keys_valid"),
        ),
        sa.CheckConstraint(
            "failure_count BETWEEN 0 AND 5", name=op.f("ck_push_subscription_failures_valid")
        ),
    )


def downgrade() -> None:
    op.drop_table("push_subscription")
