"""geofence office radius (owner approved 2026-11-20)

New nullable column geofence_settings.office_radius_km: null means the host value applies.
No home or office point is stored. Downgrade drops the column, so the host value applies again.

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "geofence_settings", sa.Column("office_radius_km", sa.Numeric(6, 2), nullable=True)
    )
    op.create_check_constraint(
        op.f("ck_geofence_settings_office_radius_valid"),
        "geofence_settings",
        "office_radius_km IS NULL OR (office_radius_km > 0 AND office_radius_km <= 100)",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("ck_geofence_settings_office_radius_valid"), "geofence_settings", type_="check"
    )
    op.drop_column("geofence_settings", "office_radius_km")
