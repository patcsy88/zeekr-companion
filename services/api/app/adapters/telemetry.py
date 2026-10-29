"""Read-only vehicle telemetry port (ADR-008).

Every method on a provider is a `read_*` method that returns a `Reading`. There is no method that
sends a command, sets a plan or changes anything on the car, and a test fails if one is added.
Every reading is nullable and says where it came from and when it was observed.

The only provider is built on records the owner already entered. A live provider needs its own
ADR and the owner's approval; none exists.
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


class VehicleTelemetryProvider(Protocol):
    """Read-only. Add `read_*` methods here as live sources appear; never a write method."""

    def read_odometer(self) -> Reading[int]: ...


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
