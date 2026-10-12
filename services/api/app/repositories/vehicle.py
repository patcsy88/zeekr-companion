from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import Vehicle


class VehicleRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self) -> Vehicle | None:
        return self._session.scalars(select(Vehicle)).first()

    def upsert(self, vehicle_id: uuid.UUID, values: dict[str, Any]) -> Vehicle:
        """Insert the profile, or replace every field of the existing one (id is kept)."""
        now = dt.datetime.now(dt.UTC)
        stmt = pg_insert(Vehicle).values(id=vehicle_id, singleton=True, **values)
        stmt = stmt.on_conflict_do_update(
            index_elements=[Vehicle.singleton], set_={**values, "updated_at": now}
        )
        row = self._session.execute(
            stmt.returning(Vehicle).execution_options(populate_existing=True)
        ).scalar_one()
        self._session.commit()
        return row
