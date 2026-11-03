"""live reading: Sentry indicator (ADR-009 build record 6)

Adds one nullable boolean. Existing rows keep null ("no reading"). The meaning of the source key
is unverified: it followed the owner's toggle on one on/off cycle.

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("live_reading", sa.Column("sentry_active", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("live_reading", "sentry_active")
