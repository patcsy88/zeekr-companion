"""AC-2: migrations apply to an empty database and can be re-run."""

from __future__ import annotations

import datetime as dt
from typing import Any

import pytest
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
                conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0013"
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


def test_adr008_energy_migration_downgrades_keeps_rows_and_reapplies(
    fresh_database_url: str,
) -> None:
    import os

    from alembic import command
    from alembic.config import Config

    from tests.conftest import API_ROOT

    run_migrations(fresh_database_url)
    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "alembic"))
    engine = create_engine(fresh_database_url)
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO expense (id, date, category, amount_minor, energy_wh) "
                "VALUES (gen_random_uuid(), DATE '2026-09-01', 'charging', 1000, 5000)"
            )
        )
    os.environ["DATABASE_URL"] = fresh_database_url
    try:
        command.downgrade(cfg, "0005")
        assert "energy_wh" not in {c["name"] for c in inspect(engine).get_columns("expense")}
        with engine.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM expense")).scalar_one() == 1
            assert (
                conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0005"
            )
    finally:
        os.environ.pop("DATABASE_URL", None)
    run_migrations(fresh_database_url)
    columns = {c["name"] for c in inspect(engine).get_columns("expense")}
    assert "energy_wh" in columns
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM expense")).scalar_one() == 1
        assert conn.execute(text("SELECT energy_wh FROM expense")).scalar_one() is None
    engine.dispose()


def test_adr008_advisory_migration_downgrades_and_reapplies(fresh_database_url: str) -> None:
    import os

    from alembic import command
    from alembic.config import Config

    from tests.conftest import API_ROOT

    run_migrations(fresh_database_url)
    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "alembic"))
    engine = create_engine(fresh_database_url)
    os.environ["DATABASE_URL"] = fresh_database_url
    try:
        command.downgrade(cfg, "0006")
        tables = set(inspect(engine).get_table_names())
        assert not {"advisory_proposal", "advisory_model_call"} & tables
        assert "expense" in tables
    finally:
        os.environ.pop("DATABASE_URL", None)
    run_migrations(fresh_database_url)
    assert {"advisory_proposal", "advisory_model_call"} <= set(inspect(engine).get_table_names())
    engine.dispose()


def test_live_reading_migration_downgrades_and_reapplies(fresh_database_url: str) -> None:
    import os

    from alembic import command
    from alembic.config import Config

    from tests.conftest import API_ROOT

    run_migrations(fresh_database_url)
    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "alembic"))
    os.environ["DATABASE_URL"] = fresh_database_url
    try:
        command.downgrade(cfg, "0007")
        engine = create_engine(fresh_database_url)
        assert "live_reading" not in inspect(engine).get_table_names()
        assert "advisory_proposal" in inspect(engine).get_table_names()
        engine.dispose()
    finally:
        os.environ.pop("DATABASE_URL", None)
    run_migrations(fresh_database_url)
    engine = create_engine(fresh_database_url)
    insp = inspect(engine)
    assert "live_reading" in insp.get_table_names()
    assert "uq_live_reading_observed_at" in {
        c["name"] for c in insp.get_unique_constraints("live_reading")
    }
    engine.dispose()


def test_0009_live_additions_downgrade_and_reapply_keep_the_bounds(
    fresh_database_url: str,
) -> None:
    import os

    from alembic import command
    from alembic.config import Config
    from sqlalchemy.exc import IntegrityError

    from tests.conftest import API_ROOT

    run_migrations(fresh_database_url)
    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "alembic"))
    os.environ["DATABASE_URL"] = fresh_database_url
    try:
        command.downgrade(cfg, "0008")
        engine = create_engine(fresh_database_url)
        cols = {c["name"] for c in inspect(engine).get_columns("live_reading")}
        assert "battery_12v_volts" not in cols and not any("tyre_temp" in c for c in cols)
        engine.dispose()
    finally:
        os.environ.pop("DATABASE_URL", None)
    run_migrations(fresh_database_url)
    engine = create_engine(fresh_database_url)
    volt, temp = "battery_12v_volts", "tyre_temp_driver_front_c"
    for column, bad in ((volt, 5.9), (volt, 20.1), (temp, -41), (temp, 151)):
        with pytest.raises(IntegrityError), engine.begin() as conn:
            conn.execute(
                text(
                    f"INSERT INTO live_reading (id, observed_at, received_at, {column}) "  # noqa: S608
                    "VALUES (gen_random_uuid(), now(), now(), :v)"
                ),
                {"v": bad},
            )
    engine.dispose()


def test_0010_service_record_reminder_id_downgrades_and_reapplies(
    fresh_database_url: str,
) -> None:
    import os

    from alembic import command
    from alembic.config import Config

    from tests.conftest import API_ROOT

    run_migrations(fresh_database_url)
    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "alembic"))
    os.environ["DATABASE_URL"] = fresh_database_url
    try:
        command.downgrade(cfg, "0009")
        engine = create_engine(fresh_database_url)
        cols = {c["name"] for c in inspect(engine).get_columns("service_record")}
        assert "reminder_id" not in cols
        engine.dispose()
    finally:
        os.environ.pop("DATABASE_URL", None)
    run_migrations(fresh_database_url)
    engine = create_engine(fresh_database_url)
    cols = {c["name"] for c in inspect(engine).get_columns("service_record")}
    assert "reminder_id" in cols
    engine.dispose()


def test_0011_sentry_column_downgrades_and_reapplies(fresh_database_url: str) -> None:
    import os

    from alembic import command
    from alembic.config import Config

    from tests.conftest import API_ROOT

    run_migrations(fresh_database_url)
    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "alembic"))
    os.environ["DATABASE_URL"] = fresh_database_url
    try:
        command.downgrade(cfg, "0010")
        engine = create_engine(fresh_database_url)
        cols = {c["name"] for c in inspect(engine).get_columns("live_reading")}
        assert "sentry_active" not in cols and "engine_enable_running" in cols
        engine.dispose()
    finally:
        os.environ.pop("DATABASE_URL", None)
    run_migrations(fresh_database_url)
    engine = create_engine(fresh_database_url)
    columns = {c["name"]: c for c in inspect(engine).get_columns("live_reading")}
    assert "sentry_active" in columns and columns["sentry_active"]["nullable"] is True
    engine.dispose()


def test_0012_command_log_downgrades_and_reapplies(fresh_database_url: str) -> None:
    import os

    from alembic import command
    from alembic.config import Config

    from tests.conftest import API_ROOT

    run_migrations(fresh_database_url)
    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "alembic"))
    os.environ["DATABASE_URL"] = fresh_database_url
    try:
        command.downgrade(cfg, "0011")
        engine = create_engine(fresh_database_url)
        assert "car_command_log" not in inspect(engine).get_table_names()
        engine.dispose()
    finally:
        os.environ.pop("DATABASE_URL", None)
    run_migrations(fresh_database_url)
    engine = create_engine(fresh_database_url)
    cols = {c["name"] for c in inspect(engine).get_columns("car_command_log")}
    assert cols == {"id", "created_at", "desired", "source", "result", "state_after"}
    engine.dispose()


def test_0013_geofence_allows_the_new_condition_and_status_and_downgrades(
    fresh_database_url: str,
) -> None:
    import os
    import uuid

    from alembic import command
    from alembic.config import Config
    from sqlalchemy.exc import IntegrityError

    from tests.conftest import API_ROOT

    def insert(conn: Any, condition: str, status: str, decided: bool) -> None:
        conn.execute(
            text(
                "INSERT INTO advisory_proposal (id, condition, dedupe_key, status, inputs, "
                "source_refs, explanation_status, rule_version, decided_at) VALUES "
                "(:id, :c, :k, :s, '{}', '[]', 'disabled', 1, :d)"
            ),
            {
                "id": uuid.uuid4(),
                "c": condition,
                "k": str(uuid.uuid4()),
                "s": status,
                "d": dt.datetime.now(dt.UTC) if decided else None,
            },
        )

    run_migrations(fresh_database_url)
    engine = create_engine(fresh_database_url)
    with engine.begin() as conn:
        insert(conn, "sentry_off_outside_geofence", "proposed", False)
        insert(conn, "sentry_off_outside_geofence", "closed", True)
        insert(conn, "date_vs_km_service", "dismissed", True)
    with pytest.raises(IntegrityError), engine.begin() as conn:
        insert(conn, "sentry_off_outside_geofence", "closed", False)  # closed needs decided_at
    with pytest.raises(IntegrityError), engine.begin() as conn:
        insert(conn, "something_else", "proposed", False)
    with pytest.raises(IntegrityError), engine.begin() as conn:
        insert(conn, "date_vs_km_service", "reopened", True)
    engine.dispose()

    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "alembic"))
    os.environ["DATABASE_URL"] = fresh_database_url
    try:
        command.downgrade(cfg, "0012")
        engine = create_engine(fresh_database_url)
        with engine.connect() as conn:
            left = conn.execute(
                text("SELECT condition, status FROM advisory_proposal ORDER BY condition")
            ).all()
        engine.dispose()
        assert [tuple(r) for r in left] == [("date_vs_km_service", "dismissed")]
    finally:
        os.environ.pop("DATABASE_URL", None)
    run_migrations(fresh_database_url)
