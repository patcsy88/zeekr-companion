"""Expenses slice, backend: AC-30 to AC-37, AC-42, AC-45, AC-46 (FR-5). Disposable data only."""

from __future__ import annotations

import datetime as dt
import threading
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect, text

from app import schemas
from app.clock import today_kl
from app.models import EXPENSE_CATEGORIES
from tests.conftest import new_id, record_body

URL = "/api/v1/expenses"
SUMMARY = f"{URL}/summary"
CATEGORIES = [
    "charging",
    "insurance",
    "road_tax",
    "parking",
    "tolls",
    "tyres",
    "accessories",
    "cleaning",
    "fines",
    "warranty",
    "other",
]


def body(**overrides: Any) -> dict[str, Any]:
    b: dict[str, Any] = {
        "id": new_id(),
        "date": "2026-09-01",
        "category": "charging",
        "amount_minor": 12345,
        "currency": "MYR",
        "notes": "n",
    }
    b.update(overrides)
    return b


def post(client: TestClient, headers: dict[str, str], **overrides: Any) -> dict[str, Any]:
    b = body(**overrides)
    r = client.post(URL, json=b, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def fields(response: Any) -> list[str]:
    return [d["field"] for d in response.json()["error"]["details"]]


# --- AC-42 ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", URL),
        ("get", URL),
        ("get", SUMMARY),
        ("get", f"{URL}/{uuid.uuid4()}"),
        ("patch", f"{URL}/{uuid.uuid4()}"),
        ("delete", f"{URL}/{uuid.uuid4()}"),
    ],
)
@pytest.mark.parametrize("auth", [None, "Bearer wrong", "Basic abc"])
def test_ac42_every_route_needs_a_token(
    client: TestClient, method: str, path: str, auth: str | None
) -> None:
    headers = {"Authorization": auth} if auth else {}
    kwargs: dict[str, Any] = {"json": body()} if method in ("post", "patch") else {}
    r = client.request(method, path, headers=headers, **kwargs)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthenticated"


# --- AC-30 ----------------------------------------------------------------------------------


def test_ac30_create_and_get(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = body()
    created = client.post(URL, json=b, headers=auth_headers)
    assert created.status_code == 201
    got = client.get(f"{URL}/{b['id']}", headers=auth_headers).json()
    for k in ("id", "date", "category", "amount_minor", "currency", "notes"):
        assert got[k] == b[k]
    assert got["created_at"] and got["updated_at"]
    assert created.json() == got


def test_ac30_currency_and_notes_are_optional(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body()
    del b["currency"], b["notes"]
    r = client.post(URL, json=b, headers=auth_headers)
    assert r.status_code == 201
    assert r.json()["currency"] == "MYR"
    assert r.json()["notes"] is None


def test_ac30_replay_200_and_conflict_409(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = body()
    first = client.post(URL, json=b, headers=auth_headers)
    second = client.post(URL, json=b, headers=auth_headers)
    assert (first.status_code, second.status_code) == (201, 200)
    assert second.json() == first.json()
    assert len(client.get(URL, headers=auth_headers).json()["items"]) == 1
    for change in (
        {"date": "2026-09-02"},
        {"category": "parking"},
        {"amount_minor": 1},
        {"notes": "other"},
        {"notes": None},
    ):
        changed = client.post(URL, json={**b, **change}, headers=auth_headers)
        assert changed.status_code == 409, change
        assert changed.json()["error"]["code"] == "conflict"
    assert client.get(f"{URL}/{b['id']}", headers=auth_headers).json()["notes"] == "n"


def test_ac30_concurrent_same_id_creates_exactly_one_row(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body()
    codes: list[int] = []

    def go() -> None:
        codes.append(client.post(URL, json=b, headers=auth_headers).status_code)

    threads = [threading.Thread(target=go) for _ in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(codes).count(201) == 1
    assert set(codes) <= {200, 201}
    assert _count(client) == 1


# --- AC-31 ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"date": "2026-13-01"}, "date"),
        ({"date": "2026-02-30"}, "date"),
        ({"date": "yesterday"}, "date"),
        ({"date": "20260901"}, "date"),
        ({"date": 20260901}, "date"),
        ({"date": None}, "date"),
        ({"date": "1999-12-31"}, "date"),
        ({"date": "2999-01-01"}, "date"),
        ({"category": "fuel"}, "category"),
        ({"category": "Charging"}, "category"),
        ({"category": None}, "category"),
        ({"amount_minor": 0}, "amount_minor"),
        ({"amount_minor": -1}, "amount_minor"),
        ({"amount_minor": 10**12 + 1}, "amount_minor"),
        ({"amount_minor": 1.5}, "amount_minor"),
        ({"amount_minor": 100.0}, "amount_minor"),
        ({"amount_minor": "100"}, "amount_minor"),
        ({"amount_minor": True}, "amount_minor"),
        ({"amount_minor": None}, "amount_minor"),
        ({"currency": "USD"}, "currency"),
        ({"currency": "myr"}, "currency"),
        ({"notes": "x" * 5001}, "notes"),
        ({"notes": "a\x00b"}, "notes"),
        ({"surprise": 1}, "surprise"),
        ({"vehicle_id": new_id()}, "vehicle_id"),
        ({"service_record_id": new_id()}, "service_record_id"),
        ({"id": "not-a-uuid"}, "id"),
    ],
)
def test_ac31_validation(
    client: TestClient, auth_headers: dict[str, str], overrides: dict[str, Any], field: str
) -> None:
    r = client.post(URL, json=body(**overrides), headers=auth_headers)
    assert r.status_code == 400, r.text
    err = r.json()["error"]
    assert err["code"] == "validation_error"
    assert field in fields(r)
    assert client.get(URL, headers=auth_headers).json()["items"] == []


@pytest.mark.parametrize("field", ["id", "date", "category", "amount_minor"])
def test_ac31_missing_required(
    client: TestClient, auth_headers: dict[str, str], field: str
) -> None:
    b = body()
    del b[field]
    r = client.post(URL, json=b, headers=auth_headers)
    assert r.status_code == 400
    assert field in fields(r)


@pytest.mark.parametrize("amount", [1, 10**12])
def test_ac31_amount_bounds_accepted(
    client: TestClient, auth_headers: dict[str, str], amount: int
) -> None:
    assert client.post(URL, json=body(amount_minor=amount), headers=auth_headers).status_code == 201


def test_ac31_date_bounds_today_and_2000_accepted(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    for d in ("2000-01-01", today_kl().isoformat()):
        assert client.post(URL, json=body(date=d), headers=auth_headers).status_code == 201


def test_ac31_notes_5000_accepted_and_trimmed(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    r = client.post(URL, json=body(notes="  " + "x" * 5000 + "  "), headers=auth_headers)
    assert r.status_code == 201
    assert r.json()["notes"] == "x" * 5000


def test_ac31_future_date_uses_kuala_lumpur_not_utc(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    # 2026-10-11 20:00 UTC is 2026-10-12 04:00 in Kuala Lumpur.
    fixed = dt.datetime(2026, 10, 11, 20, 0, tzinfo=dt.UTC)
    monkeypatch.setattr(schemas, "today_kl", lambda: today_kl(fixed))
    assert client.post(URL, json=body(date="2026-10-12"), headers=auth_headers).status_code == 201
    r = client.post(URL, json=body(date="2026-10-13"), headers=auth_headers)
    assert r.status_code == 400
    assert "date" in fields(r)


# --- AC-32 ----------------------------------------------------------------------------------


def test_ac32_patch_partial_null_notes_and_404(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body()
    client.post(URL, json=b, headers=auth_headers)
    r = client.patch(
        f"{URL}/{b['id']}",
        json={"amount_minor": 500, "notes": None, "category": "tolls"},
        headers=auth_headers,
    )
    assert r.status_code == 200
    out = r.json()
    assert (out["amount_minor"], out["notes"], out["category"]) == (500, None, "tolls")
    assert out["date"] == b["date"]
    assert (
        out["created_at"]
        == client.get(f"{URL}/{b['id']}", headers=auth_headers).json()["created_at"]
    )
    assert out["updated_at"] >= out["created_at"]
    assert (
        client.patch(f"{URL}/{new_id()}", json={"notes": "x"}, headers=auth_headers).status_code
        == 404
    )
    empty = client.patch(f"{URL}/{b['id']}", json={}, headers=auth_headers)
    assert empty.status_code == 200
    assert empty.json()["amount_minor"] == 500


def test_ac32_patch_unknown_id_with_empty_body_is_404(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    assert client.patch(f"{URL}/{new_id()}", json={}, headers=auth_headers).status_code == 404


@pytest.mark.parametrize(
    ("patch", "field"),
    [
        ({"date": None}, "date"),
        ({"category": None}, "category"),
        ({"amount_minor": None}, "amount_minor"),
        ({"currency": None}, "currency"),
        ({"date": "2999-01-01"}, "date"),
        ({"date": "1999-12-31"}, "date"),
        ({"date": "2026-02-30"}, "date"),
        ({"date": 20260101}, "date"),
        ({"category": "fuel"}, "category"),
        ({"amount_minor": 0}, "amount_minor"),
        ({"amount_minor": -5}, "amount_minor"),
        ({"amount_minor": 10**12 + 1}, "amount_minor"),
        ({"amount_minor": "1"}, "amount_minor"),
        ({"amount_minor": 1.5}, "amount_minor"),
        ({"currency": "SGD"}, "currency"),
        ({"notes": "x" * 5001}, "notes"),
        ({"notes": "a\x00"}, "notes"),
        ({"id": new_id()}, "id"),
        ({"created_at": "2026-01-01T00:00:00Z"}, "created_at"),
        ({"surprise": 1}, "surprise"),
    ],
)
def test_ac32_patch_validation_leaves_row_unchanged(
    client: TestClient, auth_headers: dict[str, str], patch: dict[str, Any], field: str
) -> None:
    b = body()
    client.post(URL, json=b, headers=auth_headers)
    before = client.get(f"{URL}/{b['id']}", headers=auth_headers).json()
    r = client.patch(f"{URL}/{b['id']}", json=patch, headers=auth_headers)
    assert r.status_code == 400, r.text
    assert field in fields(r)
    assert client.get(f"{URL}/{b['id']}", headers=auth_headers).json() == before


# --- AC-33 ----------------------------------------------------------------------------------


def test_ac33_delete(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = body()
    client.post(URL, json=b, headers=auth_headers)
    assert client.delete(f"{URL}/{b['id']}", headers=auth_headers).status_code == 204
    assert client.get(f"{URL}/{b['id']}", headers=auth_headers).status_code == 404
    again = client.delete(f"{URL}/{b['id']}", headers=auth_headers)
    assert again.status_code == 404
    assert again.json()["error"]["code"] == "not_found"


def test_bad_uuid_in_path_is_400(client: TestClient, auth_headers: dict[str, str]) -> None:
    for method in ("get", "patch", "delete"):
        kwargs: dict[str, Any] = {"json": {}} if method == "patch" else {}
        r = client.request(method, f"{URL}/nope", headers=auth_headers, **kwargs)
        assert r.status_code == 400
        assert r.json()["error"]["code"] == "validation_error"


# --- AC-34 ----------------------------------------------------------------------------------


def test_ac34_category_enum_matches_contract() -> None:
    assert list(EXPENSE_CATEGORIES) == CATEGORIES


@pytest.mark.parametrize("category", CATEGORIES)
def test_ac34_every_category_is_accepted_and_filterable(
    client: TestClient, auth_headers: dict[str, str], category: str
) -> None:
    e = post(client, auth_headers, category=category)
    assert e["category"] == category
    listed = client.get(URL, params={"category": category}, headers=auth_headers).json()["items"]
    assert [i["id"] for i in listed] == [e["id"]]
    patched = client.patch(
        f"{URL}/{e['id']}", json={"category": "other"}, headers=auth_headers
    ).json()
    assert patched["category"] == "other"


def test_ac34_database_rejects_unknown_category(client: TestClient) -> None:
    from sqlalchemy.exc import IntegrityError

    with pytest.raises(IntegrityError), client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(
            text(
                "INSERT INTO expense (id, date, category, amount_minor) "
                "VALUES (gen_random_uuid(), DATE '2026-01-01', 'fuel', 100)"
            )
        )


# --- AC-35 ----------------------------------------------------------------------------------


def _ids(response: Any) -> list[str]:
    return [i["id"] for i in response.json()["items"]]


def test_ac35_order_newest_first_with_ties(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    old = post(client, auth_headers, date="2026-01-01")
    mid_a = post(client, auth_headers, date="2026-05-01")
    mid_b = post(client, auth_headers, date="2026-05-01")
    new = post(client, auth_headers, date="2026-08-01")
    r = client.get(URL, headers=auth_headers)
    assert r.status_code == 200
    assert _ids(r) == [new["id"], mid_b["id"], mid_a["id"], old["id"]]
    assert r.json()["next_cursor"] is None


def test_ac35_empty_list(client: TestClient, auth_headers: dict[str, str]) -> None:
    assert client.get(URL, headers=auth_headers).json() == {"items": [], "next_cursor": None}


def test_ac35_cursor_paging_visits_every_row_once(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    created = [
        post(client, auth_headers, date=f"2026-0{1 + i % 3}-1{i % 5}")["id"] for i in range(11)
    ]
    seen: list[str] = []
    cursor: str | None = None
    pages = 0
    while True:
        params: dict[str, Any] = {"limit": 4}
        if cursor:
            params["cursor"] = cursor
        page = client.get(URL, params=params, headers=auth_headers).json()
        assert len(page["items"]) <= 4
        seen += [i["id"] for i in page["items"]]
        pages += 1
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert pages == 3
    assert sorted(seen) == sorted(created)
    assert len(set(seen)) == 11
    full = _ids(client.get(URL, headers=auth_headers))
    assert seen == full


def test_ac35_exact_page_has_no_next_cursor(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    for _ in range(3):
        post(client, auth_headers)
    page = client.get(URL, params={"limit": 3}, headers=auth_headers).json()
    assert len(page["items"]) == 3
    assert page["next_cursor"] is None


@pytest.mark.parametrize("limit", ["0", "101", "-1", "abc", "1.5"])
def test_ac35_invalid_limit(client: TestClient, auth_headers: dict[str, str], limit: str) -> None:
    r = client.get(URL, params={"limit": limit}, headers=auth_headers)
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "validation_error"


def test_ac35_limit_bounds_accepted(client: TestClient, auth_headers: dict[str, str]) -> None:
    for limit in ("1", "100"):
        assert client.get(URL, params={"limit": limit}, headers=auth_headers).status_code == 200


@pytest.mark.parametrize(
    "cursor", ["garbage", "!!!!", "e30", "eyJkIjoiMjAyNi0wMS0wMSJ9", "a" * 600]
)
def test_ac35_invalid_cursor(client: TestClient, auth_headers: dict[str, str], cursor: str) -> None:
    r = client.get(URL, params={"cursor": cursor}, headers=auth_headers)
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "validation_error"
    assert "cursor" in fields(r)


# --- AC-36 ----------------------------------------------------------------------------------


@pytest.fixture
def mixed(client: TestClient, auth_headers: dict[str, str]) -> dict[str, str]:
    rows = {
        "c_jan": ("2026-01-31", "charging", 1000),
        "c_feb": ("2026-02-01", "charging", 2000),
        "p_feb": ("2026-02-15", "parking", 300),
        "t_feb": ("2026-02-28", "tyres", 40000),
        "c_mar": ("2026-03-10", "charging", 500),
    }
    return {
        k: post(client, auth_headers, date=d, category=c, amount_minor=a)["id"]
        for k, (d, c, a) in rows.items()
    }


def test_ac36_filter_category(
    client: TestClient, auth_headers: dict[str, str], mixed: dict[str, str]
) -> None:
    r = client.get(URL, params={"category": "charging"}, headers=auth_headers)
    assert _ids(r) == [mixed["c_mar"], mixed["c_feb"], mixed["c_jan"]]


def test_ac36_filter_dates_are_inclusive_and_either_or_both(
    client: TestClient, auth_headers: dict[str, str], mixed: dict[str, str]
) -> None:
    def ids(**params: str) -> list[str]:
        return _ids(client.get(URL, params=params, headers=auth_headers))

    assert ids(**{"from": "2026-02-01"}) == [
        mixed["c_mar"],
        mixed["t_feb"],
        mixed["p_feb"],
        mixed["c_feb"],
    ]
    assert ids(to="2026-02-01") == [mixed["c_feb"], mixed["c_jan"]]
    assert ids(**{"from": "2026-02-01", "to": "2026-02-28"}) == [
        mixed["t_feb"],
        mixed["p_feb"],
        mixed["c_feb"],
    ]
    assert ids(**{"from": "2026-02-15", "to": "2026-02-15"}) == [mixed["p_feb"]]
    assert ids(**{"from": "2030-01-01"}) == []


def test_ac36_filters_combine_with_and_and_with_cursor(
    client: TestClient, auth_headers: dict[str, str], mixed: dict[str, str]
) -> None:
    params: dict[str, Any] = {"category": "charging", "from": "2026-02-01", "limit": 1}
    first = client.get(URL, params=params, headers=auth_headers).json()
    assert [i["id"] for i in first["items"]] == [mixed["c_mar"]]
    assert first["next_cursor"]
    second = client.get(
        URL, params={**params, "cursor": first["next_cursor"]}, headers=auth_headers
    ).json()
    assert [i["id"] for i in second["items"]] == [mixed["c_feb"]]
    assert second["next_cursor"] is None


@pytest.mark.parametrize(
    "params",
    [
        {"category": "fuel"},
        {"category": "Charging"},
        {"from": "2026-13-01"},
        {"to": "not-a-date"},
        {"from": "20260101"},
        {"to": "2026-02-30"},
        {"from": "2026-03-01", "to": "2026-02-28"},
    ],
)
@pytest.mark.parametrize("path", [URL, SUMMARY])
def test_ac36_invalid_filters(
    client: TestClient, auth_headers: dict[str, str], path: str, params: dict[str, str]
) -> None:
    r = client.get(path, params=params, headers=auth_headers)
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "validation_error"


def test_ac36_from_later_than_to_names_the_field(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    r = client.get(URL, params={"from": "2026-03-01", "to": "2026-02-28"}, headers=auth_headers)
    assert fields(r) == ["from"]


# --- AC-37 ----------------------------------------------------------------------------------


def _all_rows(client: TestClient, headers: dict[str, str], **params: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    cursor = None
    while True:
        p = {**params, "limit": 100, **({"cursor": cursor} if cursor else {})}
        page = client.get(URL, params=p, headers=headers).json()
        rows += page["items"]
        cursor = page["next_cursor"]
        if not cursor:
            return rows


def _expected_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    by_cat: dict[str, list[int]] = {}
    by_month: dict[str, list[int]] = {}
    for r in rows:
        for table, key in ((by_cat, r["category"]), (by_month, r["date"][:7])):
            t = table.setdefault(key, [0, 0])
            t[0] += r["amount_minor"]
            t[1] += 1
    return {
        "currency": "MYR",
        "total_minor": sum(r["amount_minor"] for r in rows),
        "count": len(rows),
        "by_category": [
            {"category": k, "total_minor": v[0], "count": v[1]}
            for k, v in sorted(by_cat.items(), key=lambda kv: (-kv[1][0], kv[0]))
        ],
        "by_month": [
            {"month": k, "total_minor": v[0], "count": v[1]}
            for k, v in sorted(by_month.items(), reverse=True)
        ],
    }


def test_ac37_empty_selection_is_zeros(client: TestClient, auth_headers: dict[str, str]) -> None:
    r = client.get(SUMMARY, headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == {
        "currency": "MYR",
        "total_minor": 0,
        "count": 0,
        "by_category": [],
        "by_month": [],
    }


def test_ac37_summary_values_and_order(
    client: TestClient, auth_headers: dict[str, str], mixed: dict[str, str]
) -> None:
    r = client.get(SUMMARY, headers=auth_headers).json()
    assert r == {
        "currency": "MYR",
        "total_minor": 43800,
        "count": 5,
        "by_category": [
            {"category": "tyres", "total_minor": 40000, "count": 1},
            {"category": "charging", "total_minor": 3500, "count": 3},
            {"category": "parking", "total_minor": 300, "count": 1},
        ],
        "by_month": [
            {"month": "2026-03", "total_minor": 500, "count": 1},
            {"month": "2026-02", "total_minor": 42300, "count": 3},
            {"month": "2026-01", "total_minor": 1000, "count": 1},
        ],
    }


def test_ac37_category_ties_are_ordered_by_category(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    post(client, auth_headers, category="tolls", amount_minor=100)
    post(client, auth_headers, category="fines", amount_minor=100)
    cats = [c["category"] for c in client.get(SUMMARY, headers=auth_headers).json()["by_category"]]
    assert cats == ["fines", "tolls"]


def test_ac37_month_boundaries_have_no_timezone_shift(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    for d in ("2025-12-31", "2026-01-01", "2026-01-31", "2026-02-01"):
        post(client, auth_headers, date=d, amount_minor=10)
    months = client.get(SUMMARY, headers=auth_headers).json()["by_month"]
    assert [(m["month"], m["count"]) for m in months] == [
        ("2026-02", 1),
        ("2026-01", 2),
        ("2025-12", 1),
    ]


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"category": "charging"},
        {"from": "2026-02-01"},
        {"to": "2026-02-15"},
        {"from": "2026-02-01", "to": "2026-02-28"},
        {"category": "charging", "from": "2026-02-01", "to": "2026-03-31"},
        {"category": "warranty"},
    ],
)
def test_ac37_summary_equals_sum_of_list_rows(
    client: TestClient,
    auth_headers: dict[str, str],
    mixed: dict[str, str],
    params: dict[str, str],
) -> None:
    rows = _all_rows(client, auth_headers, **params)
    assert client.get(SUMMARY, params=params, headers=auth_headers).json() == _expected_summary(
        rows
    )


def test_ac37_integer_sums_near_the_bound(client: TestClient, auth_headers: dict[str, str]) -> None:
    for _ in range(3):
        post(client, auth_headers, amount_minor=10**12)
    r = client.get(SUMMARY, headers=auth_headers).json()
    assert r["total_minor"] == 3 * 10**12
    assert isinstance(r["total_minor"], int)
    assert r["by_category"][0]["total_minor"] == 3 * 10**12


def test_ac37_summary_is_computed_on_read_after_changes(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    e = post(client, auth_headers, amount_minor=100)
    assert client.get(SUMMARY, headers=auth_headers).json()["total_minor"] == 100
    client.patch(f"{URL}/{e['id']}", json={"amount_minor": 250}, headers=auth_headers)
    assert client.get(SUMMARY, headers=auth_headers).json()["total_minor"] == 250
    client.delete(f"{URL}/{e['id']}", headers=auth_headers)
    assert client.get(SUMMARY, headers=auth_headers).json()["total_minor"] == 0


def test_ac37_nothing_is_stored(client: TestClient) -> None:
    columns = {c["name"] for c in inspect(client.app.state.engine).get_columns("expense")}  # type: ignore[attr-defined]
    assert columns == {
        "id",
        "date",
        "category",
        "amount_minor",
        "currency",
        "notes",
        "created_at",
        "updated_at",
    }
    tables = set(inspect(client.app.state.engine).get_table_names())  # type: ignore[attr-defined]
    assert not {t for t in tables if "summary" in t or "total" in t}


def test_summary_route_is_not_parsed_as_an_id(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    assert client.get(SUMMARY, headers=auth_headers).status_code == 200
    assert client.delete(SUMMARY, headers=auth_headers).status_code in (400, 405)


# --- AC-45 ----------------------------------------------------------------------------------


def _bulk_insert(client: TestClient, n: int) -> None:
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(
            text(
                "INSERT INTO expense (id, date, category, amount_minor) "
                "SELECT gen_random_uuid(), DATE '2026-01-01', 'other', 1 "
                "FROM generate_series(1, :n)"
            ),
            {"n": n},
        )


def _count(client: TestClient) -> int:
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        return int(conn.execute(text("SELECT count(*) FROM expense")).scalar_one())


def test_ac45_cap_5000_exact_and_replay_at_cap(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    _bulk_insert(client, 4999)
    last = body()
    assert client.post(URL, json=last, headers=auth_headers).status_code == 201
    assert _count(client) == 5000
    rejected = client.post(URL, json=body(), headers=auth_headers)
    assert rejected.status_code == 400
    assert rejected.json()["error"]["code"] == "validation_error"
    assert fields(rejected) == ["body"]
    assert _count(client) == 5000
    replay = client.post(URL, json=last, headers=auth_headers)
    assert replay.status_code == 200
    conflict = client.post(URL, json={**last, "amount_minor": 1}, headers=auth_headers)
    assert conflict.status_code == 409
    assert _count(client) == 5000
    assert client.get(URL, headers=auth_headers).status_code == 200
    assert client.get(SUMMARY, headers=auth_headers).json()["count"] == 5000


def test_ac45_delete_frees_a_slot(client: TestClient, auth_headers: dict[str, str]) -> None:
    _bulk_insert(client, 4999)
    first = post(client, auth_headers)
    assert client.post(URL, json=body(), headers=auth_headers).status_code == 400
    client.delete(f"{URL}/{first['id']}", headers=auth_headers)
    assert client.post(URL, json=body(), headers=auth_headers).status_code == 201


def test_ac45_cap_is_not_exceeded_by_concurrent_creates(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    _bulk_insert(client, 4990)
    codes: list[int] = []

    def go() -> None:
        codes.append(client.post(URL, json=body(), headers=auth_headers).status_code)

    threads = [threading.Thread(target=go) for _ in range(40)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert all(c in (201, 400) for c in codes), codes
    assert codes.count(201) == 10
    assert _count(client) == 5000


# --- AC-46 ----------------------------------------------------------------------------------


def test_ac46_expenses_and_service_records_are_independent(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    sr = record_body(cost_minor=99999)
    assert client.post("/api/v1/service-records", json=sr, headers=auth_headers).status_code == 201
    sr_before = client.get(f"/api/v1/service-records/{sr['id']}", headers=auth_headers).json()
    assert client.get(SUMMARY, headers=auth_headers).json()["total_minor"] == 0

    e = post(client, auth_headers, amount_minor=100)
    client.patch(f"{URL}/{e['id']}", json={"amount_minor": 200}, headers=auth_headers)
    client.delete(f"{URL}/{e['id']}", headers=auth_headers)
    post(client, auth_headers, amount_minor=300)

    assert client.get(f"/api/v1/service-records/{sr['id']}", headers=auth_headers).json() == (
        sr_before
    )
    assert len(client.get("/api/v1/service-records", headers=auth_headers).json()["items"]) == 1
    summary = client.get(SUMMARY, headers=auth_headers).json()
    assert (summary["total_minor"], summary["count"]) == (300, 1)

    client.delete(f"/api/v1/service-records/{sr['id']}", headers=auth_headers)
    assert client.get(SUMMARY, headers=auth_headers).json()["total_minor"] == 300


def test_ac46_no_foreign_key_or_link_column(client: TestClient) -> None:
    insp = inspect(client.app.state.engine)  # type: ignore[attr-defined]
    assert insp.get_foreign_keys("expense") == []
    assert insp.get_foreign_keys("service_record") == []


# --- misc -----------------------------------------------------------------------------------


def test_responses_are_no_store(client: TestClient, auth_headers: dict[str, str]) -> None:
    e = post(client, auth_headers)
    for path in (URL, SUMMARY, f"{URL}/{e['id']}", f"{URL}/{new_id()}"):
        assert client.get(path, headers=auth_headers).headers["cache-control"] == "no-store"


def test_notes_are_stored_literally(client: TestClient, auth_headers: dict[str, str]) -> None:
    notes = "<img src=x onerror=alert(1)> '; DROP TABLE expense; --"
    e = post(client, auth_headers, notes=notes)
    assert client.get(f"{URL}/{e['id']}", headers=auth_headers).json()["notes"] == notes
    assert client.get(SUMMARY, headers=auth_headers).json()["count"] == 1
