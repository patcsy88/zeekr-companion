from __future__ import annotations

import datetime as dt
import uuid
from typing import Any, cast

from sqlalchemy import CursorResult, delete, desc, select
from sqlalchemy.orm import Session

from app.models import CarCommandLog


class CarCommandLogRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, values: dict[str, Any], keep_after: dt.datetime) -> None:
        """Insert one row and delete rows older than `keep_after` in the same transaction."""
        try:
            self._session.add(CarCommandLog(id=uuid.uuid4(), **values))
            self._session.execute(
                delete(CarCommandLog).where(CarCommandLog.created_at < keep_after)
            )
            self._session.commit()
        except Exception:
            self._session.rollback()
            raise

    def last_created(self) -> dt.datetime | None:
        value = self._session.scalars(
            select(CarCommandLog.created_at).order_by(desc(CarCommandLog.created_at)).limit(1)
        ).first()
        self._session.rollback()
        return value

    def list(self, limit: int, floor: dt.datetime) -> list[CarCommandLog]:
        rows = list(
            self._session.scalars(
                select(CarCommandLog)
                .where(CarCommandLog.created_at >= floor)
                .order_by(desc(CarCommandLog.created_at), desc(CarCommandLog.id))
                .limit(limit)
            )
        )
        self._session.expunge_all()
        self._session.rollback()
        return rows

    def delete_all(self) -> int:
        result = cast("CursorResult[Any]", self._session.execute(delete(CarCommandLog)))
        self._session.commit()
        return int(result.rowcount)
