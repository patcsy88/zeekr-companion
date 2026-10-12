"""AC-4 / FR-1: vehicle profile."""

from __future__ import annotations

from fastapi.testclient import TestClient

VEHICLE = {
    "model": "7X",
    "variant": "Long Range AWD",
    "drive": "AWD",
    "steering": "RHD",
    "registration": "TEST 0000",
    "vin": "A" * 17,
    "purchase_date": "2026-08-15",
    "purchase_price_minor": 25_000_000,
    "currency": "MYR",
    "tyre_spec": "255/45 R20",
}


def test_get_before_create_is_404(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.get("/api/v1/vehicle", headers=auth_headers)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_ac4_create_then_retrieve_same_values(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    put = client.put("/api/v1/vehicle", json=VEHICLE, headers=auth_headers)
    assert put.status_code == 200
    got = client.get("/api/v1/vehicle", headers=auth_headers)
    assert got.status_code == 200
    body = got.json()
    assert body["id"]
    assert {k: v for k, v in body.items() if k != "id"} == VEHICLE
    assert body == put.json()


def test_put_replaces_and_keeps_single_profile(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    first = client.put("/api/v1/vehicle", json=VEHICLE, headers=auth_headers).json()
    changed = {**VEHICLE, "variant": "Performance", "registration": None, "tyre_spec": None}
    second = client.put("/api/v1/vehicle", json=changed, headers=auth_headers)
    assert second.status_code == 200
    assert second.json()["id"] == first["id"]
    assert second.json()["variant"] == "Performance"
    assert second.json()["registration"] is None


def test_put_with_other_id_is_409(client: TestClient, auth_headers: dict[str, str]) -> None:
    client.put("/api/v1/vehicle", json=VEHICLE, headers=auth_headers)
    other = client.put(
        "/api/v1/vehicle",
        json={**VEHICLE, "id": "11111111-1111-4111-8111-111111111111"},
        headers=auth_headers,
    )
    assert other.status_code == 409
    assert other.json()["error"]["code"] == "conflict"


def test_minimal_vehicle_uses_defaults(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.put("/api/v1/vehicle", json={"model": "7X"}, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["currency"] == "MYR"
    assert body["drive"] == "AWD"
    assert body["steering"] == "RHD"
    assert body["purchase_price_minor"] == 0
    assert body["vin"] is None


def test_vehicle_validation(client: TestClient, auth_headers: dict[str, str]) -> None:
    bad_bodies = {
        "model": {**VEHICLE, "model": ""},
        "model_missing": {k: v for k, v in VEHICLE.items() if k != "model"},
        "vin": {**VEHICLE, "vin": "SHORT"},
        "purchase_price_minor": {**VEHICLE, "purchase_price_minor": -1},
        "currency": {**VEHICLE, "currency": "GBP"},
        "float_price": {**VEHICLE, "purchase_price_minor": 10.5},
    }
    for name, body in bad_bodies.items():
        response = client.put("/api/v1/vehicle", json=body, headers=auth_headers)
        assert response.status_code == 400, name
        error = response.json()["error"]
        assert error["code"] == "validation_error"
        assert error["details"], name
        assert {"field", "issue"} <= set(error["details"][0])
