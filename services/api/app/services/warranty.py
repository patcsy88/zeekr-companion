from __future__ import annotations

import datetime as dt
import uuid

from app.clock import today_kl
from app.errors import Conflict, FieldIssue, InvalidInput, NotFound
from app.models import WarrantyCoverage
from app.repositories.service_records import ServiceRecordRepository
from app.repositories.warranty import (
    ClaimCapReached,
    CoverageCapReached,
    CoverageMissing,
    WarrantyClaimRepository,
    WarrantyCoverageRepository,
)
from app.schemas import (
    MAX_WARRANTY_CLAIMS,
    MAX_WARRANTY_COVERAGES,
    WarrantyClaimCreate,
    WarrantyClaimList,
    WarrantyClaimOut,
    WarrantyClaimPatch,
    WarrantyCoverageCreate,
    WarrantyCoverageList,
    WarrantyCoverageOut,
    WarrantyCoveragePatch,
)
from app.services.odometer import read_current_odometer
from app.services.warranty_status import compute_status

_COVERAGE_FIELDS = (
    "name",
    "provider_type",
    "start_date",
    "end_date",
    "km_limit",
    "notes",
    "source_kind",
    "verification_status",
    "source_note",
    "template_ref",
)
_CLAIM_FIELDS = (
    "coverage_id",
    "date",
    "odometer",
    "description",
    "status",
    "cost_covered_minor",
    "currency",
    "notes",
)
_RANK = {"expiring_soon": 0, "active": 1, "not_started": 2, "expired": 3}
_FAR = dt.date.max


def check_coverage_rules(
    start_date: dt.date, end_date: dt.date | None, km_limit: int | None
) -> list[FieldIssue]:
    """Cross-field rules shared by create and patch (AC-49, AC-50)."""
    issues: list[FieldIssue] = []
    if end_date is None and km_limit is None:
        msg = "at least one of end_date and km_limit is required"
        issues.append(FieldIssue("end_date", msg))
        issues.append(FieldIssue("km_limit", msg))
    if end_date is not None and end_date < start_date:
        issues.append(FieldIssue("end_date", "must not be before start_date"))
    return issues


class WarrantyCoverageService:
    def __init__(self, repo: WarrantyCoverageRepository, records: ServiceRecordRepository) -> None:
        self._repo = repo
        self._records = records

    @staticmethod
    def _out(
        row: WarrantyCoverage, today: dt.date, km: int | None, count: int
    ) -> WarrantyCoverageOut:
        status, expired_by, soon_by = compute_status(
            start_date=row.start_date,
            end_date=row.end_date,
            km_limit=row.km_limit,
            current_odometer_km=km,
            today=today,
        )
        return WarrantyCoverageOut(
            id=row.id,
            name=row.name,
            provider_type=row.provider_type,
            start_date=row.start_date,
            end_date=row.end_date,
            km_limit=row.km_limit,
            notes=row.notes,
            source_kind=row.source_kind,
            verification_status=row.verification_status,
            source_note=row.source_note,
            template_ref=row.template_ref,
            status=status,
            expired_by=expired_by,
            expiring_soon_by=soon_by,
            claim_count=count,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    def _view(self, row: WarrantyCoverage, today: dt.date | None) -> WarrantyCoverageOut:
        odo = read_current_odometer(self._records)
        count = self._repo.claim_count(row.id)
        return self._out(row, today or today_kl(), odo.km if odo else None, count)

    def create(self, data: WarrantyCoverageCreate) -> tuple[WarrantyCoverageOut, bool]:
        issues = check_coverage_rules(data.start_date, data.end_date, data.km_limit)
        if data.template_ref is not None and data.source_kind != "template":
            issues.append(FieldIssue("template_ref", "requires source_kind template"))
        if issues:
            raise InvalidInput("Request failed validation.", issues)
        values = data.model_dump()
        for _ in range(2):
            existing = self._repo.get(data.id)
            if existing is not None:
                if all(getattr(existing, f) == values[f] for f in _COVERAGE_FIELDS):
                    return self._view(existing, None), False
                raise Conflict("A coverage with this id already exists with different content.")
            try:
                inserted = self._repo.insert_if_absent(values, MAX_WARRANTY_COVERAGES)
            except CoverageCapReached:
                raise InvalidInput(
                    "Request failed validation.",
                    [FieldIssue("body", f"at most {MAX_WARRANTY_COVERAGES} coverages are allowed")],
                ) from None
            if inserted is not None:
                return self._view(inserted, None), True
        raise Conflict("Could not create the coverage; please retry.")

    def get(self, coverage_id: uuid.UUID, today: dt.date | None) -> WarrantyCoverageOut:
        row = self._repo.get(coverage_id)
        if row is None:
            raise NotFound("Coverage not found.")
        return self._view(row, today)

    def list(self, today: dt.date | None) -> WarrantyCoverageList:
        day = today or today_kl()
        odo = read_current_odometer(self._records)
        km = odo.km if odo else None
        counts = self._repo.claim_counts()
        items = [self._out(r, day, km, counts.get(r.id, 0)) for r in self._repo.list_all()]
        items.sort(
            key=lambda i: (
                _RANK[i.status],
                i.end_date is None,
                i.end_date or _FAR,
                i.name,
                str(i.id),
            )
        )
        return WarrantyCoverageList(items=items, current_odometer=odo)

    def update(self, coverage_id: uuid.UUID, patch: WarrantyCoveragePatch) -> WarrantyCoverageOut:
        changes = patch.model_dump(exclude_unset=True)
        row = self._repo.lock(coverage_id)
        if row is None:
            self._repo.release()
            raise NotFound("Coverage not found.")
        if not changes:
            self._repo.release()
            return self._view(row, None)
        issues = check_coverage_rules(
            changes.get("start_date", row.start_date),
            changes.get("end_date", row.end_date),
            changes.get("km_limit", row.km_limit),
        )
        if issues:
            self._repo.release()
            raise InvalidInput("Request failed validation.", issues)
        return self._view(self._repo.apply(row, changes), None)

    def delete(self, coverage_id: uuid.UUID) -> None:
        if not self._repo.delete(coverage_id):
            raise NotFound("Coverage not found.")


class WarrantyClaimService:
    def __init__(self, repo: WarrantyClaimRepository) -> None:
        self._repo = repo

    def create(self, data: WarrantyClaimCreate) -> tuple[WarrantyClaimOut, bool]:
        values = data.model_dump()
        for _ in range(2):
            existing = self._repo.get(data.id)
            if existing is not None:
                if all(getattr(existing, f) == values[f] for f in _CLAIM_FIELDS):
                    return WarrantyClaimOut.model_validate(existing), False
                raise Conflict("A claim with this id already exists with different content.")
            try:
                inserted = self._repo.insert_if_absent(values, MAX_WARRANTY_CLAIMS)
            except CoverageMissing:
                raise InvalidInput(
                    "Request failed validation.",
                    [FieldIssue("coverage_id", "coverage does not exist")],
                ) from None
            except ClaimCapReached:
                raise InvalidInput(
                    "Request failed validation.",
                    [FieldIssue("body", f"at most {MAX_WARRANTY_CLAIMS} claims are allowed")],
                ) from None
            if inserted is not None:
                return WarrantyClaimOut.model_validate(inserted), True
        raise Conflict("Could not create the claim; please retry.")

    def get(self, claim_id: uuid.UUID) -> WarrantyClaimOut:
        row = self._repo.get(claim_id)
        if row is None:
            raise NotFound("Claim not found.")
        return WarrantyClaimOut.model_validate(row)

    def list(self, coverage_id: uuid.UUID | None) -> WarrantyClaimList:
        return WarrantyClaimList(
            items=[WarrantyClaimOut.model_validate(r) for r in self._repo.list_all(coverage_id)]
        )

    def update(self, claim_id: uuid.UUID, patch: WarrantyClaimPatch) -> WarrantyClaimOut:
        changes = patch.model_dump(exclude_unset=True)
        if not changes:
            return self.get(claim_id)
        row = self._repo.lock(claim_id)
        if row is None:
            self._repo.release()
            raise NotFound("Claim not found.")
        return WarrantyClaimOut.model_validate(self._repo.apply(row, changes))

    def delete(self, claim_id: uuid.UUID) -> None:
        if not self._repo.delete(claim_id):
            raise NotFound("Claim not found.")
