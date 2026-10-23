"""AC-3 / FR-11: authentication."""

from __future__ import annotations

import logging
import uuid

import pytest
from fastapi.testclient import TestClient

from app import security
from tests.conftest import PASSWORD, TOKEN_SECRET

ZERO = str(uuid.UUID(int=0))

DATA_ENDPOINTS = [
    ("PUT", "/api/v1/vehicle"),
    ("GET", "/api/v1/vehicle"),
    ("POST", "/api/v1/service-records"),
    ("GET", "/api/v1/service-records"),
    ("GET", f"/api/v1/service-records/{ZERO}"),
    ("PATCH", f"/api/v1/service-records/{ZERO}"),
    ("DELETE", f"/api/v1/service-records/{ZERO}"),
]


@pytest.mark.parametrize(("method", "path"), DATA_ENDPOINTS)
def test_ac3_data_endpoint_without_token_is_401(client: TestClient, method: str, path: str) -> None:
    response = client.request(method, path, json={})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"
    assert response.json()["error"]["message"]


@pytest.mark.parametrize(("method", "path"), DATA_ENDPOINTS)
@pytest.mark.parametrize("header", ["Bearer garbage", "Basic abc", "Bearer ", "nonsense"])
def test_ac3_invalid_token_is_401(client: TestClient, method: str, path: str, header: str) -> None:
    response = client.request(method, path, json={}, headers={"Authorization": header})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"


def test_ac3_expired_and_forged_tokens_are_401(client: TestClient) -> None:
    expired = security.issue_token(TOKEN_SECRET, 3600, now=1_000)
    forged = security.issue_token("w" * 40, 3600)
    for token in (expired, forged):
        response = client.get("/api/v1/vehicle", headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 401


def test_health_needs_no_auth(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_unknown_path_uses_error_shape(client: TestClient) -> None:
    response = client.get("/nope")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_token_success(client: TestClient) -> None:
    response = client.post("/api/v1/auth/token", json={"password": PASSWORD})
    assert response.status_code == 200
    body = response.json()
    assert body["expires_in"] == 3600
    assert body["access_token"]
    ok = client.get("/api/v1/vehicle", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert ok.status_code == 404  # authenticated, but no vehicle yet


def test_wrong_password_is_401_and_not_logged(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    secret_attempt = "hunter2-very-secret"
    with caplog.at_level(logging.INFO):
        response = client.post("/api/v1/auth/token", json={"password": secret_attempt})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"
    assert "failed login attempt" in caplog.text
    assert secret_attempt not in caplog.text


def test_rate_limit_after_repeated_failures(client: TestClient) -> None:
    for _ in range(3):
        assert client.post("/api/v1/auth/token", json={"password": "bad"}).status_code == 401
    blocked = client.post("/api/v1/auth/token", json={"password": PASSWORD})
    assert blocked.status_code == 429
    assert int(blocked.headers["Retry-After"]) >= 1
    assert blocked.json()["error"]["code"] == "rate_limited"


def test_token_request_validation(client: TestClient) -> None:
    response = client.post("/api/v1/auth/token", json={})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"


def test_password_hash_roundtrip() -> None:
    # Not hex-only text, so the plaintext check below cannot match the random hex in the hash.
    stored = security.hash_password("pw-xyz-roundtrip", n=2**4)
    assert security.verify_password("pw-xyz-roundtrip", stored)
    assert not security.verify_password("pw-xyz-roundtripX", stored)
    assert "pw-xyz-roundtrip" not in stored
