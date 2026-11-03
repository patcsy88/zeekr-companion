"""live reading additions: 12 V voltage, tyre temperatures, five on/off indicators (ADR-009)

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-03
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TYRE_TEMPS = (
    "tyre_temp_driver_front_c",
    "tyre_temp_passenger_front_c",
    "tyre_temp_driver_rear_c",
    "tyre_temp_passenger_rear_c",
)
INDICATORS = (
    "pre_climate_active",
    "fragrance_active",
    "overheat_protection_active",
    "vtm_ts_active",
    "engine_enable_running",
)


def upgrade() -> None:
    op.add_column("live_reading", sa.Column("battery_12v_volts", sa.Numeric(4, 1), nullable=True))
    for name in TYRE_TEMPS:
        op.add_column("live_reading", sa.Column(name, sa.Integer(), nullable=True))
    for name in INDICATORS:
        op.add_column("live_reading", sa.Column(name, sa.Boolean(), nullable=True))
    op.create_check_constraint(
        op.f("ck_live_reading_battery_12v_range"),
        "live_reading",
        "battery_12v_volts IS NULL OR battery_12v_volts BETWEEN 6 AND 20",
    )
    op.create_check_constraint(
        op.f("ck_live_reading_tyre_temp_range"),
        "live_reading",
        " AND ".join(f"({c} IS NULL OR {c} BETWEEN -40 AND 150)" for c in TYRE_TEMPS),
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_live_reading_tyre_temp_range"), "live_reading", type_="check")
    op.drop_constraint(op.f("ck_live_reading_battery_12v_range"), "live_reading", type_="check")
    for name in (*INDICATORS, *reversed(TYRE_TEMPS), "battery_12v_volts"):
        op.drop_column("live_reading", name)
