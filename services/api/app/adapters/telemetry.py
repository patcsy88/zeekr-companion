"""Read-only vehicle telemetry port (ADR-008).

Every method on a provider is a `read_*` method that returns a `Reading`. There is no method that
sends a command, sets a plan or changes anything on the car, and a test fails if one is added.
Every reading is nullable and says where it came from and when it was observed.

`RecordsTelemetryProvider` is built on records the owner already entered and only knows the
odometer. The live provider is in `app/adapters/zeekr_live.py` (ADR-009).
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Protocol

from app.clock import KUALA_LUMPUR
from app.repositories.service_records import ServiceRecordRepository
from app.services.odometer import read_current_odometer


@dataclass(frozen=True)
class Reading[T]:
    """One reading. `value` is None when the source has nothing to report."""

    value: T | None
    source: str
    observed_at: dt.datetime | None


@dataclass(frozen=True)
class TyrePressures:
    """Tyre pressures in kPa, named by the driver's side so it holds for right-hand drive."""

    driver: int
    passenger: int
    driver_rear: int
    passenger_rear: int


class VehicleTelemetryProvider(Protocol):
    """Read-only. Add `read_*` methods here as live sources appear; never a write method."""

    def read_odometer(self) -> Reading[int]: ...

    def read_battery_percent(self) -> Reading[float]: ...

    def read_range_km(self) -> Reading[int]: ...

    def read_days_to_service(self) -> Reading[int]: ...

    def read_distance_to_service_km(self) -> Reading[int]: ...

    def read_tyre_pressures_kpa(self) -> Reading[TyrePressures]: ...

    def read_is_charging(self) -> Reading[bool]: ...

    def read_is_plugged_in(self) -> Reading[bool]: ...


class RecordsTelemetryProvider:
    """Odometer from the latest service record, the same read reminders and warranty use.

    The record has a date but no time, so `observed_at` is the start of that date in
    Asia/Kuala_Lumpur, expressed in UTC.
    """

    SOURCE = "latest_service_record"

    def __init__(self, records: ServiceRecordRepository) -> None:
        self._records = records

    def read_odometer(self) -> Reading[int]:
        current = read_current_odometer(self._records)
        if current is None:
            return Reading(value=None, source=self.SOURCE, observed_at=None)
        start = dt.datetime.combine(current.date, dt.time.min, tzinfo=KUALA_LUMPUR)
        return Reading(value=current.km, source=self.SOURCE, observed_at=start.astimezone(dt.UTC))

    def _nothing[T](self) -> Reading[T]:
        return Reading(value=None, source=self.SOURCE, observed_at=None)

    def read_battery_percent(self) -> Reading[float]:
        return self._nothing()

    def read_range_km(self) -> Reading[int]:
        return self._nothing()

    def read_days_to_service(self) -> Reading[int]:
        return self._nothing()

    def read_distance_to_service_km(self) -> Reading[int]:
        return self._nothing()

    def read_tyre_pressures_kpa(self) -> Reading[TyrePressures]:
        return self._nothing()

    def read_is_charging(self) -> Reading[bool]:
        return self._nothing()

    def read_is_plugged_in(self) -> Reading[bool]:
        return self._nothing()
