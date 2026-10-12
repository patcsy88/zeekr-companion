"""AC-2: migrations apply to an empty database and can be re-run."""

from __future__ import annotations

from sqlalchemy import create_engine, inspect, text

from tests.conftest import run_migrations


def test_ac2_migrations_apply_and_rerun_cleanly(fresh_database_url: str) -> None:
    run_migrations(fresh_database_url)
    run_migrations(fresh_database_url)  # second run must be a no-op, not an error

    engine = create_engine(fresh_database_url)
    try:
        inspector = inspect(engine)
        assert {"vehicle", "service_record", "alembic_version"} <= set(inspector.get_table_names())
        columns = {c["name"] for c in inspector.get_columns("service_record")}
        assert {"id", "date", "odometer", "cost_minor", "currency", "created_at"} <= columns
        with engine.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM alembic_version")).scalar_one() == 1
    finally:
        engine.dispose()


def test_models_match_migrations(fresh_database_url: str) -> None:
    """No drift between SQLAlchemy models and what the migrations create."""
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext

    from app.models import Base

    run_migrations(fresh_database_url)
    engine = create_engine(fresh_database_url)
    try:
        with engine.connect() as conn:
            diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    finally:
        engine.dispose()
    assert diff == []
