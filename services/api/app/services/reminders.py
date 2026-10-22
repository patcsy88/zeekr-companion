from __future__ import annotations

import datetime as dt
import uuid

from app.clock import today_kl
from app.errors import Conflict, FieldIssue, InvalidInput, NotFound
from app.models import Reminder
from app.repositories.reminders import ReminderCapReached, ReminderRepository
from app.repositories.service_records import ServiceRecordRepository
from app.schemas import (
    MAX_REMINDERS,
    CurrentOdometer,
    ReminderCreate,
    ReminderList,
    ReminderOut,
    ReminderPatch,
)
from app.services.odometer import read_current_odometer
from app.services.reminder_status import compute_status

_CONTENT_FIELDS = ("kind", "title", "due_date", "due_odometer", "notes", "template_ref")
_RANK = {"overdue": 0, "upcoming": 1, "completed": 2}
_FAR = dt.date.max


def check_due_rules(
    kind: str, due_date: dt.date | None, due_odometer: int | None
) -> list[FieldIssue]:
    """Cross-field rules shared by create and patch (AC-11, AC-12)."""
    issues: list[FieldIssue] = []
    if due_date is None and due_odometer is None:
        issues.append(
            FieldIssue("due_date", "at least one of due_date and due_odometer is required")
        )
        issues.append(
            FieldIssue("due_odometer", "at least one of due_date and due_odometer is required")
        )
    if due_odometer is not None and kind != "service":
        issues.append(FieldIssue("due_odometer", "is only allowed for service reminders"))
    return issues


class ReminderService:
    def __init__(self, repo: ReminderRepository, records: ServiceRecordRepository) -> None:
        self._repo = repo
        self._records = records

    def _current_odometer(self) -> CurrentOdometer | None:
        return read_current_odometer(self._records)

    @staticmethod
    def _out(row: Reminder, today: dt.date, km: int | None) -> ReminderOut:
        status, overdue_by = compute_status(
            completed_on=row.completed_on,
            due_date=row.due_date,
            due_odometer=row.due_odometer,
            current_odometer_km=km,
            today=today,
        )
        return ReminderOut(
            id=row.id,
            kind=row.kind,
            title=row.title,
            due_date=row.due_date,
            due_odometer=row.due_odometer,
            notes=row.notes,
            completed_on=row.completed_on,
            template_ref=row.template_ref,
            status=status,
            overdue_by=overdue_by,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    def _view(self, row: Reminder, today: dt.date | None) -> ReminderOut:
        odo = self._current_odometer()
        return self._out(row, today or today_kl(), odo.km if odo else None)

    def create(self, data: ReminderCreate) -> tuple[ReminderOut, bool]:
        issues = check_due_rules(data.kind, data.due_date, data.due_odometer)
        if issues:
            raise InvalidInput("Request failed validation.", issues)
        values = data.model_dump()
        for _ in range(2):
            existing = self._repo.get(data.id)
            if existing is not None:
                if all(getattr(existing, f) == values[f] for f in _CONTENT_FIELDS):
                    return self._view(existing, None), False
                raise Conflict("A reminder with this id already exists with different content.")
            try:
                inserted = self._repo.insert_if_absent(values, MAX_REMINDERS)
            except ReminderCapReached:
                raise InvalidInput(
                    "Request failed validation.",
                    [FieldIssue("body", f"at most {MAX_REMINDERS} reminders are allowed")],
                ) from None
            if inserted is not None:
                return self._view(inserted, None), True
        raise Conflict("Could not create the reminder; please retry.")

    def get(self, reminder_id: uuid.UUID, today: dt.date | None) -> ReminderOut:
        row = self._repo.get(reminder_id)
        if row is None:
            raise NotFound("Reminder not found.")
        return self._view(row, today)

    def list(self, today: dt.date | None, include_completed: bool) -> ReminderList:
        day = today or today_kl()
        odo = self._current_odometer()
        km = odo.km if odo else None
        items = [self._out(r, day, km) for r in self._repo.list_all()]
        if not include_completed:
            items = [i for i in items if i.status != "completed"]
        items.sort(
            key=lambda i: (
                _RANK[i.status],
                i.due_date or _FAR,
                i.due_date is None,
                i.due_odometer if i.due_odometer is not None else 10**12,
                str(i.id),
            )
        )
        return ReminderList(items=items, current_odometer=odo)

    def update(self, reminder_id: uuid.UUID, patch: ReminderPatch) -> ReminderOut:
        changes = patch.model_dump(exclude_unset=True)
        row = self._repo.lock(reminder_id)
        if row is None:
            self._repo.release()
            raise NotFound("Reminder not found.")
        if not changes:
            self._repo.release()
            return self._view(row, None)
        kind = changes.get("kind", row.kind)
        due_date = changes.get("due_date", row.due_date)
        due_odometer = changes.get("due_odometer", row.due_odometer)
        issues = check_due_rules(kind, due_date, due_odometer)
        if issues:
            self._repo.release()
            raise InvalidInput("Request failed validation.", issues)
        updated = self._repo.apply(row, changes)
        return self._view(updated, None)

    def delete(self, reminder_id: uuid.UUID) -> None:
        if not self._repo.delete(reminder_id):
            raise NotFound("Reminder not found.")
