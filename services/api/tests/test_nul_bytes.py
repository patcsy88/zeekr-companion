"""D1: a NUL byte in any free-text field is a 400 validation_error naming the field, never a 500."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.conftest import new_id, record_body
from tests.test_vehicle import VEHICLE

VEHICLE_TEXT_FIELDS = ["model", "variant", "drive", "steering", "registration", "vin", "tyre_spec"]
RECORD_TEXT_FIELDS = ["provider", "description", "notes"]


def _assert_rejected(response: object, field: str) -> None:
    assert response.status_code == 400  # type: ignore[attr-defined]
    error = response.json()["error"]  # type: ignore[attr-defined]
    assert error["code"] == "validation_error"
    assert field in [d["field"] for d in error["details"]]


@pytest.mark.parametrize("field", VEHICLE_TEXT_FIELDS)
def test_vehicle_put_rejects_nul(
    client: TestClient, auth_headers: dict[str, str], field: str
) -> None:
    value = "A" * 8 + "\u0000" + "A" * 8 if field == "vin" else "ab\u0000cd"
    response = client.put("/api/v1/vehicle", json={**VEHICLE, field: value}, headers=auth_headers)
    _assert_rejected(response, field)


@pytest.mark.parametrize("field", RECORD_TEXT_FIELDS)
def test_record_create_rejects_nul(
    client: TestClient, auth_headers: dict[str, str], field: str
) -> None:
    body = record_body(**{field: "ab\u0000cd"})
    response = client.post("/api/v1/service-records", json=body, headers=auth_headers)
    _assert_rejected(response, field)


@pytest.mark.parametrize("field", RECORD_TEXT_FIELDS)
def test_record_patch_rejects_nul(
    client: TestClient, auth_headers: dict[str, str], field: str
) -> None:
    body = record_body(id=new_id())
    assert (
        client.post("/api/v1/service-records", json=body, headers=auth_headers).status_code == 201
    )
    response = client.patch(
        f"/api/v1/service-records/{body['id']}", json={field: "x\u0000y"}, headers=auth_headers
    )
    _assert_rejected(response, field)
    got = client.get(f"/api/v1/service-records/{body['id']}", headers=auth_headers).json()
    assert got[field] == body[field]
