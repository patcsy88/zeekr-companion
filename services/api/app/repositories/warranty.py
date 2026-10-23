from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import delete, desc, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import WarrantyClaim, WarrantyCoverage

_COVERAGE_CAP_LOCK_KEY = 726_003  # arbitrary app-level advisory lock ids for the caps
_CLAIM_CAP_LOCK_KEY = 726_004


class CoverageCapReached(Exception):  # noqa: N818
    """The warranty_coverage table is full."""


class ClaimCapReached(Exception):  # noqa: N818
    """The warranty_claim table is full."""


class CoverageMissing(Exception):  # noqa: N818
    """The claim's coverage does not exist."""


class WarrantyCoverageRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def _end_read(self) -> None:
        """End a read-only transaction without expiring the rows just loaded."""
        self._session.expunge_all()
        self._session.rollback()

    def get(self, coverage_id: uuid.UUID) -> WarrantyCoverage | None:
        row = self._session.get(WarrantyCoverage, coverage_id, populate_existing=True)
        self._end_read()
        return row

    def claim_counts(self) -> dict[uuid.UUID, int]:
        rows = self._session.execute(
            select(WarrantyClaim.coverage_id, func.count()).group_by(WarrantyClaim.coverage_id)
        )
        out = {cid: int(n) for cid, n in rows}
        self._session.rollback()
        return out

    def claim_count(self, coverage_id: uuid.UUID) -> int:
        n = self._session.execute(
            select(func.count())
            .select_from(WarrantyClaim)
            .where(WarrantyClaim.coverage_id == coverage_id)
        ).scalar_one()
        self._session.rollback()
        return int(n)

    def list_all(self) -> list[WarrantyCoverage]:
        rows = list(self._session.scalars(select(WarrantyCoverage)))
        self._end_read()
        return rows

    def insert_if_absent(
        self, values: dict[str, Any], max_rows: int | None = None
    ) -> WarrantyCoverage | None:
        """Insert unless the id exists. The count check and insert share one transaction guarded
        by an advisory lock. Raises CoverageCapReached when the table is full."""
        if max_rows is not None:
            self._session.execute(select(func.pg_advisory_xact_lock(_COVERAGE_CAP_LOCK_KEY)))
            n = self._session.execute(
                select(func.count()).select_from(WarrantyCoverage)
            ).scalar_one()
            exists = self._session.get(WarrantyCoverage, values["id"], populate_existing=True)
            if exists is None and n >= max_rows:
                self._session.rollback()
                raise CoverageCapReached
        stmt = (
            pg_insert(WarrantyCoverage)
            .values(**values)
            .on_conflict_do_nothing(index_elements=[WarrantyCoverage.id])
            .returning(WarrantyCoverage)
            .execution_options(populate_existing=True)
        )
        row = self._session.execute(stmt).scalar_one_or_none()
        self._session.commit()
        return row

    def lock(self, coverage_id: uuid.UUID) -> WarrantyCoverage | None:
        """Select the row FOR UPDATE; the caller must then call apply() or release()."""
        return self._session.scalars(
            select(WarrantyCoverage)
            .where(WarrantyCoverage.id == coverage_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).first()

    def apply(self, row: WarrantyCoverage, changes: dict[str, Any]) -> WarrantyCoverage:
        for name, value in changes.items():
            setattr(row, name, value)
        row.updated_at = dt.datetime.now(dt.UTC)
        # Load the final values inside the transaction and detach the row, so the commit cannot
        # expire it and a delete racing in afterwards cannot turn the response into a 500.
        self._session.flush()
        self._session.refresh(row)
        self._session.expunge(row)
        self._session.commit()
        return row

    def release(self) -> None:
        self._session.rollback()

    def delete(self, coverage_id: uuid.UUID) -> bool:
        """Delete the coverage; its claims go with it (ON DELETE CASCADE)."""
        result = self._session.execute(
            delete(WarrantyCoverage)
            .where(WarrantyCoverage.id == coverage_id)
            .returning(WarrantyCoverage.id)
        )
        deleted = result.first() is not None
        self._session.commit()
        return deleted


class WarrantyClaimRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def _end_read(self) -> None:
        """End a read-only transaction without expiring the rows just loaded."""
        self._session.expunge_all()
        self._session.rollback()

    def get(self, claim_id: uuid.UUID) -> WarrantyClaim | None:
        row = self._session.get(WarrantyClaim, claim_id, populate_existing=True)
        self._end_read()
        return row

    def list_all(self, coverage_id: uuid.UUID | None) -> list[WarrantyClaim]:
        stmt = select(WarrantyClaim).order_by(
            desc(WarrantyClaim.date), desc(WarrantyClaim.created_at), desc(WarrantyClaim.id)
        )
        if coverage_id is not None:
            stmt = stmt.where(WarrantyClaim.coverage_id == coverage_id)
        rows = list(self._session.scalars(stmt))
        self._end_read()
        return rows

    def insert_if_absent(
        self, values: dict[str, Any], max_rows: int | None = None
    ) -> WarrantyClaim | None:
        """Insert unless the id exists. The coverage row is share-locked so it cannot be deleted
        before the insert commits. Raises CoverageMissing or ClaimCapReached."""
        exists = self._session.get(WarrantyClaim, values["id"], populate_existing=True)
        if exists is None:
            parent = self._session.scalars(
                select(WarrantyCoverage.id)
                .where(WarrantyCoverage.id == values["coverage_id"])
                .with_for_update(read=True)
            ).first()
            if parent is None:
                self._session.rollback()
                raise CoverageMissing
        if max_rows is not None:
            self._session.execute(select(func.pg_advisory_xact_lock(_CLAIM_CAP_LOCK_KEY)))
            n = self._session.execute(select(func.count()).select_from(WarrantyClaim)).scalar_one()
            if exists is None and n >= max_rows:
                self._session.rollback()
                raise ClaimCapReached
        stmt = (
            pg_insert(WarrantyClaim)
            .values(**values)
            .on_conflict_do_nothing(index_elements=[WarrantyClaim.id])
            .returning(WarrantyClaim)
            .execution_options(populate_existing=True)
        )
        row = self._session.execute(stmt).scalar_one_or_none()
        self._session.commit()
        return row

    def lock(self, claim_id: uuid.UUID) -> WarrantyClaim | None:
        return self._session.scalars(
            select(WarrantyClaim)
            .where(WarrantyClaim.id == claim_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).first()

    def apply(self, row: WarrantyClaim, changes: dict[str, Any]) -> WarrantyClaim:
        for name, value in changes.items():
            setattr(row, name, value)
        row.updated_at = dt.datetime.now(dt.UTC)
        self._session.commit()
        return row

    def release(self) -> None:
        self._session.rollback()

    def delete(self, claim_id: uuid.UUID) -> bool:
        result = self._session.execute(
            delete(WarrantyClaim).where(WarrantyClaim.id == claim_id).returning(WarrantyClaim.id)
        )
        deleted = result.first() is not None
        self._session.commit()
        return deleted
