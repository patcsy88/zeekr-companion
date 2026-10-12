from __future__ import annotations

import base64
import binascii
import datetime as dt
import json
import uuid

from app.errors import Conflict, FieldIssue, InvalidInput, NotFound
from app.models import ServiceRecord
from app.repositories.service_records import HistoryKey, ServiceRecordRepository
from app.schemas import (
    ServiceRecordCreate,
    ServiceRecordOut,
    ServiceRecordPage,
    ServiceRecordPatch,
)

_CONTENT_FIELDS = (
    "date",
    "odometer",
    "provider",
    "description",
    "cost_minor",
    "currency",
    "notes",
)


def encode_cursor(record: ServiceRecord) -> str:
    payload = json.dumps(
        {
            "d": record.date.isoformat(),
            "c": record.created_at.astimezone(dt.UTC).isoformat(),
            "i": str(record.id),
        },
        separators=(",", ":"),
    )
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> HistoryKey:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        data = json.loads(raw)
        created_at = dt.datetime.fromisoformat(data["c"])
        if created_at.tzinfo is None:
            raise ValueError("naive timestamp")
        return HistoryKey(
            date=dt.date.fromisoformat(data["d"]),
            created_at=created_at,
            id=uuid.UUID(data["i"]),
        )
    except (ValueError, KeyError, TypeError, binascii.Error) as exc:
        raise InvalidInput(
            "Invalid cursor.", [FieldIssue("cursor", "is not a valid cursor")]
        ) from exc


class ServiceRecordService:
    def __init__(self, repo: ServiceRecordRepository) -> None:
        self._repo = repo

    def create(self, data: ServiceRecordCreate) -> tuple[ServiceRecordOut, bool]:
        """Idempotent on id. Returns (record, created)."""
        values = data.model_dump()
        for _ in range(2):  # second pass covers a delete racing between insert and read
            inserted = self._repo.insert_if_absent(values)
            if inserted is not None:
                return ServiceRecordOut.model_validate(inserted), True
            existing = self._repo.get(data.id)
            if existing is None:
                continue
            if all(getattr(existing, f) == values[f] for f in _CONTENT_FIELDS):
                return ServiceRecordOut.model_validate(existing), False
            raise Conflict("A service record with this id already exists with different content.")
        raise Conflict("Could not create the service record; please retry.")

    def get(self, record_id: uuid.UUID) -> ServiceRecordOut:
        record = self._repo.get(record_id)
        if record is None:
            raise NotFound("Service record not found.")
        return ServiceRecordOut.model_validate(record)

    def list(self, limit: int, cursor: str | None) -> ServiceRecordPage:
        after = decode_cursor(cursor) if cursor else None
        rows = self._repo.list_page(limit + 1, after)
        page = rows[:limit]
        next_cursor = encode_cursor(page[-1]) if len(rows) > limit else None
        return ServiceRecordPage(
            items=[ServiceRecordOut.model_validate(r) for r in page], next_cursor=next_cursor
        )

    def update(self, record_id: uuid.UUID, patch: ServiceRecordPatch) -> ServiceRecordOut:
        changes = patch.model_dump(exclude_unset=True)
        if not changes:
            return self.get(record_id)
        record = self._repo.update(record_id, changes)
        if record is None:
            raise NotFound("Service record not found.")
        return ServiceRecordOut.model_validate(record)

    def delete(self, record_id: uuid.UUID) -> None:
        if not self._repo.delete(record_id):
            raise NotFound("Service record not found.")
