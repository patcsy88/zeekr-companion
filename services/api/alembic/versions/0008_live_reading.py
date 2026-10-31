"""live reading history (ADR-009)

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-31
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "live_reading",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("odometer_km", sa.Integer(), nullable=True),
        sa.Column("battery_percent", sa.Numeric(4, 1), nullable=True),
        sa.Column("range_km", sa.Integer(), nullable=True),
        sa.Column("service_days", sa.Integer(), nullable=True),
        sa.Column("service_distance_km", sa.Integer(), nullable=True),
        sa.Column("tyre_driver_front_kpa", sa.Integer(), nullable=True),
        sa.Column("tyre_passenger_front_kpa", sa.Integer(), nullable=True),
        sa.Column("tyre_driver_rear_kpa", sa.Integer(), nullable=True),
        sa.Column("tyre_passenger_rear_kpa", sa.Integer(), nullable=True),
        sa.Column("is_charging", sa.Boolean(), nullable=True),
        sa.Column("is_plugged_in", sa.Boolean(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_live_reading")),
        sa.UniqueConstraint("observed_at", name=op.f("uq_live_reading_observed_at")),
        sa.CheckConstraint(
            "odometer_km IS NULL OR odometer_km BETWEEN 0 AND 10000000",
            name=op.f("ck_live_reading_odometer_range"),
        ),
        sa.CheckConstraint(
            "battery_percent IS NULL OR battery_percent BETWEEN 0 AND 100",
            name=op.f("ck_live_reading_battery_range"),
        ),
        sa.CheckConstraint(
            "range_km IS NULL OR range_km BETWEEN 0 AND 5000",
            name=op.f("ck_live_reading_range_range"),
        ),
        sa.CheckConstraint(
            "service_days IS NULL OR service_days BETWEEN -100000 AND 100000",
            name=op.f("ck_live_reading_service_days_range"),
        ),
        sa.CheckConstraint(
            "service_distance_km IS NULL OR service_distance_km BETWEEN -100000 AND 100000",
            name=op.f("ck_live_reading_service_distance_range"),
        ),
        sa.CheckConstraint(
            "(tyre_driver_front_kpa IS NULL OR tyre_driver_front_kpa BETWEEN 0 AND 500)"
            " AND (tyre_passenger_front_kpa IS NULL OR tyre_passenger_front_kpa BETWEEN 0 AND 500)"
            " AND (tyre_driver_rear_kpa IS NULL OR tyre_driver_rear_kpa BETWEEN 0 AND 500)"
            " AND (tyre_passenger_rear_kpa IS NULL OR tyre_passenger_rear_kpa BETWEEN 0 AND 500)",
            name=op.f("ck_live_reading_tyre_range"),
        ),
    )


def downgrade() -> None:
    op.drop_table("live_reading")
