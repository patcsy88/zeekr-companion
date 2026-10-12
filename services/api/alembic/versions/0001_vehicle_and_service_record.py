"""vehicle and service_record

Revision ID: 0001
Revises:
Create Date: 2026-10-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "vehicle",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("singleton", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("model", sa.String(length=100), nullable=False),
        sa.Column("variant", sa.String(length=100), server_default="", nullable=False),
        sa.Column("drive", sa.String(length=20), nullable=False),
        sa.Column("steering", sa.String(length=20), nullable=False),
        sa.Column("registration", sa.String(length=20), nullable=True),
        sa.Column("vin", sa.String(length=17), nullable=True),
        sa.Column("purchase_date", sa.Date(), nullable=True),
        sa.Column("purchase_price_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("tyre_spec", sa.String(length=200), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("singleton", name=op.f("ck_vehicle_singleton_true")),
        sa.CheckConstraint("purchase_price_minor >= 0", name=op.f("ck_vehicle_price_non_negative")),
        sa.CheckConstraint(
            "vin IS NULL OR char_length(vin) = 17", name=op.f("ck_vehicle_vin_length")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_vehicle")),
        sa.UniqueConstraint("singleton", name=op.f("uq_vehicle_singleton")),
    )
    op.create_table(
        "service_record",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("odometer", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(length=200), nullable=True),
        sa.Column("description", sa.String(length=500), nullable=False),
        sa.Column("cost_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("odometer >= 0", name=op.f("ck_service_record_odometer_non_negative")),
        sa.CheckConstraint("cost_minor >= 0", name=op.f("ck_service_record_cost_non_negative")),
        sa.CheckConstraint(
            "char_length(description) BETWEEN 1 AND 500",
            name=op.f("ck_service_record_description_length"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_service_record")),
    )
    op.create_index(
        "ix_service_record_history",
        "service_record",
        [sa.text("date DESC"), sa.text("created_at DESC"), sa.text("id DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_service_record_history", table_name="service_record")
    op.drop_table("service_record")
    op.drop_table("vehicle")
