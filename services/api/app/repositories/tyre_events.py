from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import delete, desc, func, select, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import TyreEvent
from app.repositories.service_records import HistoryKey

_CAP_LOCK_KEY = 726_006  # arbitrary app-level advisory lock id for the tyre event cap


class TyreEventCapReached(Exception):  # noqa: N818
    """The tyre event table is full."""


class TyreEventRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, event_id: uuid.UUID) -> TyreEvent | None:
        row = self._session.get(TyreEvent, event_id, populate_existing=True)
        self._session.rollback()
        return row

    def insert_if_absent(self, values: dict[str, Any], max_rows: int) -> TyreEvent | None:
        """Insert unless the id exists. The count check and the insert share one transaction
        guarded by an advisory lock, so concurrent creates cannot exceed the cap."""
        self._session.execute(select(func.pg_advisory_xact_lock(_CAP_LOCK_KEY)))
        n = self._session.execute(select(func.count()).select_from(TyreEvent)).scalar_one()
        exists = self._session.get(TyreEvent, values["id"], populate_existing=True)
        if exists is None and n >= max_rows:
            self._session.rollback()
            raise TyreEventCapReached
        stmt = (
            pg_insert(TyreEvent)
            .values(**values)
            .on_conflict_do_nothing(index_elements=[TyreEvent.id])
            .returning(TyreEvent)
            .execution_options(populate_existing=True)
        )
        row = self._session.execute(stmt).scalar_one_or_none()
        self._session.commit()
        return row

    def lock(self, event_id: uuid.UUID) -> TyreEvent | None:
        """Select the row FOR UPDATE; the caller must then call apply() or release()."""
        return self._session.scalars(
            select(TyreEvent)
            .where(TyreEvent.id == event_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).first()

    def apply(self, row: TyreEvent, changes: dict[str, Any]) -> TyreEvent:
        for name, value in changes.items():
            setattr(row, name, value)
        row.updated_at = dt.datetime.now(dt.UTC)
        self._session.commit()
        return row

    def release(self) -> None:
        self._session.rollback()

    def delete(self, event_id: uuid.UUID) -> bool:
        result = self._session.execute(
            delete(TyreEvent).where(TyreEvent.id == event_id).returning(TyreEvent.id)
        )
        deleted = result.first() is not None
        self._session.commit()
        return deleted

    def list_page(self, limit: int, after: HistoryKey | None) -> list[TyreEvent]:
        """Up to `limit` events strictly after `after` in newest-first order."""
        stmt = select(TyreEvent).order_by(
            desc(TyreEvent.date), desc(TyreEvent.created_at), desc(TyreEvent.id)
        )
        if after is not None:
            stmt = stmt.where(
                tuple_(TyreEvent.date, TyreEvent.created_at, TyreEvent.id)
                < tuple_(after.date, after.created_at, after.id)
            )
        rows = list(self._session.scalars(stmt.limit(limit)))
        self._session.rollback()
        return rows
