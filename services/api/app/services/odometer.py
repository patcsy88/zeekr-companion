"""The current odometer, shared by reminders (AC-16) and warranty (AC-52).

It is the `odometer` of the service record with the latest `date` (ties by `created_at`, then
`id`), or None when there are no service records. Warranty claims never change it.
"""

from __future__ import annotations

from app.clock import today_kl
from app.repositories.live_readings import LiveReadingRepository
from app.repositories.service_records import ServiceRecordRepository
from app.schemas import CurrentOdometer


def read_current_odometer(records: ServiceRecordRepository) -> CurrentOdometer | None:
    rows = records.list_page(1, None)
    if not rows:
        return None
    r = rows[0]
    return CurrentOdometer(
        km=r.odometer, source="latest_service_record", service_record_id=r.id, date=r.date
    )


def read_reminder_odometer(
    records: ServiceRecordRepository, live: LiveReadingRepository | None
) -> CurrentOdometer | None:
    """For reminders only: the larger of the latest service record and the newest stored live
    reading (an odometer does not go down). A tie keeps the service record. Warranty keeps using
    `read_current_odometer`. `live` is None when live readings are off."""
    record = read_current_odometer(records)
    row = live.latest() if live is not None else None
    if row is None or row.odometer_km is None:
        return record
    if record is not None and record.km >= row.odometer_km:
        return record
    return CurrentOdometer(
        km=row.odometer_km,
        source="live_reading",
        service_record_id=None,
        date=today_kl(row.observed_at),
    )
