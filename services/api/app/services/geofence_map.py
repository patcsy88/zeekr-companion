"""Geofence map (owner approved 2026-11-17, option A): the car offset from home, never a coordinate.

Read-only. It uses only the reading already held in memory by the live provider and the home point
already known (manual override or saved lookup). It never calls the car, never starts a lookup and
writes nothing.
"""

from __future__ import annotations

import datetime as dt
import math
from typing import Any

from app.config import Settings
from app.repositories.geofence_settings import GeofenceSettingsRepository
from app.schemas import GeofenceCarOffsetOut, GeofenceMapOut
from app.services.geofence import EARTH_RADIUS_KM, distance_km
from app.services.geofence_home import HomePoint, HomeResolver
from app.services.geofence_settings import effective
from app.services.live_vehicle import CLOCK_SKEW

STEP_KM = 0.1


def _rounded(km: float) -> float:
    # `+ 0.0` turns -0.0 into 0.0, so a tiny offset is never shown as "-0.0".
    return round(km / STEP_KM) * STEP_KM + 0.0


def offset_km(home: HomePoint, lat: float, lon: float) -> tuple[float, float]:
    """(east, north) in km from home, on a flat projection centred on home. Within 100 km the
    error against the great-circle distance is well under 1%."""
    dlon = (lon - home.longitude + 180.0) % 360.0 - 180.0
    mean = math.radians((lat + home.latitude) / 2)
    east = math.radians(dlon) * EARTH_RADIUS_KM * math.cos(mean)
    north = math.radians(lat - home.latitude) * EARTH_RADIUS_KM
    return round(_rounded(east), 1), round(_rounded(north), 1)


class GeofenceMapService:
    def __init__(
        self, repo: GeofenceSettingsRepository, settings: Settings, provider: Any | None
    ) -> None:
        self._repo = repo
        self._settings = settings
        self._provider = provider

    def view(self, now: dt.datetime | None = None) -> GeofenceMapOut:
        current = effective(self._settings, self._repo.get())
        radius = current.radius_km

        def empty(state: Any, **kw: Any) -> GeofenceMapOut:
            values: dict[str, Any] = {
                "state": state,
                "radius_km": radius,
                "car": None,
                "outside": None,
                "observed_at": None,
                "age_minutes": None,
                "stale": False,
            }
            values.update(kw)
            return GeofenceMapOut(**values)

        if not self._settings.geofence_enabled or self._provider is None:
            return empty("off")
        home = HomeResolver(self._settings).known()
        if home is None:
            return empty("home_not_set")
        reading = self._provider.geofence_input
        if reading is None:
            return empty("no_reading")
        moment = now or dt.datetime.now(dt.UTC)
        seen = reading.observed_at
        if seen is None or seen > moment + CLOCK_SKEW:
            return empty("incomplete")
        age = int(max(moment - seen, dt.timedelta(0)).total_seconds() // 60)
        if reading.latitude is None or reading.longitude is None:
            return empty("incomplete", observed_at=seen, age_minutes=age)
        east, north = offset_km(home, reading.latitude, reading.longitude)
        stale = moment - seen > dt.timedelta(minutes=current.stale_minutes)
        outside = (
            distance_km(home.latitude, home.longitude, reading.latitude, reading.longitude) > radius
        )
        return GeofenceMapOut(
            state="stale" if stale else "ok",
            radius_km=radius,
            car=GeofenceCarOffsetOut(east_km=east, north_km=north),
            outside=outside,
            observed_at=seen,
            age_minutes=age,
            stale=stale,
        )
