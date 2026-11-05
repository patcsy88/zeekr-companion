from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import GeofenceSettings


@dataclass(frozen=True)
class SavedGeofence:
    radius_km: float
    interval_minutes: int
    stale_minutes: int
    gear_codes: list[int]
    usage_mode_codes: list[int]


class GeofenceSettingsRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self) -> SavedGeofence | None:
        row = self._session.scalars(
            select(GeofenceSettings).where(GeofenceSettings.id == 1)
        ).first()
        saved = (
            None
            if row is None
            else SavedGeofence(
                radius_km=float(row.radius_km),
                interval_minutes=row.interval_minutes,
                stale_minutes=row.stale_minutes,
                gear_codes=list(row.gear_codes),
                usage_mode_codes=list(row.usage_mode_codes),
            )
        )
        self._session.rollback()
        return saved

    def save(self, values: dict[str, Any], now: dt.datetime) -> None:
        try:
            row = self._session.get(GeofenceSettings, 1)
            if row is None:
                self._session.add(GeofenceSettings(id=1, updated_at=now, **values))
            else:
                for key, value in values.items():
                    setattr(row, key, value)
                row.updated_at = now
            self._session.commit()
        except Exception:
            self._session.rollback()
            raise

    def delete(self) -> None:
        try:
            self._session.execute(delete(GeofenceSettings))
            self._session.commit()
        except Exception:
            self._session.rollback()
            raise
