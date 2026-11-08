"""tyre events (FR-9, approved by the owner 2026-11-08)

New table tyre_event: one row per Replace, Rotate, Repair, Alignment or Balancing. Nothing existing
changes. Downgrade drops the table and its rows.

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tyre_event",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("wheels", postgresql.ARRAY(sa.String(length=20)), nullable=False),
        sa.Column("odometer", sa.Integer(), nullable=False),
        sa.Column("brand", sa.String(length=100), nullable=True),
        sa.Column("model", sa.String(length=100), nullable=True),
        sa.Column("size", sa.String(length=50), nullable=True),
        sa.Column("cost_minor", sa.BigInteger(), nullable=True),
        sa.Column("currency", sa.String(length=3), server_default="MYR", nullable=False),
        sa.Column("shop", sa.String(length=200), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "kind IN ('replace', 'rotate', 'repair', 'alignment', 'balancing')",
            name=op.f("ck_tyre_event_kind_valid"),
        ),
        sa.CheckConstraint(
            "cardinality(wheels) BETWEEN 1 AND 4 AND wheels <@ ARRAY['driver_front', "
            "'passenger_front', 'driver_rear', 'passenger_rear']::varchar(20)[]",
            name=op.f("ck_tyre_event_wheels_valid"),
        ),
        sa.CheckConstraint(
            "odometer BETWEEN 0 AND 10000000", name=op.f("ck_tyre_event_odometer_range")
        ),
        sa.CheckConstraint(
            "cost_minor IS NULL OR cost_minor BETWEEN 0 AND 1000000000000",
            name=op.f("ck_tyre_event_cost_range"),
        ),
        sa.CheckConstraint("currency = 'MYR'", name=op.f("ck_tyre_event_currency_myr")),
        sa.CheckConstraint("date >= DATE '2000-01-01'", name=op.f("ck_tyre_event_date_min")),
        sa.CheckConstraint(
            "kind = 'replace' OR (brand IS NULL AND model IS NULL AND size IS NULL)",
            name=op.f("ck_tyre_event_tyre_only_on_replace"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tyre_event")),
    )
    op.create_index(
        "ix_tyre_event_history",
        "tyre_event",
        [sa.text("date DESC"), sa.text("created_at DESC"), sa.text("id DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_tyre_event_history", table_name="tyre_event")
    op.drop_table("tyre_event")
