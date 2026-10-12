from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from app.config import Settings
from app.main import create_app
from tests.conftest import make_settings


def test_cors_default_allows_no_origin(client: TestClient) -> None:
    response = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in response.headers


def test_cors_configured_origin(database_url: str, password_hash: str) -> None:
    settings = make_settings(
        database_url,
        password_hash,
        cors_allowed_origins="https://app.example, http://localhost:5173/",
    )
    app = create_app(settings)
    with TestClient(app) as c:
        ok = c.options(
            "/api/v1/vehicle",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "PUT",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        assert ok.headers["access-control-allow-origin"] == "http://localhost:5173"
        bad = c.options(
            "/api/v1/vehicle",
            headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "PUT"},
        )
        assert "access-control-allow-origin" not in bad.headers
    app.state.engine.dispose()


def test_wildcard_origin_rejected(database_url: str, password_hash: str) -> None:
    with pytest.raises(ValidationError):
        make_settings(database_url, password_hash, cors_allowed_origins="*")


def test_settings_require_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("DATABASE_URL", "OWNER_PASSWORD_HASH", "TOKEN_SECRET"):
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)  # type: ignore[call-arg]


def test_settings_reject_weak_values(database_url: str) -> None:
    with pytest.raises(ValidationError):
        Settings(
            database_url=database_url,
            owner_password_hash=SecretStr("plaintext"),
            token_secret=SecretStr("short"),
        )
