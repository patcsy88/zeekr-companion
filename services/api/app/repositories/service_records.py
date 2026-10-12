from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import delete, desc, select, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import ServiceRecord


@dataclass(frozen=True)
class HistoryKey:
    """Position in the newest-first ordering (date, created_at, id), all descending."""

    date: dt.date
    created_at: dt.datetime
    id: uuid.UUID


class ServiceRecordRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, record_id: uuid.UUID) -> ServiceRecord | None:
        return self._session.get(ServiceRecord, record_id, populate_existing=True)

    def insert_if_absent(self, values: dict[str, Any]) -> ServiceRecord | None:
        """Insert; return None if a record with this id already exists (race-safe)."""
        stmt = (
            pg_insert(ServiceRecord)
            .values(**values)
            .on_conflict_do_nothing(index_elements=[ServiceRecord.id])
            .returning(ServiceRecord)
            .execution_options(populate_existing=True)
        )
        row = self._session.execute(stmt).scalar_one_or_none()
        self._session.commit()
        return row

    def update(self, record_id: uuid.UUID, changes: dict[str, Any]) -> ServiceRecord | None:
        row = self._session.scalars(
            select(ServiceRecord)
            .where(ServiceRecord.id == record_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).first()
        if row is None:
            self._session.rollback()
            return None
        for name, value in changes.items():
            setattr(row, name, value)
        row.updated_at = dt.datetime.now(dt.UTC)
        self._session.commit()
        return row

    def delete(self, record_id: uuid.UUID) -> bool:
        result = self._session.execute(
            delete(ServiceRecord).where(ServiceRecord.id == record_id).returning(ServiceRecord.id)
        )
        deleted = result.first() is not None
        self._session.commit()
        return deleted

    def list_page(self, limit: int, after: HistoryKey | None) -> list[ServiceRecord]:
        """Return up to `limit` records strictly after `after` in newest-first order."""
        stmt = select(ServiceRecord).order_by(
            desc(ServiceRecord.date), desc(ServiceRecord.created_at), desc(ServiceRecord.id)
        )
        if after is not None:
            stmt = stmt.where(
                tuple_(ServiceRecord.date, ServiceRecord.created_at, ServiceRecord.id)
                < tuple_(after.date, after.created_at, after.id)
            )
        rows = list(self._session.scalars(stmt.limit(limit)))
        self._session.rollback()  # end the read-only transaction
        return rows
