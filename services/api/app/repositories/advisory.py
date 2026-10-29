from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import delete, desc, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import (
    AdvisoryModelCall,
    AdvisoryProposal,
    Expense,
    Reminder,
    ServiceRecord,
    WarrantyCoverage,
)

_CAP_LOCK_KEY = 726_005  # arbitrary app-level advisory lock id for the proposal cap and the run
MODEL_CALL_RETENTION_DAYS = 396  # about 13 months


class ProposalCapReached(Exception):  # noqa: N818
    """The advisory_proposal table is full."""


class AdvisoryRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    # --- reads for the checks (nothing here is sent anywhere) --------------------------------

    def service_odometer_rows(self, since: dt.date) -> list[tuple[dt.date, int]]:
        rows = self._session.execute(
            select(ServiceRecord.date, ServiceRecord.odometer).where(ServiceRecord.date >= since)
        )
        out = [(d, int(km)) for d, km in rows]
        self._session.rollback()
        return out

    def limit_warranties(self) -> list[tuple[uuid.UUID, int, dt.date]]:
        rows = self._session.execute(
            select(WarrantyCoverage.id, WarrantyCoverage.km_limit, WarrantyCoverage.end_date).where(
                WarrantyCoverage.km_limit.is_not(None), WarrantyCoverage.end_date.is_not(None)
            )
        )
        out = [(i, int(km), d) for i, km, d in rows if km is not None and d is not None]
        self._session.rollback()
        return out

    def limit_service_reminders(self) -> list[tuple[uuid.UUID, int, dt.date]]:
        rows = self._session.execute(
            select(Reminder.id, Reminder.due_odometer, Reminder.due_date).where(
                Reminder.kind == "service",
                Reminder.completed_on.is_(None),
                Reminder.due_odometer.is_not(None),
                Reminder.due_date.is_not(None),
            )
        )
        out = [(i, int(km), d) for i, km, d in rows if km is not None and d is not None]
        self._session.rollback()
        return out

    def priced_charges(self) -> list[Expense]:
        rows = list(
            self._session.scalars(
                select(Expense)
                .where(Expense.category == "charging", Expense.energy_wh.is_not(None))
                .order_by(desc(Expense.date), desc(Expense.created_at), desc(Expense.id))
                .limit(11)
            )
        )
        self._session.expunge_all()
        self._session.rollback()
        return rows

    # --- proposals ---------------------------------------------------------------------------

    def lock_run(self) -> None:
        """Serialise check runs (and the cap) for the rest of this transaction."""
        self._session.execute(select(func.pg_advisory_xact_lock(_CAP_LOCK_KEY)))

    def existing_keys(self, keys: list[str]) -> set[str]:
        if not keys:
            return set()
        return set(
            self._session.scalars(
                select(AdvisoryProposal.dedupe_key).where(AdvisoryProposal.dedupe_key.in_(keys))
            )
        )

    def count(self) -> int:
        return int(self._session.execute(select(func.count(AdvisoryProposal.id))).scalar_one())

    def insert(self, values: dict[str, Any], max_rows: int) -> AdvisoryProposal | None:
        """Insert unless the key exists. Call lock_run() first. Raises ProposalCapReached."""
        if self.count() >= max_rows:
            raise ProposalCapReached
        stmt = (
            pg_insert(AdvisoryProposal)
            .values(**values)
            .on_conflict_do_nothing(index_elements=[AdvisoryProposal.dedupe_key])
            .returning(AdvisoryProposal)
            .execution_options(populate_existing=True)
        )
        return self._session.execute(stmt).scalar_one_or_none()

    def commit(self) -> None:
        self._session.commit()

    def rollback(self) -> None:
        self._session.rollback()

    def get(self, proposal_id: uuid.UUID) -> AdvisoryProposal | None:
        row = self._session.get(AdvisoryProposal, proposal_id, populate_existing=True)
        self._session.expunge_all()
        self._session.rollback()
        return row

    def list_page(self, status: str, limit: int) -> list[AdvisoryProposal]:
        stmt = select(AdvisoryProposal)
        if status != "all":
            stmt = stmt.where(AdvisoryProposal.status == status)
        stmt = stmt.order_by(desc(AdvisoryProposal.created_at), desc(AdvisoryProposal.id)).limit(
            limit
        )
        rows = list(self._session.scalars(stmt))
        self._session.expunge_all()
        self._session.rollback()
        return rows

    def lock(self, proposal_id: uuid.UUID) -> AdvisoryProposal | None:
        return self._session.scalars(
            select(AdvisoryProposal)
            .where(AdvisoryProposal.id == proposal_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).first()

    def decide(self, row: AdvisoryProposal, status: str) -> AdvisoryProposal:
        now = dt.datetime.now(dt.UTC)
        row.status = status
        row.decided_at = now
        row.updated_at = now
        self._session.commit()
        return row

    def release(self) -> None:
        self._session.rollback()

    # --- model calls (audit and the monthly count) -------------------------------------------

    def calls_since(self, start: dt.datetime) -> int:
        n = self._session.execute(
            select(func.count(AdvisoryModelCall.id)).where(AdvisoryModelCall.called_at >= start)
        ).scalar_one()
        self._session.rollback()
        return int(n)

    def list_calls(self, limit: int) -> list[AdvisoryModelCall]:
        rows = list(
            self._session.scalars(
                select(AdvisoryModelCall)
                .order_by(desc(AdvisoryModelCall.called_at), desc(AdvisoryModelCall.id))
                .limit(limit)
            )
        )
        self._session.expunge_all()
        self._session.rollback()
        return rows

    def purge_old_calls(self, before: dt.datetime) -> None:
        """Part of a run's transaction; the caller commits."""
        self._session.execute(delete(AdvisoryModelCall).where(AdvisoryModelCall.called_at < before))
