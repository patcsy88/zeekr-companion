"""Typed request and response models (contract: docs/architecture/api-contracts.md)."""

from __future__ import annotations

import datetime as dt
import re
import uuid
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    field_validator,
)

from app.clock import today_kl
from app.security import normalise_username

# Sanity bounds so out-of-range numbers are a 400 rather than a database error.
MAX_MONEY_MINOR = 10**12
MAX_ODOMETER_KM = 10_000_000

Money = Annotated[int, Field(strict=True, ge=0, le=MAX_MONEY_MINOR)]
Distance = Annotated[int, Field(strict=True, ge=0, le=MAX_ODOMETER_KM)]
# ISO 4217. Only MYR is accepted for now (contract amendment 2026-10-11).
Currency = Literal["MYR"]


def _to_utc(value: dt.datetime) -> dt.datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.UTC)
    return value.astimezone(dt.UTC)


UtcDateTime = Annotated[dt.datetime, AfterValidator(_to_utc)]


def _not_in_future(value: dt.date | None) -> dt.date | None:
    if value is not None and value > today_kl():
        raise ValueError("must not be in the future")
    return value


class _Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @field_validator("*", mode="after")
    @classmethod
    def _no_nul(cls, value: Any) -> Any:
        """PostgreSQL text cannot hold NUL; reject it as a 400 instead of a driver error."""
        if isinstance(value, str) and "\x00" in value:
            raise ValueError("must not contain NUL characters")
        return value


class _Output(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Errors (contract: "Error shape") --------------------------------------------------------


class ErrorDetail(BaseModel):
    field: str
    issue: str


class ErrorBody(BaseModel):
    code: Literal[
        "validation_error",
        "unauthenticated",
        "not_found",
        "method_not_allowed",
        "conflict",
        "rate_limited",
        "internal_error",
    ]
    message: str
    details: list[ErrorDetail]


class ErrorResponse(BaseModel):
    """Every error response under /api has this shape."""

    error: ErrorBody


# --- Authentication -------------------------------------------------------------------------


class TokenRequest(BaseModel):
    # Whitespace is significant in passwords, so no stripping here.
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=1024, repr=False)

    @field_validator("username")
    @classmethod
    def _username(cls, value: str) -> str:
        return normalise_username(value)


class TokenResponse(BaseModel):
    access_token: str
    expires_in: int


# --- Vehicle --------------------------------------------------------------------------------


class VehicleIn(_Input):
    id: uuid.UUID | None = None
    model: str = Field(min_length=1, max_length=100)
    variant: str = Field(default="", max_length=100)
    drive: str = Field(default="AWD", min_length=1, max_length=20)
    steering: str = Field(default="RHD", min_length=1, max_length=20)
    registration: str | None = Field(default=None, max_length=20)
    vin: str | None = Field(default=None, min_length=17, max_length=17)
    purchase_date: dt.date | None = None
    purchase_price_minor: Money = 0
    currency: Currency = "MYR"
    tyre_spec: str | None = Field(default=None, max_length=200)


class VehicleOut(_Output):
    id: uuid.UUID
    model: str
    variant: str
    drive: str
    steering: str
    registration: str | None
    vin: str | None
    purchase_date: dt.date | None
    purchase_price_minor: int
    currency: str
    tyre_spec: str | None


# --- Service records ------------------------------------------------------------------------


class ServiceRecordCreate(_Input):
    id: uuid.UUID
    date: dt.date
    odometer: Distance
    provider: str | None = Field(default=None, max_length=200)
    description: str = Field(min_length=1, max_length=500)
    cost_minor: Money
    currency: Currency = "MYR"
    notes: str | None = Field(default=None, max_length=5000)

    _check_date = field_validator("date")(_not_in_future)


class ServiceRecordPatch(_Input):
    """Partial update. Omitted fields are unchanged; `provider` and `notes` may be set to null."""

    date: dt.date | None = None
    odometer: Distance | None = None
    provider: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, min_length=1, max_length=500)
    cost_minor: Money | None = None
    currency: Currency | None = None
    notes: str | None = Field(default=None, max_length=5000)

    _check_date = field_validator("date")(_not_in_future)

    @field_validator("date", "odometer", "description", "cost_minor", "currency", mode="before")
    @classmethod
    def _not_null(cls, value: Any) -> Any:
        if value is None:
            raise ValueError("must not be null")
        return value


class ServiceRecordOut(_Output):
    id: uuid.UUID
    date: dt.date
    odometer: int
    provider: str | None
    description: str
    cost_minor: int
    currency: str
    notes: str | None
    created_at: UtcDateTime
    updated_at: UtcDateTime


class ServiceRecordPage(BaseModel):
    items: list[ServiceRecordOut]
    next_cursor: str | None


# --- Reminders ------------------------------------------------------------------------------

ReminderKind = Literal["service", "insurance_renewal", "road_tax_renewal"]
MIN_DUE_DATE = dt.date(2000, 1, 1)
MAX_DUE_DATE = dt.date(2200, 12, 31)
MAX_REMINDERS = 500
_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")


def _due_date_in_range(value: dt.date | None) -> dt.date | None:
    if value is not None and not (MIN_DUE_DATE <= value <= MAX_DUE_DATE):
        raise ValueError("must be between 2000-01-01 and 2200-12-31")
    return value


def _date_string_only(value: Any) -> Any:
    """A JSON number is not a date (pydantic would read an int as a Unix timestamp)."""
    if isinstance(value, bool | int | float):
        raise ValueError("must be a date in YYYY-MM-DD format")
    if isinstance(value, str) and not _DATE_RE.fullmatch(value):
        raise ValueError("must be a date in YYYY-MM-DD format")
    return value


StrictDate = Annotated[dt.date, BeforeValidator(_date_string_only)]


def _digits_only(value: Any) -> Any:
    """A page size is plain digits: no '1.0', no padding, no sign."""
    if isinstance(value, str) and not re.fullmatch(r"[0-9]{1,6}", value):
        raise ValueError("must be a whole number")
    return value


def _page_limit_range(value: int) -> int:
    if not 1 <= value <= 100:
        raise ValueError("must be between 1 and 100")
    return value


PageLimit = Annotated[int, BeforeValidator(_digits_only), AfterValidator(_page_limit_range)]


class ReminderCreate(_Input):
    id: uuid.UUID
    kind: ReminderKind
    title: str = Field(min_length=1, max_length=200)
    due_date: StrictDate | None = None
    due_odometer: Distance | None = None
    notes: str | None = Field(default=None, max_length=5000)
    template_ref: str | None = Field(default=None, max_length=100)

    _check_due_date = field_validator("due_date")(_due_date_in_range)


class ReminderPatch(_Input):
    """Partial update. `kind` and `title` may not be null; the others may be set to null.

    `status`, `overdue_by` and `template_ref` are not accepted (extra=forbid).
    """

    kind: ReminderKind | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    due_date: StrictDate | None = None
    due_odometer: Distance | None = None
    notes: str | None = Field(default=None, max_length=5000)
    completed_on: StrictDate | None = None

    _check_due_date = field_validator("due_date")(_due_date_in_range)
    _check_completed_on = field_validator("completed_on")(_not_in_future)

    @field_validator("kind", "title", mode="before")
    @classmethod
    def _not_null(cls, value: Any) -> Any:
        if value is None:
            raise ValueError("must not be null")
        return value


class ReminderOut(BaseModel):
    id: uuid.UUID
    kind: ReminderKind
    title: str
    due_date: dt.date | None
    due_odometer: int | None
    notes: str | None
    completed_on: dt.date | None
    template_ref: str | None
    status: Literal["upcoming", "overdue", "completed"]
    overdue_by: list[Literal["date", "odometer"]]
    created_at: UtcDateTime
    updated_at: UtcDateTime


class CurrentOdometer(BaseModel):
    km: int
    source: Literal["latest_service_record"]
    service_record_id: uuid.UUID
    date: dt.date


class ReminderList(BaseModel):
    items: list[ReminderOut]
    current_odometer: CurrentOdometer | None


class TemplateSource(BaseModel):
    title: str
    url: str
    research_ref: str
    status: Literal["verified"]
    retrieved: dt.date


class TemplateInterval(BaseModel):
    km: int
    months: int
    rule: str


class TemplateCheckpoint(BaseModel):
    number: int
    km: int
    months: int
    work_items: list[str]
    work_items_stated: bool


class ReminderTemplate(BaseModel):
    id: str
    version: int
    name: str
    kind: ReminderKind
    source: TemplateSource
    caveat: str
    interval: TemplateInterval
    baseline_required: bool
    checkpoints: list[TemplateCheckpoint]


class ReminderTemplateList(BaseModel):
    items: list[ReminderTemplate]


# --- Expenses -------------------------------------------------------------------------------

ExpenseCategory = Literal[
    "charging",
    "insurance",
    "road_tax",
    "parking",
    "tolls",
    "tyres",
    "accessories",
    "cleaning",
    "fines",
    "warranty",
    "other",
]
MIN_EXPENSE_DATE = dt.date(2000, 1, 1)
MAX_EXPENSES = 5000
ExpenseAmount = Annotated[int, Field(strict=True, ge=1, le=MAX_MONEY_MINOR)]
MAX_ENERGY_WH = 1_000_000
EnergyWh = Annotated[int, Field(strict=True, ge=1, le=MAX_ENERGY_WH)]


def _expense_date(value: dt.date | None) -> dt.date | None:
    if value is not None and value < MIN_EXPENSE_DATE:
        raise ValueError("must be on or after 2000-01-01")
    return _not_in_future(value)


def _blank_to_none(value: str | None) -> str | None:
    """Notes that are empty after trimming mean 'no notes': one state, stored as null."""
    return None if value is not None and value == "" else value


class ExpenseCreate(_Input):
    id: uuid.UUID
    date: StrictDate
    category: ExpenseCategory
    amount_minor: ExpenseAmount
    currency: Currency = "MYR"
    notes: str | None = Field(default=None, max_length=5000)
    energy_wh: EnergyWh | None = None

    _check_date = field_validator("date")(_expense_date)
    _blank_notes = field_validator("notes")(_blank_to_none)


class ExpensePatch(_Input):
    """Partial update. Omitted fields are unchanged; only `notes` may be set to null."""

    date: StrictDate | None = None
    category: ExpenseCategory | None = None
    amount_minor: ExpenseAmount | None = None
    currency: Currency | None = None
    notes: str | None = Field(default=None, max_length=5000)
    energy_wh: EnergyWh | None = None

    _check_date = field_validator("date")(_expense_date)
    _blank_notes = field_validator("notes")(_blank_to_none)

    @field_validator("date", "category", "amount_minor", "currency", mode="before")
    @classmethod
    def _not_null(cls, value: Any) -> Any:
        if value is None:
            raise ValueError("must not be null")
        return value


class ExpenseOut(_Output):
    id: uuid.UUID
    date: dt.date
    category: ExpenseCategory
    amount_minor: int
    currency: str
    notes: str | None
    energy_wh: int | None
    created_at: UtcDateTime
    updated_at: UtcDateTime


class ExpensePage(BaseModel):
    items: list[ExpenseOut]
    next_cursor: str | None


class ExpenseCategoryTotal(BaseModel):
    category: ExpenseCategory
    total_minor: int
    count: int


class ExpenseMonthTotal(BaseModel):
    month: str
    total_minor: int
    count: int


class ExpenseSummary(BaseModel):
    currency: Literal["MYR"]
    total_minor: int
    count: int
    by_category: list[ExpenseCategoryTotal]
    by_month: list[ExpenseMonthTotal]


# --- Warranty -------------------------------------------------------------------------------

ProviderType = Literal["factory", "extended"]
SourceKind = Literal["owner_entered", "template"]
VerificationStatus = Literal["confirmed", "proposed", "unverified"]
ClaimStatus = Literal["submitted", "approved", "rejected", "completed"]
CoverageStatus = Literal["not_started", "active", "expiring_soon", "expired"]
MAX_WARRANTY_COVERAGES = 50
MAX_WARRANTY_CLAIMS = 500
MAX_KM_LIMIT = 10_000_000
KmLimit = Annotated[int, Field(strict=True, ge=1, le=MAX_KM_LIMIT)]
CostCovered = Annotated[int, Field(strict=True, ge=0, le=MAX_MONEY_MINOR)]


class WarrantyCoverageCreate(_Input):
    id: uuid.UUID
    name: str = Field(min_length=1, max_length=200)
    provider_type: ProviderType
    start_date: StrictDate
    end_date: StrictDate | None = None
    km_limit: KmLimit | None = None
    notes: str | None = Field(default=None, max_length=5000)
    source_kind: SourceKind = "owner_entered"
    verification_status: VerificationStatus = "unverified"
    source_note: str | None = Field(default=None, max_length=200)
    template_ref: str | None = Field(default=None, max_length=100)

    _check_start = field_validator("start_date")(_due_date_in_range)
    _check_end = field_validator("end_date")(_due_date_in_range)
    _blank = field_validator("notes", "source_note", "template_ref")(_blank_to_none)


class WarrantyCoveragePatch(_Input):
    """Partial update. `end_date`, `km_limit`, `notes` and `source_note` may be set to null.

    `source_kind`, `template_ref` and the computed fields are not accepted (extra=forbid).
    """

    name: str | None = Field(default=None, min_length=1, max_length=200)
    provider_type: ProviderType | None = None
    start_date: StrictDate | None = None
    end_date: StrictDate | None = None
    km_limit: KmLimit | None = None
    notes: str | None = Field(default=None, max_length=5000)
    verification_status: VerificationStatus | None = None
    source_note: str | None = Field(default=None, max_length=200)

    _check_start = field_validator("start_date")(_due_date_in_range)
    _check_end = field_validator("end_date")(_due_date_in_range)
    _blank = field_validator("notes", "source_note")(_blank_to_none)

    @field_validator("name", "provider_type", "start_date", "verification_status", mode="before")
    @classmethod
    def _not_null(cls, value: Any) -> Any:
        if value is None:
            raise ValueError("must not be null")
        return value


class WarrantyCoverageOut(BaseModel):
    id: uuid.UUID
    name: str
    provider_type: ProviderType
    start_date: dt.date
    end_date: dt.date | None
    km_limit: int | None
    notes: str | None
    source_kind: SourceKind
    verification_status: VerificationStatus
    source_note: str | None
    template_ref: str | None
    status: CoverageStatus
    expired_by: list[Literal["date", "odometer"]]
    expiring_soon_by: list[Literal["date", "odometer"]]
    claim_count: int
    created_at: UtcDateTime
    updated_at: UtcDateTime


class WarrantyCoverageList(BaseModel):
    items: list[WarrantyCoverageOut]
    current_odometer: CurrentOdometer | None


class WarrantyClaimCreate(_Input):
    id: uuid.UUID
    coverage_id: uuid.UUID
    date: StrictDate
    odometer: Distance
    description: str = Field(min_length=1, max_length=500)
    status: ClaimStatus
    cost_covered_minor: CostCovered | None = None
    currency: Currency = "MYR"
    notes: str | None = Field(default=None, max_length=5000)

    _check_date = field_validator("date")(_expense_date)
    _blank = field_validator("notes")(_blank_to_none)


class WarrantyClaimPatch(_Input):
    """Partial update. Only `cost_covered_minor` and `notes` may be set to null.

    `coverage_id` cannot be changed (extra=forbid).
    """

    date: StrictDate | None = None
    odometer: Distance | None = None
    description: str | None = Field(default=None, min_length=1, max_length=500)
    status: ClaimStatus | None = None
    cost_covered_minor: CostCovered | None = None
    currency: Currency | None = None
    notes: str | None = Field(default=None, max_length=5000)

    _check_date = field_validator("date")(_expense_date)
    _blank = field_validator("notes")(_blank_to_none)

    @field_validator("date", "odometer", "description", "status", "currency", mode="before")
    @classmethod
    def _not_null(cls, value: Any) -> Any:
        if value is None:
            raise ValueError("must not be null")
        return value


class WarrantyClaimOut(_Output):
    id: uuid.UUID
    coverage_id: uuid.UUID
    date: dt.date
    odometer: int
    description: str
    status: ClaimStatus
    cost_covered_minor: int | None
    currency: str
    notes: str | None
    created_at: UtcDateTime
    updated_at: UtcDateTime


class WarrantyClaimList(BaseModel):
    items: list[WarrantyClaimOut]


class WarrantyTemplateSource(BaseModel):
    title: str
    url: str
    research_ref: str
    status: Literal["verified"]
    retrieved: dt.date


class WarrantyTemplateItem(BaseModel):
    key: str
    name: str
    months: int | None
    km: int | None
    research_ref: str
    enter_manually: bool = False


class WarrantyTemplate(BaseModel):
    id: str
    version: int
    name: str
    source: WarrantyTemplateSource
    caveat: str
    baseline_required: bool
    items: list[WarrantyTemplateItem]


class WarrantyTemplateList(BaseModel):
    items: list[WarrantyTemplate]
