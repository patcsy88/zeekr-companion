"""Reminders slice: AC-10 to AC-19, AC-26, AC-28 (server side), AC-29 (FR-7, FR-8)."""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app import schemas
from app.clock import today_kl
from app.services.reminder_status import compute_status
from tests.conftest import new_id, record_body

URL = "/api/v1/reminders"
VECTORS = (
    pathlib.Path(__file__).resolve().parents[3]
    / "packages/shared-types/test-vectors/reminder-status.json"
)


def body(**overrides: Any) -> dict[str, Any]:
    b: dict[str, Any] = {
        "id": new_id(),
        "kind": "service",
        "title": "Service at 20,000 km",
        "due_date": "2027-01-15",
        "due_odometer": 20000,
        "notes": "n",
        "template_ref": None,
    }
    b.update(overrides)
    return b


def _vectors() -> list[dict[str, Any]]:
    return json.loads(VECTORS.read_text())["cases"]


@pytest.mark.parametrize("case", _vectors(), ids=lambda c: c["name"])
def test_ac17_shared_vectors(case: dict[str, Any]) -> None:
    r = case["reminder"]
    status, by = compute_status(
        completed_on=dt.date.fromisoformat(r["completed_on"]) if r["completed_on"] else None,
        due_date=dt.date.fromisoformat(r["due_date"]) if r["due_date"] else None,
        due_odometer=r["due_odometer"],
        current_odometer_km=case["current_odometer_km"],
        today=dt.date.fromisoformat(case["today"]),
    )
    assert {"status": status, "overdue_by": by} == case["expected"]


# --- AC-26 ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", URL),
        ("get", URL),
        ("get", f"{URL}/{uuid.uuid4()}"),
        ("patch", f"{URL}/{uuid.uuid4()}"),
        ("delete", f"{URL}/{uuid.uuid4()}"),
        ("get", "/api/v1/reminder-templates"),
    ],
)
@pytest.mark.parametrize("auth", [None, "Bearer wrong", "Basic abc"])
def test_ac26_every_route_needs_a_token(
    client: TestClient, method: str, path: str, auth: str | None
) -> None:
    headers = {"Authorization": auth} if auth else {}
    kwargs: dict[str, Any] = {"json": body()} if method in ("post", "patch") else {}
    r = client.request(method, path, headers=headers, **kwargs)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthenticated"


# --- AC-10 ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "extra",
    [
        {"due_odometer": None},
        {"due_date": None},
        {},
    ],
)
def test_ac10_create_and_get(
    client: TestClient, auth_headers: dict[str, str], extra: dict[str, Any]
) -> None:
    b = body(**extra)
    created = client.post(URL, json=b, headers=auth_headers)
    assert created.status_code == 201
    got = client.get(f"{URL}/{b['id']}", headers=auth_headers).json()
    for k in ("id", "kind", "title", "due_date", "due_odometer", "notes", "template_ref"):
        assert got[k] == b[k]
    assert got["completed_on"] is None
    assert got["status"] in ("upcoming", "overdue")


@pytest.mark.parametrize("kind", ["service", "insurance_renewal", "road_tax_renewal"])
def test_ac10_all_kinds(client: TestClient, auth_headers: dict[str, str], kind: str) -> None:
    b = body(kind=kind, due_odometer=None)
    assert client.post(URL, json=b, headers=auth_headers).status_code == 201


def test_ac10_replay_200_and_conflict_409(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = body()
    first = client.post(URL, json=b, headers=auth_headers)
    second = client.post(URL, json=b, headers=auth_headers)
    assert (first.status_code, second.status_code) == (201, 200)
    assert second.json() == first.json()
    assert len(client.get(URL, headers=auth_headers).json()["items"]) == 1
    changed = client.post(URL, json={**b, "title": "Other"}, headers=auth_headers)
    assert changed.status_code == 409
    assert changed.json()["error"]["code"] == "conflict"
    assert client.get(f"{URL}/{b['id']}", headers=auth_headers).json()["title"] == b["title"]


# --- AC-11 ----------------------------------------------------------------------------------


def test_ac11_create_without_due_fields(client: TestClient, auth_headers: dict[str, str]) -> None:
    r = client.post(URL, json=body(due_date=None, due_odometer=None), headers=auth_headers)
    assert r.status_code == 400
    err = r.json()["error"]
    assert err["code"] == "validation_error"
    assert {d["field"] for d in err["details"]} == {"due_date", "due_odometer"}
    assert client.get(URL, headers=auth_headers).json()["items"] == []


def test_ac11_patch_leaving_neither_is_rejected_and_unchanged(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body()
    client.post(URL, json=b, headers=auth_headers)
    r = client.patch(
        f"{URL}/{b['id']}", json={"due_date": None, "due_odometer": None}, headers=auth_headers
    )
    assert r.status_code == 400
    assert {d["field"] for d in r.json()["error"]["details"]} == {"due_date", "due_odometer"}
    got = client.get(f"{URL}/{b['id']}", headers=auth_headers).json()
    assert got["due_date"] == b["due_date"]
    assert got["due_odometer"] == b["due_odometer"]


def test_ac11_clearing_one_of_two_is_fine(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = body()
    client.post(URL, json=b, headers=auth_headers)
    r = client.patch(f"{URL}/{b['id']}", json={"due_date": None}, headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["due_date"] is None
    assert r.json()["due_odometer"] == 20000


# --- AC-12 ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"due_odometer": -1}, "due_odometer"),
        ({"due_odometer": 10_000_001}, "due_odometer"),
        ({"due_odometer": 1.5}, "due_odometer"),
        ({"due_odometer": "100"}, "due_odometer"),
        ({"due_odometer": True}, "due_odometer"),
        ({"kind": "oil"}, "kind"),
        ({"kind": None}, "kind"),
        ({"due_date": "2027-13-01"}, "due_date"),
        ({"due_date": "tomorrow"}, "due_date"),
        ({"due_date": 20270101}, "due_date"),
        ({"due_date": "1999-12-31"}, "due_date"),
        ({"due_date": "2201-01-01"}, "due_date"),
        ({"title": ""}, "title"),
        ({"title": "   "}, "title"),
        ({"title": "x" * 201}, "title"),
        ({"notes": "x" * 5001}, "notes"),
        ({"template_ref": "x" * 101}, "template_ref"),
        ({"status": "overdue"}, "status"),
        ({"overdue_by": []}, "overdue_by"),
        ({"completed_on": "2026-01-01"}, "completed_on"),
        ({"surprise": 1}, "surprise"),
        ({"title": "a\x00b"}, "title"),
        ({"kind": "insurance_renewal"}, "due_odometer"),
        ({"kind": "road_tax_renewal"}, "due_odometer"),
        ({"id": "not-a-uuid"}, "id"),
    ],
)
def test_ac12_validation(
    client: TestClient, auth_headers: dict[str, str], overrides: dict[str, Any], field: str
) -> None:
    r = client.post(URL, json=body(**overrides), headers=auth_headers)
    assert r.status_code == 400, r.text
    err = r.json()["error"]
    assert err["code"] == "validation_error"
    assert field in [d["field"] for d in err["details"]]


@pytest.mark.parametrize("field", ["kind", "title", "id"])
def test_ac12_missing_required(
    client: TestClient, auth_headers: dict[str, str], field: str
) -> None:
    b = body()
    del b[field]
    assert client.post(URL, json=b, headers=auth_headers).status_code == 400


@pytest.mark.parametrize("value", [0, 10_000_000])
def test_ac12_odometer_bounds_accepted(
    client: TestClient, auth_headers: dict[str, str], value: int
) -> None:
    assert client.post(URL, json=body(due_odometer=value), headers=auth_headers).status_code == 201


def test_ac12_title_is_trimmed_and_200_chars_accepted(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    r = client.post(URL, json=body(title="  " + "x" * 200 + "  "), headers=auth_headers)
    assert r.status_code == 201
    assert r.json()["title"] == "x" * 200


def test_ac12_past_due_date_is_accepted_and_overdue(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    r = client.post(URL, json=body(due_date="2020-01-01", due_odometer=None), headers=auth_headers)
    assert r.status_code == 201
    assert r.json()["status"] == "overdue"
    assert r.json()["overdue_by"] == ["date"]


def test_ac12_patch_rejects_status_and_template_ref_and_nulls(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body()
    client.post(URL, json=b, headers=auth_headers)
    for patch in ({"status": "completed"}, {"template_ref": "x"}, {"kind": None}, {"title": None}):
        r = client.patch(f"{URL}/{b['id']}", json=patch, headers=auth_headers)
        assert r.status_code == 400, patch


def test_ac12_patch_kind_away_from_service_with_odometer_rejected(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body()
    client.post(URL, json=b, headers=auth_headers)
    r = client.patch(f"{URL}/{b['id']}", json={"kind": "insurance_renewal"}, headers=auth_headers)
    assert r.status_code == 400
    ok = client.patch(
        f"{URL}/{b['id']}",
        json={"kind": "insurance_renewal", "due_odometer": None},
        headers=auth_headers,
    )
    assert ok.status_code == 200


# --- AC-13 / AC-14 --------------------------------------------------------------------------


def test_ac13_patch_partial_and_null_and_404(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body()
    client.post(URL, json=b, headers=auth_headers)
    r = client.patch(f"{URL}/{b['id']}", json={"title": "New", "notes": None}, headers=auth_headers)
    assert r.status_code == 200
    out = r.json()
    assert out["title"] == "New"
    assert out["notes"] is None
    assert out["due_date"] == b["due_date"]
    assert out["due_odometer"] == b["due_odometer"]
    assert (
        client.patch(f"{URL}/{new_id()}", json={"title": "x"}, headers=auth_headers).status_code
        == 404
    )
    empty = client.patch(f"{URL}/{b['id']}", json={}, headers=auth_headers)
    assert empty.status_code == 200
    assert empty.json()["title"] == "New"


def test_ac14_delete(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = body()
    client.post(URL, json=b, headers=auth_headers)
    assert client.delete(f"{URL}/{b['id']}", headers=auth_headers).status_code == 204
    assert client.get(f"{URL}/{b['id']}", headers=auth_headers).status_code == 404
    again = client.delete(f"{URL}/{b['id']}", headers=auth_headers)
    assert again.status_code == 404
    assert again.json()["error"]["code"] == "not_found"


def test_bad_uuid_in_path_is_400(client: TestClient, auth_headers: dict[str, str]) -> None:
    assert client.get(f"{URL}/nope", headers=auth_headers).status_code == 400
    assert client.delete(f"{URL}/nope", headers=auth_headers).status_code == 400


# --- AC-16 / AC-18 / AC-19 ------------------------------------------------------------------


def test_ac16_current_odometer_is_latest_service_record(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    assert client.get(URL, headers=auth_headers).json()["current_odometer"] is None
    older = record_body(date="2026-01-01", odometer=30000)
    newer = record_body(date="2026-06-01", odometer=12000)  # lower km but later date wins
    for r in (older, newer):
        assert (
            client.post("/api/v1/service-records", json=r, headers=auth_headers).status_code == 201
        )
    cur = client.get(URL, headers=auth_headers).json()["current_odometer"]
    assert cur == {
        "km": 12000,
        "source": "latest_service_record",
        "service_record_id": newer["id"],
        "date": "2026-06-01",
    }


def test_ac16_ties_break_by_created_at_then_id(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    first = record_body(date="2026-06-01", odometer=1000)
    second = record_body(date="2026-06-01", odometer=2000)
    client.post("/api/v1/service-records", json=first, headers=auth_headers)
    client.post("/api/v1/service-records", json=second, headers=auth_headers)
    cur = client.get(URL, headers=auth_headers).json()["current_odometer"]
    assert cur["service_record_id"] == second["id"]


def test_ac17_status_with_service_records_and_today_param(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    client.post("/api/v1/service-records", json=record_body(odometer=20001), headers=auth_headers)
    a = body(due_date=None, due_odometer=20000)
    b = body(due_date=None, due_odometer=20001)
    client.post(URL, json=a, headers=auth_headers)
    client.post(URL, json=b, headers=auth_headers)
    items = {i["id"]: i for i in client.get(URL, headers=auth_headers).json()["items"]}
    assert items[a["id"]]["status"] == "overdue"
    assert items[a["id"]]["overdue_by"] == ["odometer"]
    assert items[b["id"]]["status"] == "upcoming"  # equality is not overdue
    d = body(due_date="2027-03-01", due_odometer=None)
    client.post(URL, json=d, headers=auth_headers)
    on = client.get(f"{URL}/{d['id']}", params={"today": "2027-03-01"}, headers=auth_headers)
    after = client.get(f"{URL}/{d['id']}", params={"today": "2027-03-02"}, headers=auth_headers)
    assert on.json()["status"] == "upcoming"
    assert after.json()["status"] == "overdue"
    bad = client.get(URL, params={"today": "2027-02-30"}, headers=auth_headers)
    assert bad.status_code == 400
    assert bad.json()["error"]["code"] == "validation_error"


def test_ac17_default_today_is_kuala_lumpur(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.services import reminders as svc

    fixed = dt.datetime(2026, 10, 11, 19, 0, tzinfo=dt.UTC)  # 2026-10-12 03:00 MYT
    monkeypatch.setattr(svc, "today_kl", lambda: today_kl(fixed))
    b = body(due_date="2026-10-11", due_odometer=None)
    client.post(URL, json=b, headers=auth_headers)
    got = client.get(f"{URL}/{b['id']}", headers=auth_headers).json()
    assert got["status"] == "overdue"  # UTC date would still be due today


def test_ac18_order_and_completed_filter(client: TestClient, auth_headers: dict[str, str]) -> None:
    client.post("/api/v1/service-records", json=record_body(odometer=30000), headers=auth_headers)
    today = today_kl()
    far = body(title="far", due_date=(today + dt.timedelta(days=90)).isoformat(), due_odometer=None)
    near = body(
        title="near", due_date=(today + dt.timedelta(days=5)).isoformat(), due_odometer=None
    )
    km_hi = body(title="km hi", due_date=None, due_odometer=60000)
    km_lo = body(title="km lo", due_date=None, due_odometer=40000)
    late = body(
        title="late", due_date=(today - dt.timedelta(days=3)).isoformat(), due_odometer=None
    )
    km_over = body(title="km over", due_date=None, due_odometer=100)
    done = body(
        title="done", due_date=(today - dt.timedelta(days=9)).isoformat(), due_odometer=None
    )
    for b in (far, km_hi, near, km_lo, late, km_over, done):
        assert client.post(URL, json=b, headers=auth_headers).status_code == 201
    client.patch(
        f"{URL}/{done['id']}", json={"completed_on": today.isoformat()}, headers=auth_headers
    )
    items = client.get(URL, headers=auth_headers).json()["items"]
    assert [i["title"] for i in items] == ["late", "km over", "near", "far", "km lo", "km hi"]
    all_items = client.get(URL, params={"include_completed": "true"}, headers=auth_headers).json()[
        "items"
    ]
    assert [i["title"] for i in all_items][-1] == "done"
    assert all_items[-1]["status"] == "completed"


def test_ac19_complete_and_reopen(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = body(due_date="2020-01-01", due_odometer=None)
    client.post(URL, json=b, headers=auth_headers)
    today = today_kl().isoformat()
    done = client.patch(f"{URL}/{b['id']}", json={"completed_on": today}, headers=auth_headers)
    assert done.status_code == 200
    assert done.json()["status"] == "completed"
    assert done.json()["overdue_by"] == []
    assert len(client.get(URL, headers=auth_headers).json()["items"]) == 0  # no next one created
    reopened = client.patch(f"{URL}/{b['id']}", json={"completed_on": None}, headers=auth_headers)
    assert reopened.json()["status"] == "overdue"
    assert reopened.json()["completed_on"] is None


def test_ac19_completed_on_future_rejected_in_kl_terms(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    b = body()
    client.post(URL, json=b, headers=auth_headers)
    fixed = dt.datetime(2026, 10, 11, 19, 0, tzinfo=dt.UTC)  # 2026-10-12 03:00 MYT
    monkeypatch.setattr(schemas, "today_kl", lambda: today_kl(fixed))
    ok = client.patch(f"{URL}/{b['id']}", json={"completed_on": "2026-10-12"}, headers=auth_headers)
    assert ok.status_code == 200
    bad = client.patch(
        f"{URL}/{b['id']}", json={"completed_on": "2026-10-13"}, headers=auth_headers
    )
    assert bad.status_code == 400
    assert bad.json()["error"]["details"][0]["field"] == "completed_on"


# --- AC-20 to AC-23 (server side) -----------------------------------------------------------


def test_ac20_template_endpoint_creates_nothing(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    for _ in range(3):
        assert client.get("/api/v1/reminder-templates", headers=auth_headers).status_code == 200
    assert (
        client.get(URL, params={"include_completed": "true"}, headers=auth_headers).json()["items"]
        == []
    )
    for method in ("post", "put", "patch", "delete"):
        r = client.request(method, "/api/v1/reminder-templates", headers=auth_headers, json={})
        assert r.status_code == 405
    for path in ("/api/v1/reminder-templates/apply", "/api/v1/reminders/apply-template"):
        r = client.post(path, headers=auth_headers, json={})
        assert r.status_code in (400, 404, 405)
    assert (
        client.get(URL, params={"include_completed": "true"}, headers=auth_headers).json()["items"]
        == []
    )


def test_ac22_no_reminder_from_other_events(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    vehicle = {"id": new_id(), "model": "7X", "purchase_date": "2026-01-01"}
    assert client.put("/api/v1/vehicle", json=vehicle, headers=auth_headers).status_code == 200
    client.post("/api/v1/service-records", json=record_body(), headers=auth_headers)
    client.get("/api/v1/reminder-templates", headers=auth_headers)
    assert (
        client.get(URL, params={"include_completed": "true"}, headers=auth_headers).json()["items"]
        == []
    )


def test_ac23_template_content_is_only_what_m12_states(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    t = client.get("/api/v1/reminder-templates", headers=auth_headers).json()["items"]
    assert len(t) == 1
    tpl = t[0]
    assert tpl["id"] == "awd-performance-service"
    assert tpl["version"] == 1
    assert tpl["source"]["research_ref"] == "M12"
    assert tpl["source"]["status"] == "verified"
    assert tpl["source"]["retrieved"] == "2026-10-22"
    assert tpl["interval"] == {"km": 20000, "months": 12, "rule": "whichever comes first"}
    assert tpl["baseline_required"] is True
    assert "build date" in tpl["caveat"]
    cps = tpl["checkpoints"]
    assert [c["number"] for c in cps] == list(range(1, 9))
    assert [c["km"] for c in cps] == [20000 * n for n in range(1, 9)]
    assert [c["months"] for c in cps] == [12 * n for n in range(1, 9)]
    for c in cps:
        if c["number"] % 2:
            assert c["work_items"] == []
            assert c["work_items_stated"] is False
        else:
            assert c["work_items_stated"] is True
            assert "Maintenance inspection" in c["work_items"]
            assert ("Coolant replacement" in c["work_items"]) == (c["number"] in (4, 8))
            assert len(c["work_items"]) == (5 if c["number"] in (4, 8) else 4)


def test_ac21_template_item_is_an_ordinary_reminder_with_template_ref(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body(template_ref="awd-performance-service:1:1")
    assert client.post(URL, json=b, headers=auth_headers).status_code == 201
    got = client.get(f"{URL}/{b['id']}", headers=auth_headers).json()
    assert got["template_ref"] == "awd-performance-service:1:1"
    assert (
        client.patch(f"{URL}/{b['id']}", json={"title": "Edited"}, headers=auth_headers).status_code
        == 200
    )
    assert client.delete(f"{URL}/{b['id']}", headers=auth_headers).status_code == 204


# --- AC-28 (server side), row cap -----------------------------------------------------------


def test_ac28_script_like_title_is_stored_and_returned_literally(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    title = "<img src=x onerror=alert(1)>"
    b = body(title=title, notes="<script>alert(1)</script>")
    client.post(URL, json=b, headers=auth_headers)
    got = client.get(f"{URL}/{b['id']}", headers=auth_headers)
    assert got.json()["title"] == title
    assert got.json()["notes"] == "<script>alert(1)</script>"
    assert got.headers["content-type"].startswith("application/json")
    assert got.headers["cache-control"] == "no-store"


def test_row_cap_500(client: TestClient, auth_headers: dict[str, str]) -> None:
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(
            text(
                "INSERT INTO reminder (id, kind, title, due_date) "
                "SELECT gen_random_uuid(), 'service', 'bulk ' || g, DATE '2030-01-01' "
                "FROM generate_series(1, 500) g"
            )
        )
    r = client.post(URL, json=body(), headers=auth_headers)
    assert r.status_code == 400
    err = r.json()["error"]
    assert err["code"] == "validation_error"
    assert err["details"][0]["field"] == "body"
    assert len(client.get(URL, headers=auth_headers).json()["items"]) == 500


def test_replay_at_cap_still_returns_200(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = body()
    assert client.post(URL, json=b, headers=auth_headers).status_code == 201
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(
            text(
                "INSERT INTO reminder (id, kind, title, due_date) "
                "SELECT gen_random_uuid(), 'service', 'bulk', DATE '2030-01-01' "
                "FROM generate_series(1, 499) g"
            )
        )
    assert client.post(URL, json=b, headers=auth_headers).status_code == 200


def test_db_check_constraints_back_up_the_api(client: TestClient) -> None:
    from sqlalchemy.exc import IntegrityError

    prefix = "INSERT INTO reminder (id, kind, title, {cols}) VALUES (gen_random_uuid(), {vals})"
    bad = [
        "INSERT INTO reminder (id, kind, title) VALUES (gen_random_uuid(), 'service', 'x')",
        prefix.format(cols="due_date", vals="'oil', 'x', DATE '2030-01-01'"),
        prefix.format(cols="due_odometer", vals="'insurance_renewal', 'x', 5"),
        prefix.format(cols="due_odometer", vals="'service', 'x', -1"),
        prefix.format(cols="due_date", vals="'service', '', DATE '2030-01-01'"),
    ]
    for stmt in bad:
        with pytest.raises(IntegrityError), client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
            conn.execute(text(stmt))
