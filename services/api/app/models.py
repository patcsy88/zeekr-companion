"""SQLAlchemy models. Every change here needs an Alembic migration."""

from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    Numeric,
    SmallInteger,
    String,
    Text,
    Uuid,
    desc,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class OwnerAccount(Base):
    """The single owner login (ADR-006). `singleton` + a unique constraint allows one row."""

    __tablename__ = "owner_account"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    singleton: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true"), unique=True
    )
    username: Mapped[str] = mapped_column(String(64), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(300), nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint("singleton", name="singleton_true"),
        CheckConstraint(
            "char_length(username) BETWEEN 3 AND 64 AND username = lower(username)",
            name="username_valid",
        ),
    )


class OwnerMfa(Base):
    """Second factor for the owner login (ADR-013). One row at most; no row means MFA is off.

    `secret` is the base32 TOTP secret, stored as-is (owner decision): the server must read it back.
    `last_step` is the newest time step already accepted, so a code cannot be used twice.
    `recovery_hashes` holds scrypt hashes of the unused recovery codes; using one removes it.
    """

    __tablename__ = "owner_mfa"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    secret: Mapped[str] = mapped_column(String(64), nullable=False)
    last_step: Mapped[int] = mapped_column(BigInteger, nullable=False)
    recovery_hashes: Mapped[list[str]] = mapped_column(ARRAY(String(300)), nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        CheckConstraint("id = 1", name="single_row"),
        CheckConstraint("char_length(secret) BETWEEN 16 AND 64", name="secret_valid"),
        CheckConstraint("last_step >= 0", name="step_valid"),
    )


class Vehicle(Base):
    """The single vehicle profile. `singleton` + a unique constraint allows at most one row."""

    __tablename__ = "vehicle"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    singleton: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true"), unique=True
    )
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    variant: Mapped[str] = mapped_column(String(100), nullable=False, server_default="")
    drive: Mapped[str] = mapped_column(String(20), nullable=False)
    steering: Mapped[str] = mapped_column(String(20), nullable=False)
    registration: Mapped[str | None] = mapped_column(String(20))
    vin: Mapped[str | None] = mapped_column(String(17))
    purchase_date: Mapped[dt.date | None] = mapped_column(Date)
    purchase_price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    tyre_spec: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint("singleton", name="singleton_true"),
        CheckConstraint("purchase_price_minor >= 0", name="price_non_negative"),
        CheckConstraint("vin IS NULL OR char_length(vin) = 17", name="vin_length"),
    )


class ServiceRecord(Base):
    __tablename__ = "service_record"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    date: Mapped[dt.date] = mapped_column(Date, nullable=False)
    odometer: Mapped[int] = mapped_column(Integer, nullable=False)
    provider: Mapped[str | None] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    cost_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    reminder_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("reminder.id", ondelete="SET NULL")
    )
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint("odometer >= 0", name="odometer_non_negative"),
        CheckConstraint("cost_minor >= 0", name="cost_non_negative"),
        CheckConstraint("char_length(description) BETWEEN 1 AND 500", name="description_length"),
        Index("ix_service_record_history", desc("date"), desc("created_at"), desc("id")),
    )


class Reminder(Base):
    __tablename__ = "reminder"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    due_date: Mapped[dt.date | None] = mapped_column(Date)
    due_odometer: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)
    completed_on: Mapped[dt.date | None] = mapped_column(Date)
    template_ref: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "kind IN ('service', 'insurance_renewal', 'road_tax_renewal')", name="kind_valid"
        ),
        CheckConstraint("char_length(title) BETWEEN 1 AND 200", name="title_length"),
        CheckConstraint("due_date IS NOT NULL OR due_odometer IS NOT NULL", name="has_due_field"),
        CheckConstraint(
            "due_odometer IS NULL OR due_odometer BETWEEN 0 AND 10000000",
            name="due_odometer_range",
        ),
        CheckConstraint(
            "due_odometer IS NULL OR kind = 'service'", name="due_odometer_service_only"
        ),
        CheckConstraint(
            "due_date IS NULL OR due_date BETWEEN DATE '2000-01-01' AND DATE '2200-12-31'",
            name="due_date_range",
        ),
        CheckConstraint(
            "template_ref IS NULL OR char_length(template_ref) <= 100", name="template_ref_length"
        ),
    )


EXPENSE_CATEGORIES = (
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
)


class Expense(Base):
    __tablename__ = "expense"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    date: Mapped[dt.date] = mapped_column(Date, nullable=False)
    category: Mapped[str] = mapped_column(String(30), nullable=False)
    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="MYR")
    notes: Mapped[str | None] = mapped_column(Text)
    energy_wh: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "category IN (" + ", ".join(f"'{c}'" for c in EXPENSE_CATEGORIES) + ")",
            name="category_valid",
        ),
        CheckConstraint(
            "energy_wh IS NULL OR (category = 'charging' AND energy_wh BETWEEN 1 AND 1000000)",
            name="energy_valid",
        ),
        CheckConstraint("amount_minor BETWEEN 1 AND 1000000000000", name="amount_range"),
        CheckConstraint("currency = 'MYR'", name="currency_myr"),
        CheckConstraint("date >= DATE '2000-01-01'", name="date_min"),
        Index("ix_expense_history", desc("date"), desc("created_at"), desc("id")),
    )


TYRE_KINDS = ("replace", "rotate", "repair", "alignment", "balancing")
TYRE_WHEELS = ("driver_front", "passenger_front", "driver_rear", "passenger_rear")


class TyreEvent(Base):
    """One tyre change, rotation, repair, alignment or balancing (FR-9, approved 2026-11-08)."""

    __tablename__ = "tyre_event"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    date: Mapped[dt.date] = mapped_column(Date, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    wheels: Mapped[list[str]] = mapped_column(ARRAY(String(20)), nullable=False)
    odometer: Mapped[int] = mapped_column(Integer, nullable=False)
    brand: Mapped[str | None] = mapped_column(String(100))
    model: Mapped[str | None] = mapped_column(String(100))
    size: Mapped[str | None] = mapped_column(String(50))
    cost_minor: Mapped[int | None] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="MYR")
    shop: Mapped[str | None] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "kind IN (" + ", ".join(f"'{k}'" for k in TYRE_KINDS) + ")", name="kind_valid"
        ),
        CheckConstraint(
            "cardinality(wheels) BETWEEN 1 AND 4 AND wheels <@ ARRAY["
            + ", ".join(f"'{w}'" for w in TYRE_WHEELS)
            + "]::varchar(20)[]",
            name="wheels_valid",
        ),
        CheckConstraint("odometer BETWEEN 0 AND 10000000", name="odometer_range"),
        CheckConstraint(
            "cost_minor IS NULL OR cost_minor BETWEEN 0 AND 1000000000000", name="cost_range"
        ),
        CheckConstraint("currency = 'MYR'", name="currency_myr"),
        CheckConstraint("date >= DATE '2000-01-01'", name="date_min"),
        CheckConstraint(
            "kind = 'replace' OR (brand IS NULL AND model IS NULL AND size IS NULL)",
            name="tyre_only_on_replace",
        ),
        Index("ix_tyre_event_history", desc("date"), desc("created_at"), desc("id")),
    )


class AdvisoryProposal(Base):
    """A stored finding of an advisory check (ADR-008). Derived numbers and model text only."""

    __tablename__ = "advisory_proposal"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    condition: Mapped[str] = mapped_column(String(40), nullable=False)
    dedupe_key: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    inputs: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    source_refs: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    explanation: Mapped[str | None] = mapped_column(Text)
    explanation_status: Mapped[str] = mapped_column(String(20), nullable=False)
    urgency: Mapped[str | None] = mapped_column(String(10))
    suggestion: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    rule_version: Mapped[int] = mapped_column(Integer, nullable=False)
    prompt_version: Mapped[int | None] = mapped_column(Integer)
    model_id: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    decided_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(
            "condition IN ('date_vs_km_warranty','date_vs_km_service','charging_cost_drift',"
            "'sentry_off_outside_geofence')",
            name="condition_valid",
        ),
        CheckConstraint(
            "status IN ('proposed','accepted','dismissed','closed')", name="status_valid"
        ),
        CheckConstraint(
            "explanation_status IN ('model','unavailable','disabled','limit_reached',"
            "'invalid_output')",
            name="explanation_status_valid",
        ),
        CheckConstraint(
            "urgency IS NULL OR urgency IN ('low','normal','high')", name="urgency_valid"
        ),
        CheckConstraint(
            "explanation IS NULL OR char_length(explanation) <= 500", name="explanation_length"
        ),
        CheckConstraint(
            "(status = 'proposed') = (decided_at IS NULL)", name="decided_matches_status"
        ),
        Index("ix_advisory_proposal_history", desc("created_at"), desc("id")),
    )


class AdvisoryModelCall(Base):
    """Audit of what was sent to the hosted model and what came back (owner decision)."""

    __tablename__ = "advisory_model_call"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    proposal_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("advisory_proposal.id", ondelete="SET NULL")
    )
    called_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    model_id: Mapped[str] = mapped_column(String(100), nullable=False)
    request_text: Mapped[str] = mapped_column(Text, nullable=False)
    response_text: Mapped[str | None] = mapped_column(Text)
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    outcome: Mapped[str] = mapped_column(String(20), nullable=False)

    __table_args__ = (
        CheckConstraint("outcome IN ('ok','error','invalid_output')", name="outcome_valid"),
        Index("ix_advisory_model_call_called_at", "called_at"),
    )


class WarrantyCoverage(Base):
    __tablename__ = "warranty_coverage"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    provider_type: Mapped[str] = mapped_column(String(20), nullable=False)
    start_date: Mapped[dt.date] = mapped_column(Date, nullable=False)
    end_date: Mapped[dt.date | None] = mapped_column(Date)
    km_limit: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)
    source_kind: Mapped[str] = mapped_column(String(20), nullable=False)
    verification_status: Mapped[str] = mapped_column(String(20), nullable=False)
    source_note: Mapped[str | None] = mapped_column(String(200))
    template_ref: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint("char_length(name) BETWEEN 1 AND 200", name="name_length"),
        CheckConstraint("provider_type IN ('factory', 'extended')", name="provider_type_valid"),
        CheckConstraint("source_kind IN ('owner_entered', 'template')", name="source_kind_valid"),
        CheckConstraint(
            "verification_status IN ('confirmed', 'proposed', 'unverified')",
            name="verification_status_valid",
        ),
        CheckConstraint("end_date IS NOT NULL OR km_limit IS NOT NULL", name="has_end_or_km"),
        CheckConstraint("end_date IS NULL OR end_date >= start_date", name="end_not_before_start"),
        CheckConstraint(
            "km_limit IS NULL OR km_limit BETWEEN 1 AND 10000000", name="km_limit_range"
        ),
        CheckConstraint(
            "start_date BETWEEN DATE '2000-01-01' AND DATE '2200-12-31'", name="start_date_range"
        ),
        CheckConstraint(
            "end_date IS NULL OR end_date BETWEEN DATE '2000-01-01' AND DATE '2200-12-31'",
            name="end_date_range",
        ),
        CheckConstraint(
            "template_ref IS NULL OR char_length(template_ref) <= 100", name="template_ref_length"
        ),
        CheckConstraint(
            "template_ref IS NULL OR source_kind = 'template'",
            name="template_ref_requires_template",
        ),
    )


class WarrantyClaim(Base):
    __tablename__ = "warranty_claim"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    coverage_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("warranty_coverage.id", ondelete="CASCADE"), nullable=False
    )
    date: Mapped[dt.date] = mapped_column(Date, nullable=False)
    odometer: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    cost_covered_minor: Mapped[int | None] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="MYR")
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint("char_length(description) BETWEEN 1 AND 500", name="description_length"),
        CheckConstraint(
            "status IN ('submitted', 'approved', 'rejected', 'completed')", name="status_valid"
        ),
        CheckConstraint("odometer BETWEEN 0 AND 10000000", name="odometer_range"),
        CheckConstraint(
            "cost_covered_minor IS NULL OR cost_covered_minor BETWEEN 0 AND 1000000000000",
            name="cost_covered_range",
        ),
        CheckConstraint("currency = 'MYR'", name="currency_myr"),
        CheckConstraint("date >= DATE '2000-01-01'", name="date_min"),
        Index(
            "ix_warranty_claim_history",
            "coverage_id",
            desc("date"),
            desc("created_at"),
            desc("id"),
        ),
    )


class LiveReading(Base):
    """One stored reading from the car (ADR-009). No position, locks, doors, VIN, plate, nickname,
    free text or raw reply. `observed_at` is the car's own update time and is unique, so a repeat
    of the same reading is stored once."""

    __tablename__ = "live_reading"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    observed_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, unique=True
    )
    received_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    odometer_km: Mapped[int | None] = mapped_column(Integer)
    battery_percent: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    range_km: Mapped[int | None] = mapped_column(Integer)
    service_days: Mapped[int | None] = mapped_column(Integer)
    service_distance_km: Mapped[int | None] = mapped_column(Integer)
    tyre_driver_front_kpa: Mapped[int | None] = mapped_column(Integer)
    tyre_passenger_front_kpa: Mapped[int | None] = mapped_column(Integer)
    tyre_driver_rear_kpa: Mapped[int | None] = mapped_column(Integer)
    tyre_passenger_rear_kpa: Mapped[int | None] = mapped_column(Integer)
    is_charging: Mapped[bool | None] = mapped_column(Boolean)
    is_plugged_in: Mapped[bool | None] = mapped_column(Boolean)
    battery_12v_volts: Mapped[Decimal | None] = mapped_column(Numeric(4, 1))
    tyre_temp_driver_front_c: Mapped[int | None] = mapped_column(Integer)
    tyre_temp_passenger_front_c: Mapped[int | None] = mapped_column(Integer)
    tyre_temp_driver_rear_c: Mapped[int | None] = mapped_column(Integer)
    tyre_temp_passenger_rear_c: Mapped[int | None] = mapped_column(Integer)
    pre_climate_active: Mapped[bool | None] = mapped_column(Boolean)
    fragrance_active: Mapped[bool | None] = mapped_column(Boolean)
    overheat_protection_active: Mapped[bool | None] = mapped_column(Boolean)
    vtm_ts_active: Mapped[bool | None] = mapped_column(Boolean)
    engine_enable_running: Mapped[bool | None] = mapped_column(Boolean)
    sentry_active: Mapped[bool | None] = mapped_column(Boolean)

    __table_args__ = (
        CheckConstraint(
            "battery_12v_volts IS NULL OR battery_12v_volts BETWEEN 6 AND 20",
            name="battery_12v_range",
        ),
        CheckConstraint(
            "(tyre_temp_driver_front_c IS NULL OR tyre_temp_driver_front_c BETWEEN -40 AND 150)"
            " AND (tyre_temp_passenger_front_c IS NULL"
            " OR tyre_temp_passenger_front_c BETWEEN -40 AND 150)"
            " AND (tyre_temp_driver_rear_c IS NULL OR tyre_temp_driver_rear_c BETWEEN -40 AND 150)"
            " AND (tyre_temp_passenger_rear_c IS NULL"
            " OR tyre_temp_passenger_rear_c BETWEEN -40 AND 150)",
            name="tyre_temp_range",
        ),
        CheckConstraint(
            "odometer_km IS NULL OR odometer_km BETWEEN 0 AND 10000000", name="odometer_range"
        ),
        CheckConstraint(
            "battery_percent IS NULL OR battery_percent BETWEEN 0 AND 100", name="battery_range"
        ),
        CheckConstraint("range_km IS NULL OR range_km BETWEEN 0 AND 5000", name="range_range"),
        CheckConstraint(
            "service_days IS NULL OR service_days BETWEEN -100000 AND 100000",
            name="service_days_range",
        ),
        CheckConstraint(
            "service_distance_km IS NULL OR service_distance_km BETWEEN -100000 AND 100000",
            name="service_distance_range",
        ),
        CheckConstraint(
            "(tyre_driver_front_kpa IS NULL OR tyre_driver_front_kpa BETWEEN 0 AND 500)"
            " AND (tyre_passenger_front_kpa IS NULL OR tyre_passenger_front_kpa BETWEEN 0 AND 500)"
            " AND (tyre_driver_rear_kpa IS NULL OR tyre_driver_rear_kpa BETWEEN 0 AND 500)"
            " AND (tyre_passenger_rear_kpa IS NULL OR tyre_passenger_rear_kpa BETWEEN 0 AND 500)",
            name="tyre_range",
        ),
    )


class CarCommandLog(Base):
    """One command sent to the car from the app (ADR-010). No payload, reply body, VIN or
    position: only what was asked, the outcome, and the state the car reported afterwards."""

    __tablename__ = "car_command_log"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    desired: Mapped[str] = mapped_column(String(3), nullable=False)
    source: Mapped[str] = mapped_column(String(10), nullable=False)
    result: Mapped[str] = mapped_column(String(10), nullable=False)
    state_after: Mapped[str | None] = mapped_column(String(3))
    # Set only on a 'skipped' row (ADR-011): an automatic send that was not made. Nothing was sent.
    skip_reason: Mapped[str | None] = mapped_column(String(12))

    __table_args__ = (
        CheckConstraint("desired IN ('on', 'off')", name="desired_valid"),
        CheckConstraint("source IN ('manual', 'auto')", name="source_valid"),
        CheckConstraint("result IN ('sent', 'refused', 'failed', 'skipped')", name="result_valid"),
        CheckConstraint(
            "state_after IS NULL OR state_after IN ('on', 'off')", name="state_after_valid"
        ),
        CheckConstraint(
            "skip_reason IS NULL OR skip_reason IN ('quiet_period', 'host_off', 'busy')",
            name="skip_reason_valid",
        ),
        CheckConstraint(
            "(result = 'skipped') = (skip_reason IS NOT NULL)", name="skip_reason_matches_result"
        ),
        CheckConstraint("result <> 'skipped' OR source = 'auto'", name="skipped_is_auto"),
        Index("ix_car_command_log_created_at", "created_at"),
    )


class GeofenceSettings(Base):
    """The geofence's editable settings (Piece C). One row at most. No home address, coordinate
    or position: those stay in the host environment."""

    __tablename__ = "geofence_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    radius_km: Mapped[float] = mapped_column(Numeric(6, 2), nullable=False)
    interval_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    stale_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    gear_codes: Mapped[list[int]] = mapped_column(ARRAY(SmallInteger), nullable=False)
    usage_mode_codes: Mapped[list[int]] = mapped_column(ARRAY(SmallInteger), nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        CheckConstraint("id = 1", name="single_row"),
        CheckConstraint("radius_km > 0 AND radius_km <= 100", name="radius_valid"),
        CheckConstraint("interval_minutes BETWEEN 5 AND 1440", name="interval_valid"),
        CheckConstraint("stale_minutes BETWEEN 1 AND 30", name="stale_valid"),
        CheckConstraint("cardinality(gear_codes) BETWEEN 1 AND 5", name="gear_codes_valid"),
        CheckConstraint(
            "cardinality(usage_mode_codes) BETWEEN 1 AND 5", name="usage_mode_codes_valid"
        ),
    )


class AutoSentrySettings(Base):
    """The automatic Sentry on toggle and its quiet period (ADR-011). One row at most. No row
    means off and 60 minutes. Kept apart from geofence_settings on purpose."""

    __tablename__ = "auto_sentry_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)
    quiet_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        CheckConstraint("id = 1", name="single_row"),
        CheckConstraint("quiet_minutes BETWEEN 5 AND 1440", name="quiet_valid"),
    )
