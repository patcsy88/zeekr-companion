"""advisory proposal and model call

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "advisory_proposal",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("condition", sa.String(length=40), nullable=False),
        sa.Column("dedupe_key", sa.String(length=100), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("inputs", postgresql.JSONB(), nullable=False),
        sa.Column("source_refs", postgresql.JSONB(), nullable=False),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("explanation_status", sa.String(length=20), nullable=False),
        sa.Column("urgency", sa.String(length=10), nullable=True),
        sa.Column("suggestion", postgresql.JSONB(), nullable=True),
        sa.Column("rule_version", sa.Integer(), nullable=False),
        sa.Column("prompt_version", sa.Integer(), nullable=True),
        sa.Column("model_id", sa.String(length=100), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_advisory_proposal")),
        sa.UniqueConstraint("dedupe_key", name=op.f("uq_advisory_proposal_dedupe_key")),
        sa.CheckConstraint(
            "condition IN ('date_vs_km_warranty','date_vs_km_service','charging_cost_drift')",
            name=op.f("ck_advisory_proposal_condition_valid"),
        ),
        sa.CheckConstraint(
            "status IN ('proposed','accepted','dismissed')",
            name=op.f("ck_advisory_proposal_status_valid"),
        ),
        sa.CheckConstraint(
            "explanation_status IN ('model','unavailable','disabled','limit_reached',"
            "'invalid_output')",
            name=op.f("ck_advisory_proposal_explanation_status_valid"),
        ),
        sa.CheckConstraint(
            "urgency IS NULL OR urgency IN ('low','normal','high')",
            name=op.f("ck_advisory_proposal_urgency_valid"),
        ),
        sa.CheckConstraint(
            "explanation IS NULL OR char_length(explanation) <= 500",
            name=op.f("ck_advisory_proposal_explanation_length"),
        ),
        sa.CheckConstraint(
            "(status = 'proposed') = (decided_at IS NULL)",
            name=op.f("ck_advisory_proposal_decided_matches_status"),
        ),
    )
    op.create_index(
        "ix_advisory_proposal_history",
        "advisory_proposal",
        [sa.text("created_at DESC"), sa.text("id DESC")],
    )
    op.create_table(
        "advisory_model_call",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("proposal_id", sa.Uuid(), nullable=True),
        sa.Column("called_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("model_id", sa.String(length=100), nullable=False),
        sa.Column("request_text", sa.Text(), nullable=False),
        sa.Column("response_text", sa.Text(), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("outcome", sa.String(length=20), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_advisory_model_call")),
        sa.ForeignKeyConstraint(
            ["proposal_id"],
            ["advisory_proposal.id"],
            name=op.f("fk_advisory_model_call_proposal_id_advisory_proposal"),
            ondelete="SET NULL",
        ),
        sa.CheckConstraint(
            "outcome IN ('ok','error','invalid_output')",
            name=op.f("ck_advisory_model_call_outcome_valid"),
        ),
    )
    op.create_index("ix_advisory_model_call_called_at", "advisory_model_call", ["called_at"])


def downgrade() -> None:
    op.drop_index("ix_advisory_model_call_called_at", table_name="advisory_model_call")
    op.drop_table("advisory_model_call")
    op.drop_index("ix_advisory_proposal_history", table_name="advisory_proposal")
    op.drop_table("advisory_proposal")
