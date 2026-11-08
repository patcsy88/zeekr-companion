"""Tyre events (FR-9, approved by the owner 2026-11-08). Never linked to expenses (owner, T1)."""

from __future__ import annotations

import uuid
from typing import Any

from app.errors import Conflict, FieldIssue, InvalidInput, NotFound
from app.repositories.live_readings import LiveReadingRepository
from app.repositories.service_records import ServiceRecordRepository
from app.repositories.tyre_events import TyreEventCapReached, TyreEventRepository
from app.schemas import (
    MAX_TYRE_EVENTS,
    TYRE_ONLY_FIELDS,
    TyreEventCreate,
    TyreEventOut,
    TyreEventPage,
    TyreEventPatch,
)
from app.services.odometer import read_reminder_odometer
from app.services.service_records import decode_cursor, encode_cursor

_CONTENT_FIELDS = (
    "date",
    "kind",
    "wheels",
    "odometer",
    "brand",
    "model",
    "size",
    "cost_minor",
    "currency",
    "shop",
    "notes",
)


def check_tyre_fields(kind: str, values: dict[str, Any]) -> list[FieldIssue]:
    """Brand, model and size describe a fitted tyre, so only a Replace may carry them."""
    if kind == "replace":
        return []
    return [
        FieldIssue(f, "is only allowed when kind is replace")
        for f in TYRE_ONLY_FIELDS
        if values.get(f) is not None
    ]


class TyreEventService:
    def __init__(
        self,
        repo: TyreEventRepository,
        records: ServiceRecordRepository,
        live: LiveReadingRepository | None,
    ) -> None:
        self._repo = repo
        self._records = records
        self._live = live

    def create(self, data: TyreEventCreate) -> tuple[TyreEventOut, bool]:
        """Idempotent on id. Returns (event, created)."""
        values = data.model_dump()
        issues = check_tyre_fields(data.kind, values)
        if issues:
            raise InvalidInput("Request failed validation.", issues)
        for _ in range(2):
            existing = self._repo.get(data.id)
            if existing is not None:
                if all(getattr(existing, f) == values[f] for f in _CONTENT_FIELDS):
                    return TyreEventOut.model_validate(existing), False
                raise Conflict("A tyre event with this id already exists with different content.")
            try:
                inserted = self._repo.insert_if_absent(values, MAX_TYRE_EVENTS)
            except TyreEventCapReached:
                raise InvalidInput(
                    "Request failed validation.",
                    [FieldIssue("body", f"at most {MAX_TYRE_EVENTS} tyre events are allowed")],
                ) from None
            if inserted is not None:
                return TyreEventOut.model_validate(inserted), True
        raise Conflict("Could not create the tyre event; please retry.")

    def get(self, event_id: uuid.UUID) -> TyreEventOut:
        row = self._repo.get(event_id)
        if row is None:
            raise NotFound("Tyre event not found.")
        return TyreEventOut.model_validate(row)

    def list(self, limit: int, cursor: str | None) -> TyreEventPage:
        after = decode_cursor(cursor) if cursor else None
        rows = self._repo.list_page(limit + 1, after)
        page = rows[:limit]
        next_cursor = encode_cursor(page[-1]) if len(rows) > limit else None
        return TyreEventPage(
            items=[TyreEventOut.model_validate(r) for r in page],
            next_cursor=next_cursor,
            current_odometer=read_reminder_odometer(self._records, self._live),
        )

    def update(self, event_id: uuid.UUID, patch: TyreEventPatch) -> TyreEventOut:
        changes = patch.model_dump(exclude_unset=True)
        if not changes:
            return self.get(event_id)
        row = self._repo.lock(event_id)
        if row is None:
            self._repo.release()
            raise NotFound("Tyre event not found.")
        merged = {f: changes.get(f, getattr(row, f)) for f in TYRE_ONLY_FIELDS}
        issues = check_tyre_fields(changes.get("kind", row.kind), merged)
        if issues:
            self._repo.release()
            raise InvalidInput("Request failed validation.", issues)
        return TyreEventOut.model_validate(self._repo.apply(row, changes))

    def delete(self, event_id: uuid.UUID) -> None:
        if not self._repo.delete(event_id):
            raise NotFound("Tyre event not found.")
