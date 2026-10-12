"""Typed request and response models (contract: docs/architecture/api-contracts.md)."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated, Any, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)

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
    if value is not None and value > dt.datetime.now(dt.UTC).date():
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

    password: str = Field(min_length=1, max_length=1024, repr=False)


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
