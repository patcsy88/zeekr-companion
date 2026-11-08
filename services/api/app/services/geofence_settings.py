"""The geofence's settings (Piece C): the saved row if there is one, otherwise the host values.

Only the four tunable values live here; gear is fixed at P and is not a setting. The home point
stays in the host environment and is never read, stored or returned by this module (`home_set` is
a yes or no).
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Any

from app.config import Settings
from app.repositories.geofence_settings import GeofenceSettingsRepository, SavedGeofence
from app.schemas import (
    GEOFENCE_MAX_CODES,
    USAGE_MODE_OPTIONS,
    GeofenceLimitsOut,
    GeofenceOptionOut,
    GeofenceSettingsIn,
    GeofenceSettingsOut,
    GeofenceSourcesOut,
    GeofenceValuesOut,
)

# usageMode Deep Sleep (owner decision, 2026-11-05). Gear is always P and is written as [0].
DEFAULT_CODES = [0]
GEAR_PARK = [0]
ALLOWED_USAGE_CODES = frozenset(code for code, _, _ in USAGE_MODE_OPTIONS)


def usage_codes(saved: list[int]) -> list[int]:
    """Only Deep Sleep and Parked count (owner, 2026-11-08). A row saved before that may hold
    other modes: they are dropped, and an empty result falls back to Deep Sleep."""
    kept = sorted({c for c in saved if c in ALLOWED_USAGE_CODES})
    return kept or list(DEFAULT_CODES)


@dataclass(frozen=True)
class Effective:
    radius_km: float
    interval_minutes: int
    stale_minutes: int
    usage_mode_codes: frozenset[str]


def effective(settings: Settings, saved: SavedGeofence | None) -> Effective:
    if saved is None:
        return Effective(
            settings.geofence_radius_km,
            settings.geofence_interval_minutes,
            settings.geofence_stale_minutes,
            frozenset(str(c) for c in DEFAULT_CODES),
        )
    return Effective(
        saved.radius_km,
        saved.interval_minutes,
        saved.stale_minutes,
        frozenset(str(c) for c in usage_codes(saved.usage_mode_codes)),
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
                usage_mode_codes=list(DEFAULT_CODES),
            )
            origin: Any = "env"
        else:
            values = GeofenceValuesOut(
                radius_km=saved.radius_km,
                interval_minutes=saved.interval_minutes,
                stale_minutes=saved.stale_minutes,
                usage_mode_codes=usage_codes(saved.usage_mode_codes),
            )
            origin = "saved"
        return GeofenceSettingsOut(
            settings=values,
            sources=GeofenceSourcesOut(
                radius_km=origin,
                interval_minutes=origin,
                stale_minutes=origin,
                usage_mode_codes=origin,
            ),
            limits=GeofenceLimitsOut(
                radius_km_max=100.0,
                interval_minutes_min=5,
                interval_minutes_max=1440,
                stale_minutes_min=1,
                stale_minutes_max=30,
                max_codes=GEOFENCE_MAX_CODES,
                usage_mode_options=_options(USAGE_MODE_OPTIONS),
            ),
            enabled=env.geofence_enabled,
            home_set=env.geofence_home_query is not None or env.geofence_home_lat is not None,
        )

    def save(self, body: GeofenceSettingsIn) -> GeofenceSettingsOut:
        self._repo.save(
            {**body.model_dump(), "gear_codes": list(GEAR_PARK)}, dt.datetime.now(dt.UTC)
        )
        return self.view()

    def reset(self) -> GeofenceSettingsOut:
        self._repo.delete()
        return self.view()
