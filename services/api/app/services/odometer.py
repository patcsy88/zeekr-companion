"""The current odometer, shared by reminders (AC-16) and warranty (AC-52).

It is the `odometer` of the service record with the latest `date` (ties by `created_at`, then
`id`), or None when there are no service records. Warranty claims never change it.
"""

from __future__ import annotations

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
