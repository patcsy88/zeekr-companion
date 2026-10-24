"""D3: invalid UTF-8 and malformed JSON bodies are 400 validation_error, never http_error."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.conftest import PASSWORD, USERNAME

JSON = {"content-type": "application/json"}

BAD_BODIES = [
    pytest.param(b'\xff\xfe{"password": "x"}', id="invalid-utf8-prefix"),
    pytest.param(b'{"password": "\xc3("}', id="invalid-utf8-inside-string"),
    pytest.param(b'{"password": ', id="truncated-json"),
    pytest.param(b"{bad json", id="not-json"),
    pytest.param(b"", id="empty"),
    pytest.param(b"[1, 2", id="truncated-array"),
]


def _assert_validation_error(response: object) -> None:
    assert response.status_code == 400  # type: ignore[attr-defined]
    error = response.json()["error"]  # type: ignore[attr-defined]
    assert error["code"] == "validation_error"
    assert error["message"]
    assert error["details"], "details must say what is wrong"
    assert all(set(d) == {"field", "issue"} for d in error["details"])
    assert [d["field"] for d in error["details"]] == ["body"] * len(error["details"])


@pytest.mark.parametrize("body", BAD_BODIES)
def test_login_with_bad_body(client: TestClient, body: bytes) -> None:
    _assert_validation_error(client.post("/api/v1/auth/token", content=body, headers=JSON))


@pytest.mark.parametrize("body", BAD_BODIES)
def test_authenticated_endpoints_with_bad_body(
    client: TestClient, auth_headers: dict[str, str], body: bytes
) -> None:
    headers = {**auth_headers, **JSON}
    _assert_validation_error(client.post("/api/v1/service-records", content=body, headers=headers))
    _assert_validation_error(client.put("/api/v1/vehicle", content=body, headers=headers))


def test_bad_body_response_is_still_no_store(client: TestClient) -> None:
    response = client.post("/api/v1/auth/token", content=b"\xff\xfe", headers=JSON)
    assert response.headers["cache-control"] == "no-store"


def test_good_body_unaffected(client: TestClient) -> None:
    response = client.post("/api/v1/auth/token", json={"username": USERNAME, "password": PASSWORD})
    assert response.status_code == 200
