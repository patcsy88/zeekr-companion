"""SQLAlchemy models. Every change here needs an Alembic migration."""

from __future__ import annotations

import datetime as dt
import uuid

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
    String,
    Text,
    Uuid,
    desc,
    func,
    text,
)
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
