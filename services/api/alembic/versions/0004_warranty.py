"""warranty coverage and claim

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "warranty_coverage",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("provider_type", sa.String(length=20), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("km_limit", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("source_kind", sa.String(length=20), nullable=False),
        sa.Column("verification_status", sa.String(length=20), nullable=False),
        sa.Column("source_note", sa.String(length=200), nullable=True),
        sa.Column("template_ref", sa.String(length=100), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "char_length(name) BETWEEN 1 AND 200", name=op.f("ck_warranty_coverage_name_length")
        ),
        sa.CheckConstraint(
            "provider_type IN ('factory', 'extended')",
            name=op.f("ck_warranty_coverage_provider_type_valid"),
        ),
        sa.CheckConstraint(
            "source_kind IN ('owner_entered', 'template')",
            name=op.f("ck_warranty_coverage_source_kind_valid"),
        ),
        sa.CheckConstraint(
            "verification_status IN ('confirmed', 'proposed', 'unverified')",
            name=op.f("ck_warranty_coverage_verification_status_valid"),
        ),
        sa.CheckConstraint(
            "end_date IS NOT NULL OR km_limit IS NOT NULL",
            name=op.f("ck_warranty_coverage_has_end_or_km"),
        ),
        sa.CheckConstraint(
            "end_date IS NULL OR end_date >= start_date",
            name=op.f("ck_warranty_coverage_end_not_before_start"),
        ),
        sa.CheckConstraint(
            "km_limit IS NULL OR km_limit BETWEEN 1 AND 10000000",
            name=op.f("ck_warranty_coverage_km_limit_range"),
        ),
        sa.CheckConstraint(
            "start_date BETWEEN DATE '2000-01-01' AND DATE '2200-12-31'",
            name=op.f("ck_warranty_coverage_start_date_range"),
        ),
        sa.CheckConstraint(
            "end_date IS NULL OR end_date BETWEEN DATE '2000-01-01' AND DATE '2200-12-31'",
            name=op.f("ck_warranty_coverage_end_date_range"),
        ),
        sa.CheckConstraint(
            "template_ref IS NULL OR char_length(template_ref) <= 100",
            name=op.f("ck_warranty_coverage_template_ref_length"),
        ),
        sa.CheckConstraint(
            "template_ref IS NULL OR source_kind = 'template'",
            name=op.f("ck_warranty_coverage_template_ref_requires_template"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_warranty_coverage")),
    )
    op.create_table(
        "warranty_claim",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("coverage_id", sa.Uuid(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("odometer", sa.Integer(), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("cost_covered_minor", sa.BigInteger(), nullable=True),
        sa.Column("currency", sa.String(length=3), server_default="MYR", nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "char_length(description) BETWEEN 1 AND 500",
            name=op.f("ck_warranty_claim_description_length"),
        ),
        sa.CheckConstraint(
            "status IN ('submitted', 'approved', 'rejected', 'completed')",
            name=op.f("ck_warranty_claim_status_valid"),
        ),
        sa.CheckConstraint(
            "odometer BETWEEN 0 AND 10000000", name=op.f("ck_warranty_claim_odometer_range")
        ),
        sa.CheckConstraint(
            "cost_covered_minor IS NULL OR cost_covered_minor BETWEEN 0 AND 1000000000000",
            name=op.f("ck_warranty_claim_cost_covered_range"),
        ),
        sa.CheckConstraint("currency = 'MYR'", name=op.f("ck_warranty_claim_currency_myr")),
        sa.CheckConstraint("date >= DATE '2000-01-01'", name=op.f("ck_warranty_claim_date_min")),
        sa.ForeignKeyConstraint(
            ["coverage_id"],
            ["warranty_coverage.id"],
            name=op.f("fk_warranty_claim_coverage_id_warranty_coverage"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_warranty_claim")),
    )
    op.create_index(
        "ix_warranty_claim_history",
        "warranty_claim",
        ["coverage_id", sa.text("date DESC"), sa.text("created_at DESC"), sa.text("id DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_warranty_claim_history", table_name="warranty_claim")
    op.drop_table("warranty_claim")
    op.drop_table("warranty_coverage")
