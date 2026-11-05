"""geofence alert: a new advisory condition and a closed status (Piece B)

No new table and no new column. Only the two check constraints on advisory_proposal change.
Downgrade deletes any geofence alerts first, because the old checks could not hold them.

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_CONDITION = "condition IN ('date_vs_km_warranty','date_vs_km_service','charging_cost_drift')"
NEW_CONDITION = (
    "condition IN ('date_vs_km_warranty','date_vs_km_service','charging_cost_drift',"
    "'sentry_off_outside_geofence')"
)
OLD_STATUS = "status IN ('proposed','accepted','dismissed')"
NEW_STATUS = "status IN ('proposed','accepted','dismissed','closed')"


def _swap(name: str, expression: str) -> None:
    constraint = op.f(f"ck_advisory_proposal_{name}")
    op.drop_constraint(constraint, "advisory_proposal", type_="check")
    op.create_check_constraint(constraint, "advisory_proposal", sa.text(expression))


def upgrade() -> None:
    _swap("condition_valid", NEW_CONDITION)
    _swap("status_valid", NEW_STATUS)


def downgrade() -> None:
    op.execute("DELETE FROM advisory_proposal WHERE condition = 'sentry_off_outside_geofence'")
    _swap("condition_valid", OLD_CONDITION)
    _swap("status_valid", OLD_STATUS)
