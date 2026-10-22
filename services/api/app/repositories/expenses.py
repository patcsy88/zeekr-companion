from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import Select, delete, desc, func, select, tuple_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import Expense
from app.repositories.service_records import HistoryKey

_CAP_LOCK_KEY = 726_002  # arbitrary app-level advisory lock id for the expense cap


class ExpenseCapReached(Exception):  # noqa: N818
    """The expense table is full."""


@dataclass(frozen=True)
class ExpenseFilter:
    category: str | None = None
    date_from: dt.date | None = None
    date_to: dt.date | None = None


@dataclass(frozen=True)
class Subtotal:
    key: str
    total_minor: int
    count: int


def _filtered[S: Select[Any]](stmt: S, flt: ExpenseFilter) -> S:
    if flt.category is not None:
        stmt = stmt.where(Expense.category == flt.category)
    if flt.date_from is not None:
        stmt = stmt.where(Expense.date >= flt.date_from)
    if flt.date_to is not None:
        stmt = stmt.where(Expense.date <= flt.date_to)
    return stmt


class ExpenseRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self, expense_id: uuid.UUID) -> Expense | None:
        row = self._session.get(Expense, expense_id, populate_existing=True)
        self._session.rollback()
        return row

    def insert_if_absent(
        self, values: dict[str, Any], max_rows: int | None = None
    ) -> Expense | None:
        """Insert unless the id exists. With max_rows, the count check and the insert share one
        transaction guarded by an advisory lock, so concurrent creates cannot exceed the cap.
        Raises ExpenseCapReached when the table is full."""
        if max_rows is not None:
            self._session.execute(select(func.pg_advisory_xact_lock(_CAP_LOCK_KEY)))
            n = self._session.execute(select(func.count()).select_from(Expense)).scalar_one()
            exists = self._session.get(Expense, values["id"], populate_existing=True)
            if exists is None and n >= max_rows:
                self._session.rollback()
                raise ExpenseCapReached
        stmt = (
            pg_insert(Expense)
            .values(**values)
            .on_conflict_do_nothing(index_elements=[Expense.id])
            .returning(Expense)
            .execution_options(populate_existing=True)
        )
        row = self._session.execute(stmt).scalar_one_or_none()
        self._session.commit()
        return row

    def lock(self, expense_id: uuid.UUID) -> Expense | None:
        """Select the row FOR UPDATE; the caller must then call apply() or release()."""
        return self._session.scalars(
            select(Expense)
            .where(Expense.id == expense_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).first()

    def apply(self, row: Expense, changes: dict[str, Any]) -> Expense:
        for name, value in changes.items():
            setattr(row, name, value)
        row.updated_at = dt.datetime.now(dt.UTC)
        self._session.commit()
        return row

    def release(self) -> None:
        self._session.rollback()

    def delete(self, expense_id: uuid.UUID) -> bool:
        result = self._session.execute(
            delete(Expense).where(Expense.id == expense_id).returning(Expense.id)
        )
        deleted = result.first() is not None
        self._session.commit()
        return deleted

    def list_page(self, limit: int, after: HistoryKey | None, flt: ExpenseFilter) -> list[Expense]:
        """Up to `limit` expenses strictly after `after` in newest-first order."""
        stmt = _filtered(
            select(Expense).order_by(
                desc(Expense.date), desc(Expense.created_at), desc(Expense.id)
            ),
            flt,
        )
        if after is not None:
            stmt = stmt.where(
                tuple_(Expense.date, Expense.created_at, Expense.id)
                < tuple_(after.date, after.created_at, after.id)
            )
        rows = list(self._session.scalars(stmt.limit(limit)))
        self._session.rollback()
        return rows

    def summarize(self, flt: ExpenseFilter) -> tuple[list[Subtotal], list[Subtotal]]:
        """Grouped (by category, by month) integer sums, computed from the rows on every call."""
        month = func.to_char(Expense.date, "YYYY-MM")
        out: list[list[Subtotal]] = []
        for key in (Expense.category, month):
            stmt = _filtered(
                select(key, func.sum(Expense.amount_minor), func.count()).group_by(key), flt
            )
            out.append(
                [Subtotal(str(k), int(s), int(c)) for k, s, c in self._session.execute(stmt)]
            )
        self._session.rollback()
        return out[0], out[1]
