from __future__ import annotations

import datetime as dt
import uuid

from app.errors import Conflict, FieldIssue, InvalidInput, NotFound
from app.repositories.expenses import ExpenseCapReached, ExpenseFilter, ExpenseRepository
from app.schemas import (
    MAX_EXPENSES,
    ExpenseCategoryTotal,
    ExpenseCreate,
    ExpenseMonthTotal,
    ExpenseOut,
    ExpensePage,
    ExpensePatch,
    ExpenseSummary,
)
from app.services.service_records import decode_cursor, encode_cursor

_CONTENT_FIELDS = ("date", "category", "amount_minor", "currency", "notes")


class ExpenseService:
    def __init__(self, repo: ExpenseRepository) -> None:
        self._repo = repo

    @staticmethod
    def _filter(
        category: str | None, date_from: dt.date | None, date_to: dt.date | None
    ) -> ExpenseFilter:
        flt = ExpenseFilter(category, date_from, date_to)
        if flt.date_from is not None and flt.date_to is not None and flt.date_from > flt.date_to:
            raise InvalidInput(
                "Request failed validation.", [FieldIssue("from", "must not be later than to")]
            )
        return flt

    def create(self, data: ExpenseCreate) -> tuple[ExpenseOut, bool]:
        """Idempotent on id. Returns (expense, created)."""
        values = data.model_dump()
        for _ in range(2):
            existing = self._repo.get(data.id)
            if existing is not None:
                if all(getattr(existing, f) == values[f] for f in _CONTENT_FIELDS):
                    return ExpenseOut.model_validate(existing), False
                raise Conflict("An expense with this id already exists with different content.")
            try:
                inserted = self._repo.insert_if_absent(values, MAX_EXPENSES)
            except ExpenseCapReached:
                raise InvalidInput(
                    "Request failed validation.",
                    [FieldIssue("body", f"at most {MAX_EXPENSES} expenses are allowed")],
                ) from None
            if inserted is not None:
                return ExpenseOut.model_validate(inserted), True
        raise Conflict("Could not create the expense; please retry.")

    def get(self, expense_id: uuid.UUID) -> ExpenseOut:
        row = self._repo.get(expense_id)
        if row is None:
            raise NotFound("Expense not found.")
        return ExpenseOut.model_validate(row)

    def list(
        self,
        limit: int,
        cursor: str | None,
        category: str | None,
        date_from: dt.date | None,
        date_to: dt.date | None,
    ) -> ExpensePage:
        flt = self._filter(category, date_from, date_to)
        after = decode_cursor(cursor) if cursor else None
        rows = self._repo.list_page(limit + 1, after, flt)
        page = rows[:limit]
        next_cursor = encode_cursor(page[-1]) if len(rows) > limit else None
        return ExpensePage(
            items=[ExpenseOut.model_validate(r) for r in page], next_cursor=next_cursor
        )

    def summary(
        self, category: str | None, date_from: dt.date | None, date_to: dt.date | None
    ) -> ExpenseSummary:
        flt = self._filter(category, date_from, date_to)
        by_cat, by_month = self._repo.summarize(flt)
        by_cat.sort(key=lambda s: (-s.total_minor, s.key))
        by_month.sort(key=lambda s: s.key, reverse=True)
        return ExpenseSummary(
            currency="MYR",
            total_minor=sum(s.total_minor for s in by_cat),
            count=sum(s.count for s in by_cat),
            by_category=[
                ExpenseCategoryTotal(
                    category=s.key,
                    total_minor=s.total_minor,
                    count=s.count,
                )
                for s in by_cat
            ],
            by_month=[
                ExpenseMonthTotal(month=s.key, total_minor=s.total_minor, count=s.count)
                for s in by_month
            ],
        )

    def update(self, expense_id: uuid.UUID, patch: ExpensePatch) -> ExpenseOut:
        changes = patch.model_dump(exclude_unset=True)
        if not changes:
            return self.get(expense_id)
        row = self._repo.lock(expense_id)
        if row is None:
            self._repo.release()
            raise NotFound("Expense not found.")
        return ExpenseOut.model_validate(self._repo.apply(row, changes))

    def delete(self, expense_id: uuid.UUID) -> None:
        if not self._repo.delete(expense_id):
            raise NotFound("Expense not found.")
