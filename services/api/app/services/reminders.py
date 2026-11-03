from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy.exc import IntegrityError

from app.clock import add_months, today_kl
from app.errors import Conflict, FieldIssue, InvalidInput, NotFound
from app.models import Reminder, ServiceRecord
from app.repositories.live_readings import LiveReadingRepository
from app.repositories.reminders import ReminderCapReached, ReminderRepository
from app.repositories.service_records import ServiceRecordRepository
from app.schemas import (
    MAX_ODOMETER_KM,
    MAX_REMINDERS,
    CurrentOdometer,
    ReminderCreate,
    ReminderList,
    ReminderOut,
    ReminderPatch,
    ServiceCompleteIn,
    ServiceCompleteOut,
    ServiceRecordOut,
)
from app.services.odometer import read_reminder_odometer
from app.services.reminder_status import compute_status
from app.services.reminder_templates import STEP_KM, STEP_MONTHS, TEMPLATE_ID

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
    def __init__(
        self,
        repo: ReminderRepository,
        records: ServiceRecordRepository,
        live: LiveReadingRepository | None = None,
    ) -> None:
        self._repo = repo
        self._records = records
        self._live = live

    def _current_odometer(self) -> CurrentOdometer | None:
        return read_reminder_odometer(self._records, self._live)

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

    def complete_service(
        self, reminder_id: uuid.UUID, data: ServiceCompleteIn
    ) -> tuple[ServiceCompleteOut, bool]:
        """Record the service, complete the reminder and create the next one, all or nothing.
        Returns (result, created); a replay with identical content returns created False."""
        row = self._repo.lock(reminder_id)
        if row is None:
            self._repo.release()
            raise NotFound("Reminder not found.")
        record_values = {
            "id": data.record_id,
            "date": data.date,
            "odometer": data.odometer,
            "provider": data.provider,
            "description": data.description or row.title,
            "cost_minor": data.cost_minor,
            "currency": "MYR",
            "notes": data.notes,
        }
        try:
            next_values = self._next_values(row, data)
            return self._complete_locked(row, data, record_values, next_values)
        except (InvalidInput, Conflict):
            self._repo.release()
            raise

    @staticmethod
    def _next_values(row: Reminder, data: ServiceCompleteIn) -> dict[str, object] | None:
        parts = (row.template_ref or "").split(":")
        if row.kind != "service" or len(parts) != 3 or parts[0] != TEMPLATE_ID:
            return None
        due_odometer = data.odometer + STEP_KM
        if due_odometer > MAX_ODOMETER_KM:
            raise InvalidInput(
                "Request failed validation.",
                [FieldIssue("odometer", "the next service would be beyond the odometer limit")],
            )
        return {
            "id": data.next_id,
            "kind": "service",
            "title": f"Next service ({due_odometer:,} km)",
            "due_date": add_months(data.date, STEP_MONTHS),
            "due_odometer": due_odometer,
            "notes": None,
            "completed_on": None,
            "template_ref": row.template_ref,
        }

    def _complete_locked(
        self,
        row: Reminder,
        data: ServiceCompleteIn,
        record_values: dict[str, object],
        next_values: dict[str, object] | None,
    ) -> tuple[ServiceCompleteOut, bool]:
        record = self._repo.existing_in_tx(ServiceRecord, data.record_id)
        if record is not None:
            if row.completed_on != data.date or not self._same_result(
                record, record_values, next_values
            ):
                raise Conflict("These ids were already used with different content.")
            return self._result(row, record, next_values), False
        if row.completed_on is not None:
            raise InvalidInput(
                "Request failed validation.", [FieldIssue("body", "the reminder is already done")]
            )
        if row.kind != "service":
            raise InvalidInput(
                "Request failed validation.",
                [FieldIssue("body", "only a service reminder can be completed this way")],
            )
        known = self._current_odometer()
        if known is not None and data.odometer < known.km:
            raise InvalidInput(
                "Request failed validation.",
                [
                    FieldIssue(
                        "odometer", f"is lower than the latest known odometer ({known.km:,} km)"
                    )
                ],
            )
        if next_values is not None:
            if self._repo.existing_in_tx(Reminder, data.next_id) is not None:
                raise Conflict("A reminder with next_id already exists.")
            if self._repo.reminder_count() >= MAX_REMINDERS:
                raise InvalidInput(
                    "Request failed validation.",
                    [FieldIssue("body", f"at most {MAX_REMINDERS} reminders are allowed")],
                )
        try:
            self._repo.commit_complete(row, data.date, record_values, next_values)
        except IntegrityError:
            raise Conflict("Could not complete the service; please retry.") from None
        saved = self._records.get(data.record_id)
        if saved is None:
            raise Conflict("Could not complete the service; please retry.")
        return self._result(row, saved, next_values), True

    def _same_result(
        self,
        record: ServiceRecord,
        record_values: dict[str, object],
        next_values: dict[str, object] | None,
    ) -> bool:
        fields = ("date", "odometer", "provider", "description", "cost_minor", "currency", "notes")
        if not all(getattr(record, f) == record_values[f] for f in fields):
            return False
        if next_values is None:
            return True
        nxt = self._repo.existing_in_tx(Reminder, next_values["id"])  # type: ignore[arg-type]
        return nxt is not None and all(getattr(nxt, f) == next_values[f] for f in _CONTENT_FIELDS)

    def _result(
        self, row: Reminder, record: ServiceRecord, next_values: dict[str, object] | None
    ) -> ServiceCompleteOut:
        nxt_row = (
            self._repo.get(next_values["id"])  # type: ignore[arg-type]
            if next_values is not None
            else None
        )
        out_record = ServiceRecordOut.model_validate(record)
        done = self._repo.get(row.id)
        if done is None:
            raise NotFound("Reminder not found.")
        return ServiceCompleteOut(
            service_record=out_record,
            reminder=self._view(done, None),
            next_reminder=self._view(nxt_row, None) if nxt_row is not None else None,
        )
