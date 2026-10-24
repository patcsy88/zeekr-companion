"""ADR-003: Tailscale Serve identity headers are ignored by the API and never logged.

Caddy deletes them before the API (infra/smoke.sh proves it on the real stack). This is defence in
depth: if one ever arrived, it must not choose a rate-limit bucket, change auth, or reach a log.
The values below are fake placeholders, not real accounts.
"""

from __future__ import annotations

import logging

import pytest
from fastapi.testclient import TestClient

from tests.conftest import PASSWORD, USERNAME

LOGIN = "placeholder-owner@example.invalid"
NAME = "Placeholder Owner Name"
PIC = "https://example.invalid/placeholder-pic.png"
INFO = "https://example.invalid/headers-info"


def _identity(n: int) -> dict[str, str]:
    return {
        "Tailscale-User-Login": f"{n}-{LOGIN}",
        "Tailscale-User-Name": f"{n}-{NAME}",
        "Tailscale-User-Profile-Pic": f"{n}-{PIC}",
        "Tailscale-Headers-Info": INFO,
        "Tailscale-Future-Header": f"future-{n}",
    }


def _post(client: TestClient, password: str, headers: dict[str, str]) -> int:
    return client.post(
        "/api/v1/auth/token", json={"username": USERNAME, "password": password}, headers=headers
    ).status_code


def test_identity_headers_do_not_choose_the_rate_limit_bucket(client: TestClient) -> None:
    # login_max_failures is 3 in the test settings; each attempt claims a different identity.
    for n in range(3):
        assert _post(client, "wrong", _identity(n)) == 401
    assert _post(client, PASSWORD, _identity(99)) == 429
    assert _post(client, PASSWORD, {}) == 429


def test_identity_headers_grant_nothing(client: TestClient) -> None:
    response = client.get("/api/v1/vehicle", headers=_identity(1))
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"


def test_identity_headers_are_never_logged(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    h = _identity(7)
    assert _post(client, "wrong", h) == 401  # failed login log line
    assert _post(client, "wrong", h) == 401
    assert _post(client, "wrong", h) == 401
    assert _post(client, PASSWORD, h) == 429  # rate-limit log line
    client.get("/api/v1/vehicle", headers=h)

    text = "\n".join(f"{r.name} {r.getMessage()} {r.exc_text or ''}" for r in caplog.records)
    assert "failed login attempt" in text  # the lines we care about were actually emitted
    assert "blocked by rate limit" in text
    for needle in (LOGIN, NAME, PIC, INFO, "future-7", "Tailscale-"):
        assert needle not in text


def test_successful_login_with_identity_headers_logs_no_identity(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    assert _post(client, PASSWORD, _identity(3)) == 200
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "login succeeded" in text
    assert LOGIN not in text
    assert NAME not in text
