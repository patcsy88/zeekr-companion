"""Advisory proposals (ADR-008): run the checks, store findings, record decisions.

The model is not built in this step: every proposal is stored with `explanation_status`
`disabled`. Nothing is sent anywhere, and nothing here changes a reminder, expense, warranty or
service record.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from app.adapters.telemetry import RecordsTelemetryProvider
from app.clock import KUALA_LUMPUR, today_kl
from app.config import Settings
from app.errors import Conflict, FieldIssue, InvalidInput, NotFound
from app.models import AdvisoryModelCall, AdvisoryProposal
from app.repositories.advisory import (
    MODEL_CALL_RETENTION_DAYS,
    AdvisoryRepository,
    ProposalCapReached,
)
from app.repositories.service_records import ServiceRecordRepository
from app.schemas import (
    AdvisoryDecision,
    AdvisoryModelCallList,
    AdvisoryModelCallOut,
    AdvisoryModelRun,
    AdvisoryProposalList,
    AdvisoryProposalOut,
    AdvisoryProvenance,
    AdvisoryRunOut,
    AdvisorySkipped,
    AdvisoryStatusOut,
)
from app.services import advisory_checks as checks

MAX_PROPOSALS = 2000


def month_start_kl(today: dt.date) -> dt.datetime:
    """Start of the Asia/Kuala_Lumpur calendar month, in UTC."""
    first = dt.datetime(today.year, today.month, 1, tzinfo=KUALA_LUMPUR)
    return first.astimezone(dt.UTC)


def to_out(row: AdvisoryProposal) -> AdvisoryProposalOut:
    return AdvisoryProposalOut.model_validate(
        {
            "id": row.id,
            "condition": row.condition,
            "status": row.status,
            "inputs": row.inputs,
            "source_refs": row.source_refs,
            "explanation": row.explanation,
            "explanation_status": row.explanation_status,
            "urgency": row.urgency,
            "suggestion": row.suggestion,
            "provenance": AdvisoryProvenance(
                rule_version=row.rule_version,
                prompt_version=row.prompt_version,
                model_id=row.model_id,
            ),
            "created_at": row.created_at,
            "updated_at": row.updated_at,
            "decided_at": row.decided_at,
        }
    )


class AdvisoryService:
    def __init__(
        self,
        repo: AdvisoryRepository,
        records: ServiceRecordRepository,
        settings: Settings,
    ) -> None:
        self._repo = repo
        self._records = records
        self._settings = settings

    def _model_status(self) -> str:
        # No model call is built yet (ADR-008 step 4), so an enabled switch cannot be used.
        return "unavailable" if self._settings.advisory_model_enabled else "disabled"

    def _run_model_block(self, today: dt.date) -> AdvisoryModelRun:
        calls = self._repo.calls_since(month_start_kl(today))
        return AdvisoryModelRun(
            status=self._model_status(),
            calls_this_month=calls,
            monthly_limit=self._settings.advisory_monthly_call_limit,
        )

    def status(self, today: dt.date | None = None) -> AdvisoryStatusOut:
        today = today or today_kl()
        return AdvisoryStatusOut(
            model_enabled=self._settings.advisory_model_enabled,
            model_id=self._settings.advisory_model_id,
            calls_this_month=self._repo.calls_since(month_start_kl(today)),
            monthly_limit=self._settings.advisory_monthly_call_limit,
            month=f"{today.year:04d}-{today.month:02d}",
        )

    def _collect(self, today: dt.date) -> checks.CheckOutcome:
        since = today - dt.timedelta(days=checks.PACE_WINDOW_DAYS)
        samples = [
            checks.OdometerSample(d, km) for d, km in self._repo.service_odometer_rows(since)
        ]
        current = RecordsTelemetryProvider(self._records).read_odometer().value
        subjects = [
            checks.LimitSubject("warranty_coverage", i, km, d)
            for i, km, d in self._repo.limit_warranties()
        ] + [
            checks.LimitSubject("reminder", i, km, d)
            for i, km, d in self._repo.limit_service_reminders()
        ]
        charges = [
            checks.ChargeSample(c.id, c.date, c.created_at, c.amount_minor, c.energy_wh)
            for c in self._repo.priced_charges()
        ]
        a = checks.check_date_vs_km(subjects, samples, current, today)
        b = checks.check_charging_cost_drift(charges)
        return checks.CheckOutcome(a.findings + b.findings, a.skipped + b.skipped)

    def run(self, today: dt.date | None = None) -> AdvisoryRunOut:
        today = today or today_kl()
        outcome = self._collect(today)
        model_status = self._model_status()
        explanation_status = "unavailable" if model_status == "unavailable" else "disabled"
        created: list[AdvisoryProposalOut] = []
        unchanged = 0
        try:
            self._repo.lock_run()
            cutoff = dt.datetime.now(dt.UTC) - dt.timedelta(days=MODEL_CALL_RETENTION_DAYS)
            self._repo.purge_old_calls(cutoff)
            known = self._repo.existing_keys([f.dedupe_key for f in outcome.findings])
            for f in outcome.findings:
                if f.dedupe_key in known:
                    unchanged += 1
                    continue
                values: dict[str, Any] = {
                    "id": uuid.uuid4(),
                    "condition": f.condition,
                    "dedupe_key": f.dedupe_key,
                    "status": "proposed",
                    "inputs": f.inputs,
                    "source_refs": [{"kind": r.kind, "id": str(r.id)} for r in f.source_refs],
                    "explanation": None,
                    "explanation_status": explanation_status,
                    "urgency": None,
                    "suggestion": f.suggestion,
                    "rule_version": checks.RULE_VERSION,
                    "prompt_version": None,
                    "model_id": None,
                }
                row = self._repo.insert(values, MAX_PROPOSALS)
                if row is None:
                    unchanged += 1
                else:
                    created.append(to_out(row))
            self._repo.commit()
        except ProposalCapReached:
            self._repo.rollback()
            raise InvalidInput(
                "Request failed validation.",
                [FieldIssue("body", f"at most {MAX_PROPOSALS} proposals are allowed")],
            ) from None
        except Exception:
            self._repo.rollback()
            raise
        return AdvisoryRunOut(
            created=created,
            unchanged=unchanged,
            skipped=[
                AdvisorySkipped(condition=s.condition, reason=s.reason) for s in outcome.skipped
            ],
            model=self._run_model_block(today),
        )

    def get(self, proposal_id: uuid.UUID) -> AdvisoryProposalOut:
        row = self._repo.get(proposal_id)
        if row is None:
            raise NotFound("Proposal not found.")
        return to_out(row)

    def list(self, status: str, limit: int) -> AdvisoryProposalList:
        rows = self._repo.list_page(status, limit)
        return AdvisoryProposalList(items=[to_out(r) for r in rows])

    def decide(self, proposal_id: uuid.UUID, decision: AdvisoryDecision) -> AdvisoryProposalOut:
        row = self._repo.lock(proposal_id)
        if row is None:
            self._repo.release()
            raise NotFound("Proposal not found.")
        if row.status != "proposed":
            same = row.status == decision.status
            out = to_out(row)
            self._repo.release()
            if same:
                return out
            raise Conflict("This proposal has already been decided differently.")
        return to_out(self._repo.decide(row, decision.status))

    def model_calls(self, limit: int) -> AdvisoryModelCallList:
        rows: list[AdvisoryModelCall] = self._repo.list_calls(limit)
        return AdvisoryModelCallList(items=[AdvisoryModelCallOut.model_validate(r) for r in rows])
