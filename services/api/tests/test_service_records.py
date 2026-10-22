"""AC-5 / FR-2, FR-3, FR-4: service records."""

from __future__ import annotations

import datetime as dt

import pytest
from fastapi.testclient import TestClient

from app import schemas
from app.clock import today_kl
from tests.conftest import new_id, record_body

URL = "/api/v1/service-records"


def test_create_get_roundtrip(client: TestClient, auth_headers: dict[str, str]) -> None:
    body = record_body()
    created = client.post(URL, json=body, headers=auth_headers)
    assert created.status_code == 201
    out = created.json()
    for key, value in body.items():
        assert out[key] == value
    assert out["created_at"].endswith(("Z", "+00:00"))
    assert out["updated_at"].endswith(("Z", "+00:00"))
    got = client.get(f"{URL}/{body['id']}", headers=auth_headers)
    assert got.status_code == 200
    assert got.json() == out


def test_currency_defaults_to_myr(client: TestClient, auth_headers: dict[str, str]) -> None:
    body = record_body()
    del body["currency"]
    response = client.post(URL, json=body, headers=auth_headers)
    assert response.status_code == 201
    assert response.json()["currency"] == "MYR"


@pytest.mark.parametrize(
    ("override", "field"),
    [
        ({"cost_minor": -1}, "cost_minor"),
        ({"odometer": -5}, "odometer"),
        ({"description": ""}, "description"),
        ({"description": "x" * 501}, "description"),
        ({"date": "2999-01-01"}, "date"),
        ({"date": "not-a-date"}, "date"),
        ({"currency": "GBP"}, "currency"),
        ({"cost_minor": 1.5}, "cost_minor"),
        ({"cost_minor": "100"}, "cost_minor"),
        ({"id": "not-a-uuid"}, "id"),
    ],
)
def test_ac5_invalid_values_rejected(
    client: TestClient, auth_headers: dict[str, str], override: dict[str, object], field: str
) -> None:
    response = client.post(URL, json=record_body(**override), headers=auth_headers)
    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert field in [d["field"] for d in error["details"]]


def test_ac5_negative_cost_has_contract_detail(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.post(URL, json=record_body(cost_minor=-1), headers=auth_headers)
    detail = response.json()["error"]["details"][0]
    assert detail["field"] == "cost_minor"
    assert detail["issue"]


@pytest.mark.parametrize("missing", ["date", "odometer", "description", "cost_minor", "id"])
def test_ac5_missing_required_field_rejected(
    client: TestClient, auth_headers: dict[str, str], missing: str
) -> None:
    body = record_body()
    del body[missing]
    response = client.post(URL, json=body, headers=auth_headers)
    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert missing in [d["field"] for d in error["details"]]


def test_today_is_accepted(client: TestClient, auth_headers: dict[str, str]) -> None:
    today = today_kl().isoformat()
    assert client.post(URL, json=record_body(date=today), headers=auth_headers).status_code == 201


def test_today_kl_is_ahead_of_utc_between_1600_and_2400_utc() -> None:
    # 2026-10-11 19:00 UTC is 2026-10-12 03:00 in Kuala Lumpur (UTC+8, no DST).
    instant = dt.datetime(2026, 10, 11, 19, 0, tzinfo=dt.UTC)
    assert today_kl(instant) == dt.date(2026, 10, 12)
    assert today_kl(dt.datetime(2026, 10, 11, 15, 59, tzinfo=dt.UTC)) == dt.date(2026, 10, 11)
    assert today_kl(dt.datetime(2026, 10, 11, 16, 0, tzinfo=dt.UTC)) == dt.date(2026, 10, 12)


def test_kl_date_rule_accepts_local_today_that_is_utc_tomorrow(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Owner decision 2026-10-22: at 03:00 MYT the local date is accepted, the next day is not."""
    fixed = dt.datetime(2026, 10, 11, 19, 0, tzinfo=dt.UTC)
    monkeypatch.setattr(schemas, "today_kl", lambda: today_kl(fixed))
    ok = client.post(URL, json=record_body(date="2026-10-12"), headers=auth_headers)
    assert ok.status_code == 201
    late = client.post(URL, json=record_body(date="2026-10-13"), headers=auth_headers)
    assert late.status_code == 400
    assert late.json()["error"]["details"][0]["issue"] == "must not be in the future"


def test_idempotent_same_id_same_content(client: TestClient, auth_headers: dict[str, str]) -> None:
    body = record_body()
    first = client.post(URL, json=body, headers=auth_headers)
    second = client.post(URL, json=body, headers=auth_headers)
    assert first.status_code == 201
    assert second.status_code == 200
    assert second.json() == first.json()
    assert len(client.get(URL, headers=auth_headers).json()["items"]) == 1


def test_same_id_different_content_is_409(client: TestClient, auth_headers: dict[str, str]) -> None:
    body = record_body()
    client.post(URL, json=body, headers=auth_headers)
    response = client.post(URL, json={**body, "cost_minor": 1}, headers=auth_headers)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"
    stored = client.get(f"{URL}/{body['id']}", headers=auth_headers).json()
    assert stored["cost_minor"] == body["cost_minor"]


def test_get_unknown_is_404(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.get(f"{URL}/{new_id()}", headers=auth_headers)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_bad_uuid_in_path_is_400(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.get(f"{URL}/abc", headers=auth_headers)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"


def test_patch_partial_update(client: TestClient, auth_headers: dict[str, str]) -> None:
    body = record_body()
    created = client.post(URL, json=body, headers=auth_headers).json()
    response = client.patch(
        f"{URL}/{body['id']}",
        json={"cost_minor": 30000, "notes": None},
        headers=auth_headers,
    )
    assert response.status_code == 200
    out = response.json()
    assert out["cost_minor"] == 30000
    assert out["notes"] is None
    assert out["description"] == body["description"]
    assert out["odometer"] == body["odometer"]
    assert out["created_at"] == created["created_at"]
    assert out["updated_at"] > created["updated_at"]
    assert client.get(f"{URL}/{body['id']}", headers=auth_headers).json() == out


def test_patch_empty_body_is_noop(client: TestClient, auth_headers: dict[str, str]) -> None:
    body = record_body()
    created = client.post(URL, json=body, headers=auth_headers).json()
    response = client.patch(f"{URL}/{body['id']}", json={}, headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == created


@pytest.mark.parametrize(
    "patch",
    [
        {"cost_minor": -1},
        {"description": ""},
        {"date": "2999-01-01"},
        {"date": None},
        {"cost_minor": None},
        {"id": new_id()},
        {"unknown": 1},
    ],
)
def test_patch_validation(
    client: TestClient, auth_headers: dict[str, str], patch: dict[str, object]
) -> None:
    body = record_body()
    client.post(URL, json=body, headers=auth_headers)
    response = client.patch(f"{URL}/{body['id']}", json=patch, headers=auth_headers)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"


def test_patch_unknown_is_404(client: TestClient, auth_headers: dict[str, str]) -> None:
    response = client.patch(f"{URL}/{new_id()}", json={"cost_minor": 1}, headers=auth_headers)
    assert response.status_code == 404


def test_delete(client: TestClient, auth_headers: dict[str, str]) -> None:
    body = record_body()
    client.post(URL, json=body, headers=auth_headers)
    deleted = client.delete(f"{URL}/{body['id']}", headers=auth_headers)
    assert deleted.status_code == 204
    assert deleted.content == b""
    assert client.get(f"{URL}/{body['id']}", headers=auth_headers).status_code == 404
    assert client.delete(f"{URL}/{body['id']}", headers=auth_headers).status_code == 404


def _create_many(client: TestClient, headers: dict[str, str]) -> list[str]:
    """Create 7 records. Returns ids in expected newest-first order."""
    specs = [
        ("2026-01-10", "a"),
        ("2026-03-05", "b"),
        ("2026-03-05", "c"),  # same date as b, created later, so newer
        ("2026-05-20", "d"),
        ("2026-02-14", "e"),
        ("2026-06-01", "f"),
        ("2026-06-01", "g"),
    ]
    created: list[tuple[str, str, str]] = []
    for day, label in specs:
        rid = new_id()
        response = client.post(
            URL, json=record_body(id=rid, date=day, description=label), headers=headers
        )
        assert response.status_code == 201
        created.append((day, response.json()["created_at"], rid))
    created.sort(reverse=True)
    return [rid for _, _, rid in created]


def test_list_newest_first_and_empty(client: TestClient, auth_headers: dict[str, str]) -> None:
    assert client.get(URL, headers=auth_headers).json() == {"items": [], "next_cursor": None}
    expected = _create_many(client, auth_headers)
    page = client.get(URL, headers=auth_headers).json()
    assert [i["id"] for i in page["items"]] == expected
    assert page["next_cursor"] is None
    dates = [i["date"] for i in page["items"]]
    assert dates == sorted(dates, reverse=True)


def test_cursor_pagination_walks_all_pages(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    expected = _create_many(client, auth_headers)
    seen: list[str] = []
    cursor: str | None = None
    pages = 0
    while True:
        params: dict[str, str | int] = {"limit": 3}
        if cursor:
            params["cursor"] = cursor
        page = client.get(URL, params=params, headers=auth_headers).json()
        pages += 1
        assert len(page["items"]) <= 3
        seen.extend(i["id"] for i in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert pages == 3
    assert seen == expected


def test_cursor_exact_boundary_has_no_extra_page(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    _create_many(client, auth_headers)
    page = client.get(URL, params={"limit": 7}, headers=auth_headers).json()
    assert len(page["items"]) == 7
    assert page["next_cursor"] is None


def test_cursor_stable_when_record_deleted_mid_walk(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    expected = _create_many(client, auth_headers)
    first = client.get(URL, params={"limit": 3}, headers=auth_headers).json()
    client.delete(f"{URL}/{first['items'][-1]['id']}", headers=auth_headers)
    second = client.get(
        URL, params={"limit": 10, "cursor": first["next_cursor"]}, headers=auth_headers
    ).json()
    assert [i["id"] for i in second["items"]] == expected[3:]


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 101}, {"limit": "x"}])
def test_bad_limit_is_400(
    client: TestClient, auth_headers: dict[str, str], params: dict[str, object]
) -> None:
    response = client.get(URL, params=params, headers=auth_headers)  # type: ignore[arg-type]
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"


@pytest.mark.parametrize("cursor", ["garbage", "e30", "!!!"])
def test_bad_cursor_is_400(client: TestClient, auth_headers: dict[str, str], cursor: str) -> None:
    response = client.get(URL, params={"cursor": cursor}, headers=auth_headers)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"
