"""geofence settings: one editable row (Piece C)

New table geofence_settings, at most one row (id is fixed at 1). No home data is stored.
Downgrade drops the table, so the .env values apply again.

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "geofence_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("radius_km", sa.Numeric(6, 2), nullable=False),
        sa.Column("interval_minutes", sa.Integer(), nullable=False),
        sa.Column("stale_minutes", sa.Integer(), nullable=False),
        sa.Column("gear_codes", postgresql.ARRAY(sa.SmallInteger()), nullable=False),
        sa.Column("usage_mode_codes", postgresql.ARRAY(sa.SmallInteger()), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("id = 1", name=op.f("ck_geofence_settings_single_row")),
        sa.CheckConstraint(
            "radius_km > 0 AND radius_km <= 100", name=op.f("ck_geofence_settings_radius_valid")
        ),
        sa.CheckConstraint(
            "interval_minutes BETWEEN 5 AND 1440",
            name=op.f("ck_geofence_settings_interval_valid"),
        ),
        sa.CheckConstraint(
            "stale_minutes BETWEEN 1 AND 30", name=op.f("ck_geofence_settings_stale_valid")
        ),
        sa.CheckConstraint(
            "cardinality(gear_codes) BETWEEN 1 AND 5",
            name=op.f("ck_geofence_settings_gear_codes_valid"),
        ),
        sa.CheckConstraint(
            "cardinality(usage_mode_codes) BETWEEN 1 AND 5",
            name=op.f("ck_geofence_settings_usage_mode_codes_valid"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_geofence_settings")),
    )


def downgrade() -> None:
    op.drop_table("geofence_settings")
