"""AC-108: renewal details on insurance and road tax reminders (all values are synthetic)."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tests.conftest import new_id

URL = "/api/v1/reminders"
INSURANCE = {
    "insurer": "Example Insurer",
    "cover_type": "comprehensive",
    "premium_minor": 123456,
    "insurer_phone": "+60 3 0000 0000",
}
NEW_FIELDS = ("insurer", "cover_type", "premium_minor", "insurer_phone", "amount_minor")


def body(kind: str, **extra: Any) -> dict[str, Any]:
    b: dict[str, Any] = {
        "id": new_id(),
        "kind": kind,
        "title": "Renewal",
        "due_date": "2027-03-01",
    }
    b.update(extra)
    return b


def test_insurance_fields_round_trip(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = body("insurance_renewal", **INSURANCE)
    assert client.post(URL, json=b, headers=auth_headers).status_code == 201
    got = client.get(f"{URL}/{b['id']}", headers=auth_headers).json()
    for k, v in INSURANCE.items():
        assert got[k] == v
    assert got["amount_minor"] is None
    listed = client.get(URL, headers=auth_headers).json()["items"]
    assert next(i for i in listed if i["id"] == b["id"])["insurer"] == "Example Insurer"


def test_road_tax_amount_round_trip(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = body("road_tax_renewal", amount_minor=9000)
    assert client.post(URL, json=b, headers=auth_headers).status_code == 201
    got = client.get(f"{URL}/{b['id']}", headers=auth_headers).json()
    assert got["amount_minor"] == 9000
    assert all(got[k] is None for k in INSURANCE)


def test_unset_fields_are_null(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = body("insurance_renewal")
    client.post(URL, json=b, headers=auth_headers)
    got = client.get(f"{URL}/{b['id']}", headers=auth_headers).json()
    assert all(got[k] is None for k in NEW_FIELDS)


@pytest.mark.parametrize(
    ("kind", "extra"),
    [
        ("service", {"insurer": "X", "due_odometer": 20000}),
        ("service", {"amount_minor": 1, "due_odometer": 20000}),
        ("road_tax_renewal", {"insurer": "X"}),
        ("road_tax_renewal", {"premium_minor": 1}),
        ("insurance_renewal", {"amount_minor": 1}),
    ],
)
def test_field_for_the_wrong_kind_is_400(
    client: TestClient, auth_headers: dict[str, str], kind: str, extra: dict[str, Any]
) -> None:
    r = client.post(URL, json=body(kind, **extra), headers=auth_headers)
    assert r.status_code == 400


@pytest.mark.parametrize(
    "extra",
    [
        {"cover_type": "everything"},
        {"premium_minor": -1},
        {"premium_minor": 100_000_001},
        {"premium_minor": 1.5},
        {"insurer": ""},
        {"insurer": "x" * 201},
        {"insurer_phone": "1" * 31},
    ],
)
def test_bad_values_are_400(
    client: TestClient, auth_headers: dict[str, str], extra: dict[str, Any]
) -> None:
    assert (
        client.post(URL, json=body("insurance_renewal", **extra), headers=auth_headers).status_code
        == 400
    )


def test_limits_are_accepted(client: TestClient, auth_headers: dict[str, str]) -> None:
    ok = body(
        "insurance_renewal",
        insurer="x" * 200,
        premium_minor=100_000_000,
        insurer_phone="1" * 30,
        cover_type="third_party_fire_theft",
    )
    assert client.post(URL, json=ok, headers=auth_headers).status_code == 201
    tax = body("road_tax_renewal", amount_minor=0)
    assert client.post(URL, json=tax, headers=auth_headers).status_code == 201


def test_replay_and_conflict_include_the_new_fields(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body("insurance_renewal", **INSURANCE)
    assert client.post(URL, json=b, headers=auth_headers).status_code == 201
    assert client.post(URL, json=b, headers=auth_headers).status_code == 200
    changed = {**b, "premium_minor": 1}
    assert client.post(URL, json=changed, headers=auth_headers).status_code == 409


def test_patch_sets_and_clears_each_field(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = body("insurance_renewal", **INSURANCE)
    client.post(URL, json=b, headers=auth_headers)
    path = f"{URL}/{b['id']}"
    r = client.patch(path, json={"premium_minor": 500, "insurer": "Other"}, headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["premium_minor"] == 500
    assert r.json()["insurer"] == "Other"
    assert r.json()["cover_type"] == "comprehensive"
    for field in INSURANCE:
        cleared = client.patch(path, json={field: None}, headers=auth_headers)
        assert cleared.status_code == 200
        assert cleared.json()[field] is None


def test_patch_wrong_kind_field_is_400_and_leaves_the_row(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body("road_tax_renewal", amount_minor=9000)
    client.post(URL, json=b, headers=auth_headers)
    path = f"{URL}/{b['id']}"
    assert client.patch(path, json={"insurer": "X"}, headers=auth_headers).status_code == 400
    assert client.get(path, headers=auth_headers).json()["insurer"] is None


def test_patch_kind_away_with_old_fields_set_is_400(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body("insurance_renewal", **INSURANCE)
    client.post(URL, json=b, headers=auth_headers)
    path = f"{URL}/{b['id']}"
    assert (
        client.patch(path, json={"kind": "road_tax_renewal"}, headers=auth_headers).status_code
        == 400
    )
    both = {"kind": "road_tax_renewal", **dict.fromkeys(INSURANCE), "amount_minor": 7000}
    ok = client.patch(path, json=both, headers=auth_headers)
    assert ok.status_code == 200
    assert ok.json()["amount_minor"] == 7000
    assert ok.json()["insurer"] is None


def test_the_database_refuses_a_mismatch(client: TestClient) -> None:
    bad = [
        "INSERT INTO reminder (id, kind, title, due_date, amount_minor) "
        "VALUES (gen_random_uuid(), 'insurance_renewal', 't', DATE '2027-01-01', 5)",
        "INSERT INTO reminder (id, kind, title, due_odometer, insurer) "
        "VALUES (gen_random_uuid(), 'service', 't', 100, 'X')",
        "INSERT INTO reminder (id, kind, title, due_date, cover_type) "
        "VALUES (gen_random_uuid(), 'insurance_renewal', 't', DATE '2027-01-01', 'bad')",
        "INSERT INTO reminder (id, kind, title, due_date, premium_minor) "
        "VALUES (gen_random_uuid(), 'insurance_renewal', 't', DATE '2027-01-01', 100000001)",
    ]
    for stmt in bad:
        with pytest.raises(IntegrityError), client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
            conn.execute(text(stmt))
