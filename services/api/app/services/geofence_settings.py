"""The geofence's settings (Piece C): the saved row if there is one, otherwise the host values.

Only the five tunable values live here. The home point stays in the host environment and is
never read, stored or returned by this module (`home_set` is a yes or no).
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Any

from app.config import Settings
from app.repositories.geofence_settings import GeofenceSettingsRepository, SavedGeofence
from app.schemas import (
    GEAR_OPTIONS,
    GEOFENCE_MAX_CODES,
    USAGE_MODE_OPTIONS,
    GeofenceLimitsOut,
    GeofenceOptionOut,
    GeofenceSettingsIn,
    GeofenceSettingsOut,
    GeofenceSourcesOut,
    GeofenceValuesOut,
)

DEFAULT_CODES = [0]  # gearAutoStatus Park, and usageMode Deep Sleep (owner decision, 2026-11-05)
DEFAULT_CODES_SET = frozenset(str(c) for c in DEFAULT_CODES)


@dataclass(frozen=True)
class Effective:
    radius_km: float
    interval_minutes: int
    stale_minutes: int
    gear_codes: frozenset[str]
    usage_mode_codes: frozenset[str]


def effective(settings: Settings, saved: SavedGeofence | None) -> Effective:
    if saved is None:
        return Effective(
            settings.geofence_radius_km,
            settings.geofence_interval_minutes,
            settings.geofence_stale_minutes,
            frozenset(str(c) for c in DEFAULT_CODES),
            frozenset(str(c) for c in DEFAULT_CODES),
        )
    return Effective(
        saved.radius_km,
        saved.interval_minutes,
        saved.stale_minutes,
        frozenset(str(c) for c in saved.gear_codes),
        frozenset(str(c) for c in saved.usage_mode_codes),
    )


def _options(rows: tuple[tuple[int, str, bool], ...]) -> list[GeofenceOptionOut]:
    return [GeofenceOptionOut(code=c, label=n, verified=v) for c, n, v in rows]


class GeofenceSettingsService:
    def __init__(self, repo: GeofenceSettingsRepository, settings: Settings) -> None:
        self._repo = repo
        self._settings = settings

    def view(self) -> GeofenceSettingsOut:
        saved = self._repo.get()
        env = self._settings
        if saved is None:
            values = GeofenceValuesOut(
                radius_km=env.geofence_radius_km,
                interval_minutes=env.geofence_interval_minutes,
                stale_minutes=env.geofence_stale_minutes,
                gear_codes=list(DEFAULT_CODES),
                usage_mode_codes=list(DEFAULT_CODES),
            )
            origin: Any = "env"
        else:
            values = GeofenceValuesOut(
                radius_km=saved.radius_km,
                interval_minutes=saved.interval_minutes,
                stale_minutes=saved.stale_minutes,
                gear_codes=saved.gear_codes,
                usage_mode_codes=saved.usage_mode_codes,
            )
            origin = "saved"
        return GeofenceSettingsOut(
            settings=values,
            sources=GeofenceSourcesOut(
                radius_km=origin,
                interval_minutes=origin,
                stale_minutes=origin,
                gear_codes=origin,
                usage_mode_codes=origin,
            ),
            limits=GeofenceLimitsOut(
                radius_km_max=100.0,
                interval_minutes_min=5,
                interval_minutes_max=1440,
                stale_minutes_min=1,
                stale_minutes_max=30,
                max_codes=GEOFENCE_MAX_CODES,
                gear_options=_options(GEAR_OPTIONS),
                usage_mode_options=_options(USAGE_MODE_OPTIONS),
            ),
            enabled=env.geofence_enabled,
            home_set=env.geofence_home_query is not None or env.geofence_home_lat is not None,
        )

    def save(self, body: GeofenceSettingsIn) -> GeofenceSettingsOut:
        self._repo.save(body.model_dump(), dt.datetime.now(dt.UTC))
        return self.view()

    def reset(self) -> GeofenceSettingsOut:
        self._repo.delete()
        return self.view()
