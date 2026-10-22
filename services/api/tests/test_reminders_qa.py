"""Independent QA probes for the Reminders slice (FR-7, FR-8, FR-12; AC-10 to AC-29).

Written by QA, separate from the Engineering Lead's tests/test_reminders.py. Disposable data only.
"""

from __future__ import annotations

import datetime as dt
import threading
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app import schemas
from app.clock import today_kl
from app.services import reminders as svc
from tests.conftest import new_id, record_body

URL = "/api/v1/reminders"
SR = "/api/v1/service-records"
TPL = "/api/v1/reminder-templates"


def body(**overrides: Any) -> dict[str, Any]:
    b: dict[str, Any] = {
        "id": new_id(),
        "kind": "service",
        "title": "Service",
        "due_date": "2027-01-15",
        "due_odometer": 20000,
        "notes": None,
        "template_ref": None,
    }
    b.update(overrides)
    return b


def freeze(monkeypatch: pytest.MonkeyPatch, instant: dt.datetime) -> None:
    monkeypatch.setattr(schemas, "today_kl", lambda: today_kl(instant))
    monkeypatch.setattr(svc, "today_kl", lambda: today_kl(instant))


def utc(*a: int) -> dt.datetime:
    return dt.datetime(*a, tzinfo=dt.UTC)


# --- midnight boundary at UTC+8 -------------------------------------------------------------


def test_clock_boundary() -> None:
    assert today_kl(utc(2026, 10, 21, 15, 59, 59)) == dt.date(2026, 10, 21)
    assert today_kl(utc(2026, 10, 21, 16, 0, 0)) == dt.date(2026, 10, 22)
    assert today_kl(utc(2026, 12, 31, 16, 0, 0)) == dt.date(2027, 1, 1)
    assert today_kl(utc(2028, 2, 28, 16, 0, 0)) == dt.date(2028, 2, 29)


@pytest.mark.parametrize(
    ("instant", "ok_date", "bad_date"),
    [
        (utc(2026, 10, 21, 15, 59, 59), "2026-10-21", "2026-10-22"),
        (utc(2026, 10, 21, 16, 0, 0), "2026-10-22", "2026-10-23"),
        (utc(2026, 10, 21, 0, 0, 0), "2026-10-21", "2026-10-22"),
    ],
)
def test_service_record_date_midnight_kl(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    instant: dt.datetime,
    ok_date: str,
    bad_date: str,
) -> None:
    freeze(monkeypatch, instant)
    assert client.post(SR, json=record_body(date=ok_date), headers=auth_headers).status_code == 201
    r = client.post(SR, json=record_body(date=bad_date), headers=auth_headers)
    assert r.status_code == 400
    assert r.json()["error"]["details"][0]["field"] == "date"


@pytest.mark.parametrize(
    ("instant", "expected"),
    [
        (utc(2026, 10, 21, 15, 59, 59), "upcoming"),  # 23:59:59 MYT, due today
        (utc(2026, 10, 21, 16, 0, 0), "overdue"),  # 00:00:00 MYT next day
    ],
)
def test_reminder_default_today_midnight(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    instant: dt.datetime,
    expected: str,
) -> None:
    freeze(monkeypatch, instant)
    b = body(due_date="2026-10-21", due_odometer=None)
    created = client.post(URL, json=b, headers=auth_headers)
    assert created.json()["status"] == expected
    assert client.get(f"{URL}/{b['id']}", headers=auth_headers).json()["status"] == expected
    items = client.get(URL, headers=auth_headers).json()["items"]
    assert items[0]["status"] == expected


@pytest.mark.parametrize(
    ("instant", "ok", "bad"),
    [
        (utc(2026, 10, 21, 15, 59, 59), "2026-10-21", "2026-10-22"),
        (utc(2026, 10, 21, 16, 0, 0), "2026-10-22", "2026-10-23"),
    ],
)
def test_completed_on_midnight_kl(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    instant: dt.datetime,
    ok: str,
    bad: str,
) -> None:
    freeze(monkeypatch, instant)
    b = body()
    client.post(URL, json=b, headers=auth_headers)
    assert (
        client.patch(
            f"{URL}/{b['id']}", json={"completed_on": bad}, headers=auth_headers
        ).status_code
        == 400
    )
    done = client.patch(f"{URL}/{b['id']}", json={"completed_on": ok}, headers=auth_headers)
    assert done.status_code == 200
    assert done.json()["status"] == "completed"


# --- overdue equality and combos via the API -------------------------------------------------


def test_overdue_equality_date_and_odometer(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    client.post(SR, json=record_body(date="2026-09-01", odometer=20000), headers=auth_headers)
    b = body(due_date="2026-10-21", due_odometer=20000)
    client.post(URL, json=b, headers=auth_headers)
    r = client.get(f"{URL}?today=2026-10-21", headers=auth_headers).json()
    assert r["items"][0]["status"] == "upcoming"
    assert r["items"][0]["overdue_by"] == []
    client.post(SR, json=record_body(date="2026-09-02", odometer=20001), headers=auth_headers)
    r = client.get(f"{URL}?today=2026-10-21", headers=auth_headers).json()
    assert (r["items"][0]["status"], r["items"][0]["overdue_by"]) == ("overdue", ["odometer"])
    r = client.get(f"{URL}?today=2026-10-22", headers=auth_headers).json()
    assert r["items"][0]["overdue_by"] == ["date", "odometer"]


def test_odometer_unknown_without_service_records(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    client.post(URL, json=body(due_date=None, due_odometer=0), headers=auth_headers)
    r = client.get(URL, headers=auth_headers).json()
    assert r["current_odometer"] is None
    assert r["items"][0]["status"] == "upcoming"


def test_completed_with_past_due_is_never_overdue(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body(due_date="2020-01-01", due_odometer=None)
    client.post(URL, json=b, headers=auth_headers)
    client.patch(f"{URL}/{b['id']}", json={"completed_on": "2026-01-01"}, headers=auth_headers)
    assert client.get(URL, headers=auth_headers).json()["items"] == []
    items = client.get(f"{URL}?include_completed=true", headers=auth_headers).json()["items"]
    assert items[0]["status"] == "completed" and items[0]["overdue_by"] == []


# --- PATCH due-field rules -------------------------------------------------------------------


def test_patch_clearing_both_due_fields_rejected_atomically(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body()
    client.post(URL, json=b, headers=auth_headers)
    r = client.patch(
        f"{URL}/{b['id']}", json={"due_date": None, "due_odometer": None}, headers=auth_headers
    )
    assert r.status_code == 400
    fields = {d["field"] for d in r.json()["error"]["details"]}
    assert {"due_date", "due_odometer"} <= fields
    got = client.get(f"{URL}/{b['id']}", headers=auth_headers).json()
    assert got["due_date"] == b["due_date"] and got["due_odometer"] == 20000


def test_patch_clear_one_when_only_one_is_set_rejected(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body(due_odometer=None)
    client.post(URL, json=b, headers=auth_headers)
    r = client.patch(f"{URL}/{b['id']}", json={"due_date": None}, headers=auth_headers)
    assert r.status_code == 400


def test_patch_swap_due_fields_in_one_request_ok(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body(due_odometer=None)
    client.post(URL, json=b, headers=auth_headers)
    r = client.patch(
        f"{URL}/{b['id']}", json={"due_date": None, "due_odometer": 5}, headers=auth_headers
    )
    assert r.status_code == 200 and r.json()["due_date"] is None and r.json()["due_odometer"] == 5


def test_kind_change_away_from_service_with_odometer(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body()
    client.post(URL, json=b, headers=auth_headers)
    r = client.patch(f"{URL}/{b['id']}", json={"kind": "road_tax_renewal"}, headers=auth_headers)
    assert r.status_code == 400
    assert any(d["field"] == "due_odometer" for d in r.json()["error"]["details"])
    ok = client.patch(
        f"{URL}/{b['id']}",
        json={"kind": "road_tax_renewal", "due_odometer": None},
        headers=auth_headers,
    )
    assert ok.status_code == 200 and ok.json()["due_odometer"] is None
    bad = client.patch(f"{URL}/{b['id']}", json={"due_odometer": 10}, headers=auth_headers)
    assert bad.status_code == 400
    back = client.patch(
        f"{URL}/{b['id']}", json={"kind": "service", "due_odometer": 10}, headers=auth_headers
    )
    assert back.status_code == 200


def test_patch_empty_body_and_unknown_id(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = body()
    client.post(URL, json=b, headers=auth_headers)
    r = client.patch(f"{URL}/{b['id']}", json={}, headers=auth_headers)
    assert r.status_code == 200
    assert client.patch(f"{URL}/{new_id()}", json={}, headers=auth_headers).status_code == 404
    assert (
        client.patch(f"{URL}/{new_id()}", json={"title": "x"}, headers=auth_headers).status_code
        == 404
    )


def test_patch_changes_updated_at_not_created_at(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body()
    first = client.post(URL, json=b, headers=auth_headers).json()
    second = client.patch(f"{URL}/{b['id']}", json={"title": "New"}, headers=auth_headers).json()
    assert second["created_at"] == first["created_at"]
    assert second["updated_at"] >= first["updated_at"]
    assert second["template_ref"] is None


# --- row cap and concurrency -----------------------------------------------------------------


def _bulk_insert(client: TestClient, n: int) -> None:
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(
            text(
                "INSERT INTO reminder (id, kind, title, due_date) "
                "SELECT gen_random_uuid(), 'service', 'x', DATE '2030-01-01' "
                "FROM generate_series(1, :n)"
            ),
            {"n": n},
        )


def _count(client: TestClient) -> int:
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        return int(conn.execute(text("SELECT count(*) FROM reminder")).scalar_one())


def test_cap_500_exact(client: TestClient, auth_headers: dict[str, str]) -> None:
    _bulk_insert(client, 499)
    assert client.post(URL, json=body(), headers=auth_headers).status_code == 201
    r = client.post(URL, json=body(), headers=auth_headers)
    assert r.status_code == 400
    assert r.json()["error"]["details"][0]["field"] == "body"
    assert _count(client) == 500
    assert client.get(URL, headers=auth_headers).status_code == 200


def test_cap_500_is_not_exceeded_by_concurrent_creates(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    """Defect probe: the count check and the insert are not atomic."""
    _bulk_insert(client, 490)
    codes: list[int] = []

    def go() -> None:
        codes.append(client.post(URL, json=body(), headers=auth_headers).status_code)

    threads = [threading.Thread(target=go) for _ in range(40)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert 500 not in codes and all(c in (201, 400) for c in codes), codes
    assert _count(client) <= 500, f"cap exceeded: {_count(client)} rows, codes={sorted(codes)}"


def test_concurrent_same_id_create_is_exactly_once(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body()
    codes: list[int] = []

    def go() -> None:
        codes.append(client.post(URL, json=b, headers=auth_headers).status_code)

    threads = [threading.Thread(target=go) for _ in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(codes) == [200] * 11 + [201], codes
    assert _count(client) == 1


def test_concurrent_patches_cannot_clear_both_due_fields(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body()
    client.post(URL, json=b, headers=auth_headers)
    codes: list[int] = []

    def go(payload: dict[str, Any]) -> None:
        codes.append(
            client.patch(f"{URL}/{b['id']}", json=payload, headers=auth_headers).status_code
        )

    ts = [
        threading.Thread(target=go, args=({"due_date": None},)),
        threading.Thread(target=go, args=({"due_odometer": None},)),
    ]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert 500 not in codes, codes
    got = client.get(f"{URL}/{b['id']}", headers=auth_headers).json()
    assert got["due_date"] is not None or got["due_odometer"] is not None


# --- idempotent replay -----------------------------------------------------------------------


def test_replay_with_whitespace_and_key_order_is_200(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body(title="Oil", notes="note")
    assert client.post(URL, json=b, headers=auth_headers).status_code == 201
    reordered = {k: b[k] for k in reversed(list(b))}
    reordered["title"] = "  Oil  "
    reordered["notes"] = " note\n"
    r = client.post(URL, json=reordered, headers=auth_headers)
    assert r.status_code == 200, r.text


def test_replay_omitting_optional_fields_equals_nulls(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body(due_odometer=None, notes=None)
    client.post(URL, json=b, headers=auth_headers)
    minimal = {k: b[k] for k in ("id", "kind", "title", "due_date")}
    assert client.post(URL, json=minimal, headers=auth_headers).status_code == 200


@pytest.mark.parametrize(
    "change",
    [
        {"kind": "insurance_renewal", "due_odometer": None},
        {"due_date": "2027-01-16"},
        {"due_odometer": 20001},
        {"notes": "different"},
        {"template_ref": "x"},
        {"title": "Service "[:-1] + "!"},
    ],
)
def test_replay_with_any_content_change_is_409(
    client: TestClient, auth_headers: dict[str, str], change: dict[str, Any]
) -> None:
    b = body()
    client.post(URL, json=b, headers=auth_headers)
    assert client.post(URL, json={**b, **change}, headers=auth_headers).status_code == 409


def test_replay_after_patch_is_409_and_does_not_revert(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body()
    client.post(URL, json=b, headers=auth_headers)
    client.patch(f"{URL}/{b['id']}", json={"title": "Edited"}, headers=auth_headers)
    assert client.post(URL, json=b, headers=auth_headers).status_code == 409
    assert client.get(f"{URL}/{b['id']}", headers=auth_headers).json()["title"] == "Edited"


def test_replay_invalid_body_with_existing_id_is_400_not_409(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body()
    client.post(URL, json=b, headers=auth_headers)
    r = client.post(URL, json={**b, "title": ""}, headers=auth_headers)
    assert r.status_code == 400


def test_replay_of_deleted_reminder_creates_a_new_one(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body()
    client.post(URL, json=b, headers=auth_headers)
    assert client.delete(f"{URL}/{b['id']}", headers=auth_headers).status_code == 204
    assert client.delete(f"{URL}/{b['id']}", headers=auth_headers).status_code == 404
    assert client.post(URL, json=b, headers=auth_headers).status_code == 201


# --- validation hardening --------------------------------------------------------------------


@pytest.mark.parametrize(
    "override",
    [
        {"completed_on": "2020-01-01"},
        {"status": "overdue"},
        {"overdue_by": []},
        {"created_at": "2020-01-01T00:00:00Z"},
        {"unknown": 1},
        {"title": "a" * 201},
        {"title": "   "},
        {"title": "\x00"},
        {"title": "ok\x00bad"},
        {"notes": "n" * 5001},
        {"notes": "a\x00b"},
        {"template_ref": "t" * 101},
        {"template_ref": "t\x00"},
        {"due_odometer": True},
        {"due_odometer": 1.0},
        {"due_odometer": 1.5},
        {"due_odometer": "100"},
        {"due_odometer": -1},
        {"due_odometer": 10_000_001},
        {"due_odometer": 2**63},
        {"due_date": 20261021},
        {"due_date": True},
        {"due_date": "1999-12-31"},
        {"due_date": "2201-01-01"},
        {"due_date": "2026-02-30"},
        {"due_date": "0000-00-00"},
        {"due_date": "21/10/2026"},
        {"kind": "SERVICE"},
        {"kind": None},
        {"kind": ["service"]},
        {"id": "not-a-uuid"},
        {"id": None},
        {"title": ["x"]},
        {"title": 5},
        {"notes": 5},
    ],
)
def test_create_rejects(
    client: TestClient, auth_headers: dict[str, str], override: dict[str, Any]
) -> None:
    r = client.post(URL, json=body(**override), headers=auth_headers)
    assert r.status_code == 400, (override, r.status_code, r.text[:200])
    assert r.json()["error"]["code"] == "validation_error"
    assert _count(client) == 0


@pytest.mark.parametrize(
    "override",
    [
        {"due_date": "20261021"},
        pytest.param(
            {"due_date": "2026-10-21T00:00:00"},
        ),
        {"due_date": "2026-W43-3"},
    ],
)
def test_nonstandard_date_strings_probe(
    client: TestClient, auth_headers: dict[str, str], override: dict[str, Any]
) -> None:
    """Contract: dates are YYYY-MM-DD. Anything else should be 400."""
    r = client.post(URL, json=body(**override), headers=auth_headers)
    assert r.status_code == 400, (override, r.status_code)


def test_title_exact_bounds_ok(client: TestClient, auth_headers: dict[str, str]) -> None:
    assert client.post(URL, json=body(title="a"), headers=auth_headers).status_code == 201
    assert client.post(URL, json=body(title="é" * 200), headers=auth_headers).status_code == 201
    assert client.post(URL, json=body(notes="n" * 5000), headers=auth_headers).status_code == 201
    assert (
        client.post(URL, json=body(template_ref="t" * 100), headers=auth_headers).status_code == 201
    )


def test_body_over_64kib_rejected(client: TestClient, auth_headers: dict[str, str]) -> None:
    r = client.post(URL, json=body(notes="n" * 70000), headers=auth_headers)
    assert r.status_code == 400
    assert r.json()["error"]["details"][0]["field"] == "body"


def test_malformed_json_and_wrong_content_type(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    r = client.post(
        URL, content=b"{not json", headers={**auth_headers, "Content-Type": "application/json"}
    )
    assert r.status_code == 400 and r.json()["error"]["code"] == "validation_error"
    r = client.post(
        URL, content=b"[]", headers={**auth_headers, "Content-Type": "application/json"}
    )
    assert r.status_code == 400
    r = client.post(
        URL, content=b"null", headers={**auth_headers, "Content-Type": "application/json"}
    )
    assert r.status_code == 400
    r = client.post(
        URL, content=b"\xff\xfe", headers={**auth_headers, "Content-Type": "application/json"}
    )
    assert r.status_code == 400


@pytest.mark.parametrize("bad", ["not-a-uuid", "123", "%00", "a" * 5000, "../etc", "%2e%2e"])
@pytest.mark.parametrize("method", ["get", "patch", "delete"])
def test_path_id_garbage(
    client: TestClient, auth_headers: dict[str, str], method: str, bad: str
) -> None:
    kwargs: dict[str, Any] = {"json": {"title": "x"}} if method == "patch" else {}
    r = client.request(method, f"{URL}/{bad}", headers=auth_headers, **kwargs)
    assert r.status_code in (400, 404), r.status_code
    assert r.status_code != 500
    if r.status_code == 400:
        assert r.json()["error"]["code"] == "validation_error"


@pytest.mark.parametrize(
    "today",
    [
        "2026-02-30",
        "x",
        "",
        "20261021",
        pytest.param(
            "2026-10-21T00:00:00",
        ),
        "%00",
    ],
)
def test_today_param_malformed(
    client: TestClient, auth_headers: dict[str, str], today: str
) -> None:
    r = client.get(f"{URL}?today={today}", headers=auth_headers)
    assert r.status_code == 400, (today, r.status_code)
    r2 = client.get(f"{URL}/{new_id()}?today={today}", headers=auth_headers)
    assert r2.status_code in (400, 404)


def test_include_completed_garbage(client: TestClient, auth_headers: dict[str, str]) -> None:
    assert client.get(f"{URL}?include_completed=maybe", headers=auth_headers).status_code == 400


def test_patch_validation(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = body()
    client.post(URL, json=b, headers=auth_headers)
    for payload in [
        {"title": None},
        {"kind": None},
        {"title": "  "},
        {"title": "a" * 201},
        {"notes": "a\x00"},
        {"notes": "n" * 5001},
        {"due_odometer": -1},
        {"due_odometer": "5"},
        {"due_odometer": 1.5},
        {"due_date": "2026-13-01"},
        {"completed_on": "2999-01-01"},
        {"completed_on": 5},
        {"completed_on": "garbage"},
        {"status": "completed"},
        {"template_ref": "x"},
        {"id": new_id()},
        {"created_at": "2020-01-01T00:00:00Z"},
    ]:
        r = client.patch(f"{URL}/{b['id']}", json=payload, headers=auth_headers)
        assert r.status_code == 400, (payload, r.status_code)
    got = client.get(f"{URL}/{b['id']}", headers=auth_headers).json()
    assert got["title"] == "Service" and got["completed_on"] is None


def test_notes_can_be_cleared_and_completed_on_reopened(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body(notes="hello")
    client.post(URL, json=b, headers=auth_headers)
    r = client.patch(
        f"{URL}/{b['id']}", json={"notes": None, "completed_on": "2026-10-01"}, headers=auth_headers
    )
    assert r.json()["notes"] is None and r.json()["status"] == "completed"
    r = client.patch(f"{URL}/{b['id']}", json={"completed_on": None}, headers=auth_headers)
    assert r.json()["completed_on"] is None and r.json()["status"] != "completed"


def test_complete_does_not_create_next_reminder(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body()
    client.post(URL, json=b, headers=auth_headers)
    client.patch(f"{URL}/{b['id']}", json={"completed_on": "2026-10-01"}, headers=auth_headers)
    assert _count(client) == 1


# --- text storage ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text_value",
    [
        "<img src=x onerror=alert(1)>",
        "<script>alert(1)</script>",
        "'; DROP TABLE reminder; --",
        "\u202egnp.exe",
        "{{7*7}} ${7*7}",
        "😀 日本語 ñ",
    ],
)
def test_hostile_text_round_trips_literally(
    client: TestClient, auth_headers: dict[str, str], text_value: str
) -> None:
    b = body(title=text_value, notes=text_value)
    r = client.post(URL, json=b, headers=auth_headers)
    assert r.status_code == 201
    assert r.headers["content-type"].startswith("application/json")
    got = client.get(f"{URL}/{b['id']}", headers=auth_headers).json()
    assert got["title"] == text_value.strip() and got["notes"] == text_value.strip()
    assert _count(client) == 1


# --- auth on every method --------------------------------------------------------------------


_DEFINED = {
    URL: {"get", "post"},
    f"{URL}/{uuid.uuid4()}": {"get", "patch", "delete"},
    TPL: {"get"},
}


@pytest.mark.parametrize("path", list(_DEFINED))
@pytest.mark.parametrize("method", ["get", "post", "patch", "delete", "put", "head", "options"])
def test_unauthenticated_never_gets_data(client: TestClient, method: str, path: str) -> None:
    """Defined routes: 401. Undefined methods (incl. HEAD/OPTIONS): 405 JSON, never data."""
    r = client.request(method, path)
    if method in _DEFINED[path]:
        assert r.status_code == 401, (method, path, r.status_code)
    else:
        assert r.status_code == 405, (method, path, r.status_code)
        if method != "head":
            assert r.json()["error"]["code"] == "method_not_allowed"


def test_raw_infinite_odometer_rejected(client: TestClient, auth_headers: dict[str, str]) -> None:
    raw = f'{{"id": "{new_id()}", "kind": "service", "title": "t", "due_odometer": 1e400}}'.encode()
    r = client.post(URL, content=raw, headers={**auth_headers, "Content-Type": "application/json"})
    assert r.status_code == 400, r.status_code


@pytest.mark.parametrize("path", [URL, TPL])
def test_authenticated_head_does_not_leak_or_500(
    client: TestClient, auth_headers: dict[str, str], path: str
) -> None:
    r = client.head(path, headers=auth_headers)
    assert r.status_code in (200, 405)
    assert r.content == b""


def test_no_store_on_every_reminder_response(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body()
    responses = [
        client.post(URL, json=b),
        client.post(URL, json=b, headers=auth_headers),
        client.post(URL, json=b, headers=auth_headers),
        client.post(URL, json={**b, "title": "z"}, headers=auth_headers),
        client.post(URL, json={"x": 1}, headers=auth_headers),
        client.get(URL, headers=auth_headers),
        client.get(f"{URL}/{b['id']}", headers=auth_headers),
        client.get(f"{URL}/{new_id()}", headers=auth_headers),
        client.patch(f"{URL}/{b['id']}", json={"title": "q"}, headers=auth_headers),
        client.get(TPL, headers=auth_headers),
        client.get(TPL),
        client.delete(f"{URL}/{b['id']}", headers=auth_headers),
        client.put(URL, headers=auth_headers),
    ]
    for r in responses:
        assert r.headers.get("cache-control") == "no-store", (r.request.method, r.status_code)


def test_wrong_method_is_405_json(client: TestClient, auth_headers: dict[str, str]) -> None:
    r = client.put(URL, headers=auth_headers)
    assert r.status_code == 405 and r.json()["error"]["code"] == "method_not_allowed"
    r = client.post(TPL, headers=auth_headers, json={})
    assert r.status_code == 405


# --- template --------------------------------------------------------------------------------


def test_template_endpoint_creates_nothing_and_is_idempotent(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    before = _count(client)
    a = client.get(TPL, headers=auth_headers).json()
    b = client.get(TPL, headers=auth_headers).json()
    assert a == b and _count(client) == before == 0
    client.put(
        "/api/v1/vehicle",
        json={"model": "7X", "purchase_date": "2026-01-01"},
        headers=auth_headers,
    )
    client.post(SR, json=record_body(), headers=auth_headers)
    client.get(TPL, headers=auth_headers)
    assert _count(client) == 0
    assert client.get(URL, headers=auth_headers).json()["items"] == []


def test_template_content_exact(client: TestClient, auth_headers: dict[str, str]) -> None:
    data = client.get(TPL, headers=auth_headers).json()
    assert len(data["items"]) == 1
    t = data["items"][0]
    assert t["id"] == "awd-performance-service" and t["baseline_required"] is True
    assert t["source"]["research_ref"] == "M12" and t["source"]["status"] == "verified"
    assert t["interval"] == {"km": 20000, "months": 12, "rule": "whichever comes first"}
    cps = t["checkpoints"]
    assert [c["number"] for c in cps] == list(range(1, 9))
    for c in cps:
        assert c["km"] == 20000 * c["number"] and c["months"] == 12 * c["number"]
        if c["number"] % 2:
            assert c["work_items"] == [] and c["work_items_stated"] is False
        else:
            assert c["work_items_stated"] is True
            assert ("Coolant replacement" in c["work_items"]) == (c["number"] in (4, 8))
            for item in (
                "Maintenance inspection",
                "Cabin air filter replacement",
                "Brake fluid replacement",
                "Front and rear reducer lubricant replacement",
            ):
                assert item in c["work_items"]
    assert "confirm" in t["caveat"].lower()
    assert "fee" not in str(t).lower() and "rm" not in t["caveat"].lower().split()


# --- template accept flow through the plain API (limit values) ------------------------------


def test_template_accept_with_edited_values_is_ordinary_reminder(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body(
        title="Edited 20,000 km service",
        due_date="2027-10-22",
        due_odometer=20500,
        notes="mine",
        template_ref="awd-performance-service:1",
    )
    assert client.post(URL, json=b, headers=auth_headers).status_code == 201
    got = client.get(f"{URL}/{b['id']}", headers=auth_headers).json()
    assert got["template_ref"] == "awd-performance-service:1" and got["title"].startswith("Edited")
    r = client.patch(f"{URL}/{b['id']}", json={"title": "again"}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["template_ref"] == "awd-performance-service:1"
    assert client.delete(f"{URL}/{b['id']}", headers=auth_headers).status_code == 204


# --- ordering --------------------------------------------------------------------------------


def test_list_order_matches_contract(client: TestClient, auth_headers: dict[str, str]) -> None:
    client.post(SR, json=record_body(odometer=1000), headers=auth_headers)
    specs = [
        ("odo-high", None, 5000),
        ("odo-low", None, 2000),
        ("date-late", "2027-06-01", None),
        ("date-early", "2027-01-01", None),
        ("both", "2027-01-01", 3000),
        ("over-date", "2020-01-01", None),
        ("over-odo", None, 500),
    ]
    for title, d, o in specs:
        client.post(URL, json=body(title=title, due_date=d, due_odometer=o), headers=auth_headers)
    titles = [i["title"] for i in client.get(URL, headers=auth_headers).json()["items"]]
    assert titles[:2] == ["over-date", "over-odo"]
    up = titles[2:]
    assert (
        up.index("date-early") < up.index("date-late") < up.index("odo-low") < up.index("odo-high")
    )
    assert up.index("both") < up.index("date-late")
