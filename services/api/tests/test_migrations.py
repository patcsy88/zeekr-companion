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
        assert {
            "vehicle",
            "service_record",
            "reminder",
            "expense",
            "warranty_coverage",
            "warranty_claim",
            "owner_account",
            "alembic_version",
        } <= set(inspector.get_table_names())
        columns = {c["name"] for c in inspector.get_columns("service_record")}
        assert {"id", "date", "odometer", "cost_minor", "currency", "created_at"} <= columns
        with engine.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM alembic_version")).scalar_one() == 1
            assert (
                conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0005"
            )
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


def test_ac29_reminder_migration_downgrades_and_reapplies(fresh_database_url: str) -> None:
    from alembic import command
    from alembic.config import Config

    from tests.conftest import API_ROOT

    run_migrations(fresh_database_url)
    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "alembic"))
    import os

    os.environ["DATABASE_URL"] = fresh_database_url
    try:
        command.downgrade(cfg, "0001")
        engine = create_engine(fresh_database_url)
        assert "reminder" not in inspect(engine).get_table_names()
        engine.dispose()
    finally:
        os.environ.pop("DATABASE_URL", None)
    run_migrations(fresh_database_url)
    engine = create_engine(fresh_database_url)
    assert "reminder" in inspect(engine).get_table_names()
    engine.dispose()


def test_ac47_expense_migration_downgrades_and_reapplies(fresh_database_url: str) -> None:
    import os

    from alembic import command
    from alembic.config import Config

    from tests.conftest import API_ROOT

    run_migrations(fresh_database_url)
    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "alembic"))
    os.environ["DATABASE_URL"] = fresh_database_url
    try:
        command.downgrade(cfg, "0002")
        engine = create_engine(fresh_database_url)
        tables = set(inspect(engine).get_table_names())
        assert "expense" not in tables
        assert "reminder" in tables
        with engine.connect() as conn:
            assert (
                conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0002"
            )
        engine.dispose()
    finally:
        os.environ.pop("DATABASE_URL", None)
    run_migrations(fresh_database_url)
    run_migrations(fresh_database_url)
    engine = create_engine(fresh_database_url)
    insp = inspect(engine)
    assert "expense" in insp.get_table_names()
    assert "ix_expense_history" in {i["name"] for i in insp.get_indexes("expense")}
    engine.dispose()


def test_ac68_warranty_migration_downgrades_and_reapplies(fresh_database_url: str) -> None:
    import os

    from alembic import command
    from alembic.config import Config

    from tests.conftest import API_ROOT

    run_migrations(fresh_database_url)
    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "alembic"))
    os.environ["DATABASE_URL"] = fresh_database_url
    try:
        command.downgrade(cfg, "0003")
        engine = create_engine(fresh_database_url)
        tables = set(inspect(engine).get_table_names())
        assert not {"warranty_coverage", "warranty_claim"} & tables
        assert "expense" in tables
        with engine.connect() as conn:
            assert (
                conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0003"
            )
        engine.dispose()
    finally:
        os.environ.pop("DATABASE_URL", None)
    run_migrations(fresh_database_url)
    run_migrations(fresh_database_url)
    engine = create_engine(fresh_database_url)
    insp = inspect(engine)
    assert {"warranty_coverage", "warranty_claim"} <= set(insp.get_table_names())
    assert "ix_warranty_claim_history" in {i["name"] for i in insp.get_indexes("warranty_claim")}
    fk = insp.get_foreign_keys("warranty_claim")[0]
    assert fk["referred_table"] == "warranty_coverage"
    assert fk["options"]["ondelete"] == "CASCADE"
    engine.dispose()
