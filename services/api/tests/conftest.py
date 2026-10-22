"""Test fixtures. Tests need a disposable PostgreSQL server, never real data.

Set TEST_DATABASE_URL to a server URL (e.g. postgresql+psycopg://postgres:pw@localhost:55432/postgres).
Each test session creates its own throwaway database `zc_test_<random>` and drops it afterwards.
"""

from __future__ import annotations

import os
import pathlib
import secrets
import uuid
from collections.abc import Iterator

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.config import Settings
from app.main import create_app
from app.security import hash_password

API_ROOT = pathlib.Path(__file__).resolve().parents[1]
PASSWORD = "correct horse battery staple"
TOKEN_SECRET = "Zk3pW8rQv1LmX6dNt9BcYh2FsJ5aGe7U"  # test-only, diverse


def _admin_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.exit("TEST_DATABASE_URL is not set; refusing to run without a disposable DB", 2)
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return url


def run_migrations(database_url: str) -> None:
    cfg = Config(str(API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_ROOT / "alembic"))
    previous = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = database_url
    try:
        command.upgrade(cfg, "head")
    finally:
        if previous is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous


@pytest.fixture(scope="session")
def admin_url() -> str:
    return _admin_url()


@pytest.fixture
def fresh_database_url(admin_url: str) -> Iterator[str]:
    """An empty, uniquely named database, dropped afterwards."""
    name = f"zc_test_{secrets.token_hex(6)}"
    admin = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    url = make_url(admin_url).set(database=name).render_as_string(hide_password=False)
    try:
        yield url
    finally:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


@pytest.fixture(scope="session")
def database_url(admin_url: str) -> Iterator[str]:
    name = f"zc_test_{secrets.token_hex(6)}"
    admin = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    url = make_url(admin_url).set(database=name).render_as_string(hide_password=False)
    run_migrations(url)
    try:
        yield url
    finally:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


@pytest.fixture(scope="session")
def password_hash() -> str:
    return hash_password(PASSWORD, n=2**4)  # cheap cost factor, tests only


def make_settings(database_url: str, password_hash: str, **overrides: object) -> Settings:
    values: dict[str, object] = {
        "database_url": database_url,
        "owner_password_hash": SecretStr(password_hash),
        "token_secret": SecretStr(TOKEN_SECRET),
        "cors_allowed_origins": "",
        "login_max_failures": 3,
    }
    values.update(overrides)
    return Settings(**values)  # type: ignore[arg-type]


@pytest.fixture
def client(database_url: str, password_hash: str) -> Iterator[TestClient]:
    app = create_app(make_settings(database_url, password_hash))
    with app.state.engine.begin() as conn:
        conn.execute(text("TRUNCATE service_record, vehicle, reminder, expense"))
    with TestClient(app) as test_client:
        yield test_client
    app.state.engine.dispose()


@pytest.fixture
def auth_headers(client: TestClient) -> dict[str, str]:
    response = client.post("/api/v1/auth/token", json={"password": PASSWORD})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def new_id() -> str:
    return str(uuid.uuid4())


def record_body(**overrides: object) -> dict[str, object]:
    body: dict[str, object] = {
        "id": new_id(),
        "date": "2026-09-01",
        "odometer": 12000,
        "provider": "Zeekr Service Centre",
        "description": "First service",
        "cost_minor": 25000,
        "currency": "MYR",
        "notes": "All good",
    }
    body.update(overrides)
    return body
