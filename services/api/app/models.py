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
        CheckConstraint("amount_minor BETWEEN 1 AND 1000000000000", name="amount_range"),
        CheckConstraint("currency = 'MYR'", name="currency_myr"),
        CheckConstraint("date >= DATE '2000-01-01'", name="date_min"),
        Index("ix_expense_history", desc("date"), desc("created_at"), desc("id")),
    )
