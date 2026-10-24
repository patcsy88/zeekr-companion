"""L2-L8 and docs-off regression tests."""

from __future__ import annotations

import logging
import pathlib

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from app.config import Settings
from app.db import create_db_engine
from tests.conftest import (
    PASSWORD,
    TOKEN_SECRET,
    USERNAME,
    make_settings,
    record_body,
    seed_owner,
)

REPO = pathlib.Path(__file__).resolve().parents[3]
API = REPO / "services" / "api"
DB_PASSWORD = "Sup3rS3cretDbPw"  # test-only fixture, not a real secret


# --- docs / schema are off ------------------------------------------------------------------


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_interactive_docs_and_schema_are_not_served(client: TestClient, path: str) -> None:
    response = client.get(path)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


# --- L4: database password never leaks -------------------------------------------------------


def test_engine_hides_statement_parameters(database_url: str) -> None:
    engine = create_db_engine(database_url)
    assert engine.hide_parameters is True
    engine.dispose()


@pytest.mark.parametrize(
    "url",
    [
        f"mysql://zeekr:{DB_PASSWORD}@db:5432/zeekr",  # wrong scheme
        f"postgresql://zeekr:{DB_PASSWORD}@db:5432/zeekr",  # valid URL, other fields bad below
    ],
)
def test_validation_errors_never_print_database_password(url: str) -> None:
    with pytest.raises(ValidationError) as info:
        Settings(
            database_url=url,
            token_secret=SecretStr("short"),
        )
    assert DB_PASSWORD not in str(info.value)
    assert DB_PASSWORD not in repr(info.value)
    settings = Settings(
        database_url=url.replace("mysql://", "postgresql://"),
        token_secret=SecretStr(TOKEN_SECRET),
    )
    assert DB_PASSWORD not in repr(settings)
    assert DB_PASSWORD not in str(settings)


# --- L5: no-store, login logging -------------------------------------------------------------


def test_api_responses_are_no_store(client: TestClient, auth_headers: dict[str, str]) -> None:
    ok = client.get("/api/v1/service-records", headers=auth_headers)
    unauth = client.get("/api/v1/vehicle")
    missing = client.get("/api/v1/vehicle", headers=auth_headers)
    bad = client.post("/api/v1/auth/token", json={})
    token = client.post("/api/v1/auth/token", json={"username": USERNAME, "password": PASSWORD})
    unknown = client.get("/api/v1/nope")
    for response in (ok, unauth, missing, bad, token, unknown):
        assert response.headers["cache-control"] == "no-store", response.url


def test_successful_login_logged_at_info_without_token(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO):
        response = client.post(
            "/api/v1/auth/token", json={"username": USERNAME, "password": PASSWORD}
        )
    token = response.json()["access_token"]
    assert "login succeeded" in caplog.text
    assert token not in caplog.text
    assert PASSWORD not in caplog.text
    assert any(r.levelno == logging.INFO and "login succeeded" in r.message for r in caplog.records)


# --- L6: body size and concurrency ------------------------------------------------------------


def _assert_too_large(response: object) -> None:
    assert response.status_code == 400  # type: ignore[attr-defined]
    error = response.json()["error"]  # type: ignore[attr-defined]
    assert error["code"] == "validation_error"
    assert error["details"] == [{"field": "body", "issue": "request body is too large"}]


def test_oversized_body_with_content_length_is_rejected(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    # Valid JSON shape, so only a size cap (not field validation) can explain the rejection.
    body = '{"id": "x", "pad": "' + "x" * 100_000 + '"}'
    response = client.post(
        "/api/v1/service-records",
        content=body,
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    _assert_too_large(response)


def test_oversized_body_rejected_even_without_auth(client: TestClient) -> None:
    response = client.post("/api/v1/auth/token", content=b"{" + b" " * 200_000 + b"}")
    _assert_too_large(response)


def test_oversized_chunked_body_is_rejected(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    def chunks():  # type: ignore[no-untyped-def]
        yield b'{"password": "'
        for _ in range(40):
            yield b"x" * 10_000

    response = client.post(
        "/api/v1/auth/token",
        content=chunks(),
        headers={"Content-Type": "application/json"},
    )
    _assert_too_large(response)


def test_normal_sized_body_still_accepted(client: TestClient, auth_headers: dict[str, str]) -> None:
    body = record_body(notes="n" * 5000, description="d" * 500, provider="p" * 200)
    response = client.post("/api/v1/service-records", json=body, headers=auth_headers)
    assert response.status_code == 201


def test_entrypoint_limits_concurrency() -> None:
    script = (API / "docker-entrypoint.sh").read_text()
    assert "--limit-concurrency" in script


# --- L8: lone surrogate counts as a failed attempt; settings are bounded -----------------------


def test_unencodable_password_counts_as_failed_attempt(
    database_url: str, password_hash: str
) -> None:
    from app.db import create_db_engine, create_session_factory
    from app.errors import RateLimited, Unauthenticated
    from app.services.auth import AuthService

    seed_owner(database_url, password_hash)
    engine = create_db_engine(database_url)
    service = AuthService(
        session_factory=create_session_factory(engine),
        token_secret=TOKEN_SECRET,
        token_ttl_seconds=3600,
        max_failures=3,
        window_seconds=900,
    )
    for _ in range(3):
        with pytest.raises(Unauthenticated):
            service.login(USERNAME, "\ud800", "client-a")  # lone surrogate cannot be UTF-8 encoded
    with pytest.raises(RateLimited):
        service.login(USERNAME, PASSWORD, "client-a")
    engine.dispose()


def test_lone_surrogate_over_http_is_not_a_500(client: TestClient) -> None:
    response = client.post(
        "/api/v1/auth/token",
        content='{"password": "\\ud800"}',
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code in (400, 401)


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("token_ttl_seconds", 0),
        ("token_ttl_seconds", -5),
        ("token_ttl_seconds", 10**9),
        ("login_max_failures", 0),
        ("login_max_failures", 10**6),
        ("login_window_seconds", 0),
        ("login_window_seconds", 10**9),
    ],
)
def test_unbounded_settings_rejected(database_url: str, name: str, value: int) -> None:
    with pytest.raises(ValidationError):
        make_settings(database_url, **{name: value})


# --- L2: .dockerignore ---------------------------------------------------------------------


def test_dockerignore_excludes_nested_bytecode() -> None:
    lines = (API / ".dockerignore").read_text().splitlines()
    assert "**/__pycache__" in lines
    assert "**/*.pyc" in lines
