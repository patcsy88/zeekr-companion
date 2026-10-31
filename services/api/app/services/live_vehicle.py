"""The live vehicle card and its history (ADR-009). Read-only: nothing here writes to the car.

The page asks; the server never polls. A real Zeekr read happens only inside a request, at most
once per interval (the provider enforces the spacing), under one lock so two pages cause one read.
"""

from __future__ import annotations

import datetime as dt
import logging
import threading
from decimal import Decimal
from typing import Literal

from sqlalchemy.exc import SQLAlchemyError

from app.adapters.zeekr_live import Snapshot, ZeekrLiveTelemetryProvider
from app.config import Settings
from app.models import LiveReading
from app.repositories.live_readings import LiveReadingRepository
from app.schemas import (
    LiveCardOut,
    LiveDeleteOut,
    LiveHistoryOut,
    LiveReadingItem,
    LiveReadings,
    LiveTyres,
)

RETENTION_MONTHS = 12
CLOCK_SKEW = dt.timedelta(minutes=5)  # a car time further ahead than this is not believed
LOCK_WAIT_S = 5.0  # a request waits this long for a read in progress, then serves what is stored
log = logging.getLogger("app.live_vehicle")


def months_before(moment: dt.datetime, months: int) -> dt.datetime:
    """The same moment `months` calendar months earlier, clamped to the month's last day."""
    index = moment.year * 12 + (moment.month - 1) - months
    year, month = divmod(index, 12)
    month += 1
    day = moment.day
    while True:
        try:
            return moment.replace(year=year, month=month, day=day)
        except ValueError:
            day -= 1


def _data_columns(snap: Snapshot) -> dict[str, object]:
    tyres = snap.tyres_kpa
    return {
        "odometer_km": snap.odometer_km,
        "battery_percent": (
            None if snap.battery_percent is None else Decimal(str(round(snap.battery_percent, 1)))
        ),
        "range_km": snap.range_km,
        "service_days": snap.days_to_service,
        "service_distance_km": snap.distance_to_service_km,
        "tyre_driver_front_kpa": tyres.driver if tyres else None,
        "tyre_passenger_front_kpa": tyres.passenger if tyres else None,
        "tyre_driver_rear_kpa": tyres.driver_rear if tyres else None,
        "tyre_passenger_rear_kpa": tyres.passenger_rear if tyres else None,
        "is_charging": snap.is_charging,
        "is_plugged_in": snap.is_plugged_in,
    }


def _readings(row: LiveReading | None) -> LiveReadings:
    if row is None:
        return LiveReadings.empty()
    return LiveReadings(
        odometer_km=row.odometer_km,
        battery_percent=None if row.battery_percent is None else float(row.battery_percent),
        range_km=row.range_km,
        plugged_in=row.is_plugged_in,
        charging=row.is_charging,
        tyres_kpa=LiveTyres(
            driver_front=row.tyre_driver_front_kpa,
            passenger_front=row.tyre_passenger_front_kpa,
            driver_rear=row.tyre_driver_rear_kpa,
            passenger_rear=row.tyre_passenger_rear_kpa,
        ),
        service_distance_km=row.service_distance_km,
        service_days=row.service_days,
    )


class LiveVehicleService:
    def __init__(
        self,
        repo: LiveReadingRepository,
        provider: ZeekrLiveTelemetryProvider | None,
        settings: Settings,
        lock: threading.Lock,
    ) -> None:
        self._repo = repo
        self._provider = provider
        self._settings = settings
        self._lock = lock

    @property
    def _interval(self) -> int:
        return self._settings.zeekr_live_interval_minutes

    def card(self, now: dt.datetime | None = None) -> LiveCardOut:
        provider = self._provider
        if provider is None:
            return LiveCardOut(
                status="off",
                interval_minutes=self._interval,
                served_from=None,
                observed_at=None,
                received_at=None,
                readings=LiveReadings.empty(),
            )
        fetched = False
        store_failed = False
        if self._lock.acquire(timeout=LOCK_WAIT_S):
            try:
                before = provider.fetches
                provider.read_odometer()  # any read_* serves the shared snapshot
                fetched = provider.fetches > before
                snap = provider.snapshot
                if fetched and snap is not None:
                    store_failed = not self._store(snap, now or dt.datetime.now(dt.UTC))
            finally:
                self._lock.release()
        row = self._repo.latest()
        status: Literal["ok", "unavailable", "paused"]
        if provider.stopped:
            status = "paused"
        elif provider.failures > 0 or store_failed:
            status = "unavailable"
        else:
            status = "ok"
        return LiveCardOut(
            status=status,
            interval_minutes=self._interval,
            served_from="zeekr" if fetched else "cache",
            observed_at=row.observed_at if row else None,
            received_at=row.received_at if row else None,
            readings=_readings(row),
        )

    def _store(self, snap: Snapshot, now: dt.datetime) -> bool:
        """False only if the database refused the write. A reading is skipped (and True returned)
        when it has no car timestamp (it cannot be told from a repeat), a car timestamp ahead of
        the clock, or every value empty. A repeat of a stored `observed_at` is dropped by the
        unique index."""
        if snap.observed_at is None or snap.observed_at > now + CLOCK_SKEW:
            return True
        data = _data_columns(snap)
        if all(v is None for v in data.values()):
            return True
        try:
            self._repo.store(
                {"observed_at": snap.observed_at, "received_at": now, **data},
                keep_after=months_before(now, RETENTION_MONTHS),
            )
        except SQLAlchemyError:
            log.warning("Could not store a live reading")
            return False
        return True

    def history(self, limit: int, since: dt.datetime | None) -> LiveHistoryOut:
        self._repo.prune(months_before(dt.datetime.now(dt.UTC), RETENTION_MONTHS))
        rows = self._repo.list(limit, since)
        items = []
        for row in rows:
            r = _readings(row)
            items.append(
                LiveReadingItem(
                    id=row.id,
                    observed_at=row.observed_at,
                    received_at=row.received_at,
                    **r.model_dump(),
                )
            )
        return LiveHistoryOut(
            items=items, interval_minutes=self._interval, retention_months=RETENTION_MONTHS
        )

    def delete_all(self) -> LiveDeleteOut:
        # No lock: one DELETE is atomic, and it must not wait behind a slow Zeekr read.
        return LiveDeleteOut(deleted=self._repo.delete_all())
