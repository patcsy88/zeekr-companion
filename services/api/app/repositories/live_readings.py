from __future__ import annotations

import datetime as dt
import uuid
from typing import Any, cast

from sqlalchemy import CursorResult, delete, desc, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import LiveReading


class LiveReadingRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def latest(self) -> LiveReading | None:
        row = self._session.scalars(
            select(LiveReading)
            .order_by(desc(LiveReading.observed_at), desc(LiveReading.id))
            .limit(1)
        ).first()
        self._session.expunge_all()
        self._session.rollback()
        return row

    def store(self, values: dict[str, Any], keep_after: dt.datetime) -> bool:
        """Insert unless a row with the same `observed_at` exists. When a row is stored, rows with
        `observed_at` before `keep_after` are deleted in the same transaction."""
        stmt = (
            pg_insert(LiveReading)
            .values(id=uuid.uuid4(), **values)
            .on_conflict_do_nothing(index_elements=[LiveReading.observed_at])
            .returning(LiveReading.id)
        )
        inserted = self._session.execute(stmt).scalar_one_or_none() is not None
        if inserted:
            self._session.execute(delete(LiveReading).where(LiveReading.observed_at < keep_after))
        self._session.commit()
        return inserted

    def list(self, limit: int, since: dt.datetime | None) -> list[LiveReading]:
        stmt = select(LiveReading).order_by(desc(LiveReading.observed_at), desc(LiveReading.id))
        if since is not None:
            stmt = stmt.where(LiveReading.observed_at >= since)
        rows = list(self._session.scalars(stmt.limit(limit)))
        self._session.expunge_all()
        self._session.rollback()
        return rows

    def delete_all(self) -> int:
        result = cast("CursorResult[Any]", self._session.execute(delete(LiveReading)))
        self._session.commit()
        return int(result.rowcount)
