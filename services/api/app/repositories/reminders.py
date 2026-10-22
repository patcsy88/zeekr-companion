from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import Reminder

_CAP_LOCK_KEY = 726_001  # arbitrary app-level advisory lock id for the reminder cap


class ReminderCapReached(Exception):  # noqa: N818
    """The reminder table is full."""


class ReminderRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, reminder_id: uuid.UUID) -> Reminder | None:
        row = self._session.get(Reminder, reminder_id, populate_existing=True)
        self._session.rollback()
        return row

    def count(self) -> int:
        n = self._session.execute(select(func.count()).select_from(Reminder)).scalar_one()
        self._session.rollback()
        return n

    def list_all(self) -> list[Reminder]:
        rows = list(self._session.scalars(select(Reminder)))
        self._session.rollback()
        return rows

    def insert_if_absent(
        self, values: dict[str, Any], max_rows: int | None = None
    ) -> Reminder | None:
        """Insert unless the id exists. With max_rows, the count check and the insert share one
        transaction guarded by an advisory lock, so concurrent creates cannot exceed the cap.
        Raises ReminderCapReached when the table is full."""
        if max_rows is not None:
            self._session.execute(select(func.pg_advisory_xact_lock(_CAP_LOCK_KEY)))
            n = self._session.execute(select(func.count()).select_from(Reminder)).scalar_one()
            exists = self._session.get(Reminder, values["id"], populate_existing=True)
            if exists is None and n >= max_rows:
                self._session.rollback()
                raise ReminderCapReached
        stmt = (
            pg_insert(Reminder)
            .values(**values)
            .on_conflict_do_nothing(index_elements=[Reminder.id])
            .returning(Reminder)
            .execution_options(populate_existing=True)
        )
        row = self._session.execute(stmt).scalar_one_or_none()
        self._session.commit()
        return row

    def lock(self, reminder_id: uuid.UUID) -> Reminder | None:
        """Select the row FOR UPDATE; the caller must then call apply() or release()."""
        return self._session.scalars(
            select(Reminder)
            .where(Reminder.id == reminder_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).first()

    def apply(self, row: Reminder, changes: dict[str, Any]) -> Reminder:
        for name, value in changes.items():
            setattr(row, name, value)
        row.updated_at = dt.datetime.now(dt.UTC)
        self._session.commit()
        return row

    def release(self) -> None:
        self._session.rollback()

    def delete(self, reminder_id: uuid.UUID) -> bool:
        result = self._session.execute(
            delete(Reminder).where(Reminder.id == reminder_id).returning(Reminder.id)
        )
        deleted = result.first() is not None
        self._session.commit()
        return deleted
