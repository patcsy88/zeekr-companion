"""Warranty slice, backend: AC-48 to AC-52, AC-55, AC-57 to AC-60, AC-64, AC-67, AC-68.

Fictional data only: no VIN, plate, certificate number or provider name.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import threading
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect, text

from app import schemas
from app.clock import today_kl
from app.models import WarrantyClaim, WarrantyCoverage
from app.services.warranty_status import compute_status
from tests.conftest import new_id, record_body

COV = "/api/v1/warranty-coverages"
CLM = "/api/v1/warranty-claims"
TPL = "/api/v1/warranty-templates"
VECTORS = (
    pathlib.Path(__file__).resolve().parents[3]
    / "packages/shared-types/test-vectors/warranty-status.json"
)
TODAY = "2026-10-22"


def cov(**overrides: Any) -> dict[str, Any]:
    b: dict[str, Any] = {
        "id": new_id(),
        "name": "Sample vehicle warranty",
        "provider_type": "factory",
        "start_date": "2026-01-01",
        "end_date": "2031-01-01",
        "km_limit": 150000,
        "notes": "n",
    }
    b.update(overrides)
    return b


def clm(coverage_id: str, /, **overrides: Any) -> dict[str, Any]:
    b: dict[str, Any] = {
        "id": new_id(),
        "coverage_id": coverage_id,
        "date": "2026-09-01",
        "odometer": 12000,
        "description": "Sample claim",
        "status": "submitted",
        "cost_covered_minor": None,
        "currency": "MYR",
        "notes": "n",
    }
    b.update(overrides)
    return b


def mk_cov(client: TestClient, h: dict[str, str], **o: Any) -> dict[str, Any]:
    r = client.post(COV, json=cov(**o), headers=h)
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def mk_clm(client: TestClient, h: dict[str, str], coverage_id: str, **o: Any) -> dict[str, Any]:
    r = client.post(CLM, json=clm(coverage_id, **o), headers=h)
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def fields(r: Any) -> list[str]:
    return [d["field"] for d in r.json()["error"]["details"]]


def _vectors() -> list[dict[str, Any]]:
    return json.loads(VECTORS.read_text())["cases"]  # type: ignore[no-any-return]


@pytest.mark.parametrize("case", _vectors(), ids=lambda c: c["name"])
def test_ac51_shared_vectors(case: dict[str, Any]) -> None:
    c = case["coverage"]
    status, expired_by, soon_by = compute_status(
        start_date=dt.date.fromisoformat(c["start_date"]),
        end_date=dt.date.fromisoformat(c["end_date"]) if c["end_date"] else None,
        km_limit=c["km_limit"],
        current_odometer_km=case["current_odometer_km"],
        today=dt.date.fromisoformat(case["today"]),
    )
    assert {
        "status": status,
        "expired_by": expired_by,
        "expiring_soon_by": soon_by,
    } == case["expected"]


def test_vectors_cover_the_required_situations() -> None:
    statuses = {c["expected"]["status"] for c in _vectors()}
    assert statuses == {"not_started", "active", "expiring_soon", "expired"}
    assert len(_vectors()) >= 20


# --- AC-64 ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", COV),
        ("get", COV),
        ("get", f"{COV}/{uuid.uuid4()}"),
        ("patch", f"{COV}/{uuid.uuid4()}"),
        ("delete", f"{COV}/{uuid.uuid4()}"),
        ("post", CLM),
        ("get", CLM),
        ("get", f"{CLM}/{uuid.uuid4()}"),
        ("patch", f"{CLM}/{uuid.uuid4()}"),
        ("delete", f"{CLM}/{uuid.uuid4()}"),
        ("get", TPL),
    ],
)
@pytest.mark.parametrize("auth", [None, "Bearer wrong", "Basic abc"])
def test_ac64_every_route_needs_a_token(
    client: TestClient, method: str, path: str, auth: str | None
) -> None:
    headers = {"Authorization": auth} if auth else {}
    kwargs: dict[str, Any] = {"json": cov()} if method in ("post", "patch") else {}
    r = client.request(method, path, headers=headers, **kwargs)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthenticated"


# --- AC-48 ----------------------------------------------------------------------------------


def test_ac48_create_get_and_defaults(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = cov()
    r = client.post(COV, json=b, headers=auth_headers)
    assert r.status_code == 201
    out = r.json()
    for k, v in b.items():
        assert out[k] == v
    assert out["source_kind"] == "owner_entered"
    assert out["verification_status"] == "unverified"
    assert out["source_note"] is None and out["template_ref"] is None
    assert out["claim_count"] == 0
    assert set(out) == {
        "id",
        "name",
        "provider_type",
        "start_date",
        "end_date",
        "km_limit",
        "notes",
        "source_kind",
        "verification_status",
        "source_note",
        "template_ref",
        "status",
        "expired_by",
        "expiring_soon_by",
        "claim_count",
        "created_at",
        "updated_at",
    }
    got = client.get(f"{COV}/{b['id']}", headers=auth_headers)
    assert got.status_code == 200 and got.json() == out


def test_ac48_replay_and_conflict(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = cov()
    first = client.post(COV, json=b, headers=auth_headers)
    second = client.post(COV, json=b, headers=auth_headers)
    assert (first.status_code, second.status_code) == (201, 200)
    assert second.json() == first.json()
    assert len(client.get(COV, headers=auth_headers).json()["items"]) == 1
    for change in ({"name": "Other"}, {"km_limit": 1}, {"notes": None}, {"source_note": "x"}):
        r = client.post(COV, json={**b, **change}, headers=auth_headers)
        assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    assert client.get(f"{COV}/{b['id']}", headers=auth_headers).json()["name"] == b["name"]


def test_ac48_blank_notes_stored_as_null(client: TestClient, auth_headers: dict[str, str]) -> None:
    r = client.post(
        COV, json=cov(notes="   ", source_note="  ", name="  Trim me  "), headers=auth_headers
    )
    assert r.status_code == 201
    assert r.json()["notes"] is None and r.json()["source_note"] is None
    assert r.json()["name"] == "Trim me"


# --- AC-49 ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("change", "field"),
    [
        ({"name": ""}, "name"),
        ({"name": "   "}, "name"),
        ({"name": "x" * 201}, "name"),
        ({"provider_type": "dealer"}, "provider_type"),
        ({"source_kind": "import"}, "source_kind"),
        ({"verification_status": "verified"}, "verification_status"),
        ({"start_date": None}, "start_date"),
        ({"start_date": "01/01/2026"}, "start_date"),
        ({"start_date": 20260101}, "start_date"),
        ({"start_date": "2026-02-30"}, "start_date"),
        ({"start_date": "1999-12-31"}, "start_date"),
        ({"start_date": "2201-01-01", "end_date": "2201-02-01"}, "start_date"),
        ({"end_date": "2201-01-01"}, "end_date"),
        ({"end_date": "1999-01-01", "start_date": "1999-01-01"}, "start_date"),
        ({"end_date": "2025-12-31"}, "end_date"),
        ({"km_limit": 0}, "km_limit"),
        ({"km_limit": -1}, "km_limit"),
        ({"km_limit": 10_000_001}, "km_limit"),
        ({"km_limit": 1.5}, "km_limit"),
        ({"km_limit": "1000"}, "km_limit"),
        ({"km_limit": True}, "km_limit"),
        ({"notes": "x" * 5001}, "notes"),
        ({"source_note": "x" * 201}, "source_note"),
        ({"template_ref": "x" * 101, "source_kind": "template"}, "template_ref"),
        ({"template_ref": "my-factory-warranty:general"}, "template_ref"),
        ({"name": "a\x00b"}, "name"),
        ({"notes": "a\x00b"}, "notes"),
        ({"status": "active"}, "status"),
        ({"claim_count": 3}, "claim_count"),
        ({"expired_by": []}, "expired_by"),
        ({"provider": "Someone"}, "provider"),
        ({"certificate_number": "X"}, "certificate_number"),
    ],
)
def test_ac49_validation(
    client: TestClient, auth_headers: dict[str, str], change: dict[str, Any], field: str
) -> None:
    r = client.post(COV, json=cov(**change), headers=auth_headers)
    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "validation_error"
    assert field in fields(r)
    assert client.get(COV, headers=auth_headers).json()["items"] == []


def test_ac49_end_or_km_required_names_both(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    r = client.post(COV, json=cov(end_date=None, km_limit=None), headers=auth_headers)
    assert r.status_code == 400
    assert set(fields(r)) == {"end_date", "km_limit"}
    missing = cov()
    del missing["end_date"], missing["km_limit"]
    assert client.post(COV, json=missing, headers=auth_headers).status_code == 400


def test_ac49_accepted_edges(client: TestClient, auth_headers: dict[str, str]) -> None:
    for change in (
        {"end_date": None},
        {"km_limit": None},
        {"km_limit": 1},
        {"km_limit": 10_000_000},
        {"start_date": "2000-01-01", "end_date": "2000-01-01", "km_limit": None},
        {"start_date": "2200-12-31", "end_date": "2200-12-31", "km_limit": None},
        {"start_date": "2090-01-01", "end_date": "2095-01-01"},  # future start
        {"start_date": "2001-01-01", "end_date": "2002-01-01"},  # past end
    ):
        r = client.post(COV, json=cov(**change), headers=auth_headers)
        assert r.status_code == 201, (change, r.text)
    assert client.post(COV, json=cov(name="n" * 200), headers=auth_headers).status_code == 201
    assert client.post(COV, json=cov(notes="n" * 5000), headers=auth_headers).status_code == 201


def test_ac49_cap_of_50_coverages(client: TestClient, auth_headers: dict[str, str]) -> None:
    ids = []
    for _ in range(schemas.MAX_WARRANTY_COVERAGES):
        b = cov()
        ids.append(b)
        with client.stream("POST", COV, json=b, headers=auth_headers) as r:
            assert r.status_code == 201
    over = client.post(COV, json=cov(), headers=auth_headers)
    assert over.status_code == 400 and fields(over) == ["body"]
    replay = client.post(COV, json=ids[0], headers=auth_headers)  # replay allowed at the cap
    assert replay.status_code == 200
    assert len(client.get(COV, headers=auth_headers).json()["items"]) == 50


def test_ac49_cap_holds_under_concurrency(client: TestClient, auth_headers: dict[str, str]) -> None:
    for _ in range(schemas.MAX_WARRANTY_COVERAGES - 2):
        mk_cov(client, auth_headers)
    codes: list[int] = []

    def go() -> None:
        codes.append(client.post(COV, json=cov(), headers=auth_headers).status_code)

    threads = [threading.Thread(target=go) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(codes) == [201, 201, 400, 400, 400, 400]
    assert len(client.get(COV, headers=auth_headers).json()["items"]) == 50


# --- AC-50 ----------------------------------------------------------------------------------


def test_ac50_patch_fields_and_nulls(client: TestClient, auth_headers: dict[str, str]) -> None:
    c = mk_cov(client, auth_headers, source_note="s")
    before = c["updated_at"]
    r = client.patch(
        f"{COV}/{c['id']}",
        json={
            "name": "Renamed",
            "provider_type": "extended",
            "start_date": "2026-02-01",
            "end_date": "2032-02-01",
            "km_limit": 200000,
            "verification_status": "confirmed",
            "notes": "new",
        },
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert (out["name"], out["provider_type"], out["verification_status"]) == (
        "Renamed",
        "extended",
        "confirmed",
    )
    assert out["km_limit"] == 200000 and out["end_date"] == "2032-02-01"
    assert out["updated_at"] >= before and out["created_at"] == c["created_at"]
    nulls = client.patch(
        f"{COV}/{c['id']}",
        json={"end_date": None, "notes": None, "source_note": None},
        headers=auth_headers,
    )
    assert nulls.status_code == 200
    assert nulls.json()["end_date"] is None and nulls.json()["notes"] is None
    assert nulls.json()["source_note"] is None and nulls.json()["km_limit"] == 200000
    blank = client.patch(f"{COV}/{c['id']}", json={"notes": "  "}, headers=auth_headers)
    assert blank.json()["notes"] is None
    empty = client.patch(f"{COV}/{c['id']}", json={}, headers=auth_headers)
    assert empty.status_code == 200 and empty.json()["name"] == "Renamed"


def test_ac50_end_or_km_still_required_after_patch(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    c = mk_cov(client, auth_headers)
    r = client.patch(
        f"{COV}/{c['id']}", json={"end_date": None, "km_limit": None}, headers=auth_headers
    )
    assert r.status_code == 400 and set(fields(r)) == {"end_date", "km_limit"}
    only_km = mk_cov(client, auth_headers, end_date=None)
    r = client.patch(f"{COV}/{only_km['id']}", json={"km_limit": None}, headers=auth_headers)
    assert r.status_code == 400
    only_end = mk_cov(client, auth_headers, km_limit=None)
    r = client.patch(f"{COV}/{only_end['id']}", json={"end_date": None}, headers=auth_headers)
    assert r.status_code == 400
    got = client.get(f"{COV}/{only_end['id']}", headers=auth_headers).json()
    assert got["end_date"] == "2031-01-01"


def test_ac50_end_not_before_start_after_patch(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    c = mk_cov(client, auth_headers)
    r = client.patch(f"{COV}/{c['id']}", json={"start_date": "2031-01-02"}, headers=auth_headers)
    assert r.status_code == 400 and "end_date" in fields(r)
    r = client.patch(f"{COV}/{c['id']}", json={"end_date": "2025-12-31"}, headers=auth_headers)
    assert r.status_code == 400
    ok = client.patch(f"{COV}/{c['id']}", json={"end_date": "2026-01-01"}, headers=auth_headers)
    assert ok.status_code == 200


@pytest.mark.parametrize(
    "patch",
    [
        {"source_kind": "template"},
        {"template_ref": "x"},
        {"status": "expired"},
        {"claim_count": 1},
        {"id": new_id()},
        {"name": None},
        {"provider_type": None},
        {"start_date": None},
        {"verification_status": None},
        {"name": ""},
        {"km_limit": 0},
        {"km_limit": 2.5},
        {"notes": "a\x00"},
        {"provider": "x"},
    ],
)
def test_ac50_patch_rejections(
    client: TestClient, auth_headers: dict[str, str], patch: dict[str, Any]
) -> None:
    c = mk_cov(client, auth_headers)
    r = client.patch(f"{COV}/{c['id']}", json=patch, headers=auth_headers)
    assert r.status_code == 400
    assert client.get(f"{COV}/{c['id']}", headers=auth_headers).json()["name"] == c["name"]


def test_ac50_template_ref_immutable(client: TestClient, auth_headers: dict[str, str]) -> None:
    c = mk_cov(
        client,
        auth_headers,
        source_kind="template",
        verification_status="proposed",
        template_ref="my-factory-warranty:general",
    )
    assert c["template_ref"] == "my-factory-warranty:general"
    r = client.patch(f"{COV}/{c['id']}", json={"template_ref": None}, headers=auth_headers)
    assert r.status_code == 400 and fields(r) == ["template_ref"]
    ok = client.patch(
        f"{COV}/{c['id']}", json={"verification_status": "confirmed"}, headers=auth_headers
    )
    assert ok.json()["template_ref"] == "my-factory-warranty:general"
    assert ok.json()["source_kind"] == "template"


def test_ac50_unknown_id_404_and_delete(client: TestClient, auth_headers: dict[str, str]) -> None:
    missing = uuid.uuid4()
    assert (
        client.patch(f"{COV}/{missing}", json={"name": "x"}, headers=auth_headers).status_code
        == 404
    )
    assert client.patch(f"{COV}/{missing}", json={}, headers=auth_headers).status_code == 404
    assert client.get(f"{COV}/{missing}", headers=auth_headers).status_code == 404
    assert client.delete(f"{COV}/{missing}", headers=auth_headers).status_code == 404
    c = mk_cov(client, auth_headers)
    d = client.delete(f"{COV}/{c['id']}", headers=auth_headers)
    assert d.status_code == 204 and d.content == b""
    assert client.get(f"{COV}/{c['id']}", headers=auth_headers).status_code == 404
    assert client.delete(f"{COV}/{c['id']}", headers=auth_headers).status_code == 404
    assert client.get(f"{COV}/not-a-uuid", headers=auth_headers).status_code == 400


def test_ac50_delete_cascades_claims_and_claim_count(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    a = mk_cov(client, auth_headers, name="A")
    b = mk_cov(client, auth_headers, name="B")
    c1 = mk_clm(client, auth_headers, a["id"])
    mk_clm(client, auth_headers, a["id"])
    keep = mk_clm(client, auth_headers, b["id"])
    assert client.get(f"{COV}/{a['id']}", headers=auth_headers).json()["claim_count"] == 2
    counts = {
        i["name"]: i["claim_count"] for i in client.get(COV, headers=auth_headers).json()["items"]
    }
    assert counts == {"A": 2, "B": 1}
    assert client.delete(f"{COV}/{a['id']}", headers=auth_headers).status_code == 204
    assert client.get(f"{CLM}/{c1['id']}", headers=auth_headers).status_code == 404
    left = client.get(CLM, headers=auth_headers).json()["items"]
    assert [i["id"] for i in left] == [keep["id"]]
    # deleting one claim lowers the count
    assert client.delete(f"{CLM}/{keep['id']}", headers=auth_headers).status_code == 204
    assert client.get(f"{COV}/{b['id']}", headers=auth_headers).json()["claim_count"] == 0


# --- AC-51 / AC-52 --------------------------------------------------------------------------


def test_ac51_status_on_read_with_today_param(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    c = mk_cov(client, auth_headers, start_date="2026-01-01", end_date="2026-10-22", km_limit=None)
    url = f"{COV}/{c['id']}"
    on = client.get(url, params={"today": "2026-10-22"}, headers=auth_headers).json()
    assert on["status"] == "expiring_soon" and on["expiring_soon_by"] == ["date"]
    assert on["expired_by"] == []
    after = client.get(url, params={"today": "2026-10-23"}, headers=auth_headers).json()
    assert after["status"] == "expired" and after["expired_by"] == ["date"]
    assert after["expiring_soon_by"] == []
    early = client.get(url, params={"today": "2025-12-31"}, headers=auth_headers).json()
    assert early["status"] == "not_started"
    far = client.get(url, params={"today": "2026-01-02"}, headers=auth_headers).json()
    assert far["status"] == "active"
    listed = client.get(COV, params={"today": "2026-10-23"}, headers=auth_headers).json()
    assert listed["items"][0]["status"] == "expired"
    for bad in ("2026-13-01", "22-10-2026", "20261022", "", "abc", "1"):
        for path in (COV, url):
            r = client.get(path, params={"today": bad}, headers=auth_headers)
            assert r.status_code == 400, (bad, r.text)
            assert fields(r) == ["today"]


def test_ac51_today_defaults_to_kl_date(client: TestClient, auth_headers: dict[str, str]) -> None:
    kl = today_kl()
    end = kl + dt.timedelta(days=200)
    c = mk_cov(client, auth_headers, start_date=str(kl), end_date=str(end), km_limit=None)
    assert client.get(f"{COV}/{c['id']}", headers=auth_headers).json()["status"] == "active"
    yesterday = mk_cov(
        client,
        auth_headers,
        start_date="2020-01-01",
        end_date=str(kl - dt.timedelta(days=1)),
        km_limit=None,
    )
    assert (
        client.get(f"{COV}/{yesterday['id']}", headers=auth_headers).json()["status"] == "expired"
    )


def test_ac51_status_is_never_stored(client: TestClient, auth_headers: dict[str, str]) -> None:
    cols = {c.name for c in WarrantyCoverage.__table__.columns}
    assert not cols & {"status", "expired_by", "expiring_soon_by", "claim_count"}
    assert "claim_count" not in {c.name for c in WarrantyClaim.__table__.columns}


def test_ac52_current_odometer_shared_with_reminders(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    c = mk_cov(client, auth_headers, end_date="2031-01-01", km_limit=20000)
    listed = client.get(COV, params={"today": TODAY}, headers=auth_headers).json()
    assert listed["current_odometer"] is None
    assert listed["items"][0]["status"] == "active"  # odometer unknown: km skipped
    older = client.post(
        "/api/v1/service-records",
        json=record_body(date="2026-01-10", odometer=9000),
        headers=auth_headers,
    ).json()
    newest = client.post(
        "/api/v1/service-records",
        json=record_body(date="2026-03-10", odometer=20001),
        headers=auth_headers,
    ).json()
    listed = client.get(COV, params={"today": TODAY}, headers=auth_headers).json()
    assert listed["current_odometer"] == {
        "km": 20001,
        "source": "latest_service_record",
        "service_record_id": newest["id"],
        "date": "2026-03-10",
    }
    assert older["id"] != newest["id"]
    assert listed["items"][0]["status"] == "expired"
    assert listed["items"][0]["expired_by"] == ["odometer"]
    reminders = client.get("/api/v1/reminders", headers=auth_headers).json()
    assert reminders["current_odometer"] == listed["current_odometer"]
    one = client.get(f"{COV}/{c['id']}", params={"today": TODAY}, headers=auth_headers).json()
    assert one["status"] == "expired"


def test_ac52_claims_do_not_change_current_odometer(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    c = mk_cov(client, auth_headers)
    client.post("/api/v1/service-records", json=record_body(odometer=5000), headers=auth_headers)
    mk_clm(client, auth_headers, c["id"], odometer=99999, date="2026-10-01")
    cur = client.get(COV, headers=auth_headers).json()["current_odometer"]
    assert cur["km"] == 5000


def test_ac52_reminders_and_warranty_use_one_read() -> None:
    import inspect as pyinspect

    from app.services import reminders, warranty

    assert reminders.read_current_odometer is warranty.read_current_odometer
    assert "list_page" not in pyinspect.getsource(reminders)
    assert "list_page" not in pyinspect.getsource(warranty)


def test_list_order(client: TestClient, auth_headers: dict[str, str]) -> None:
    mk_cov(
        client,
        auth_headers,
        name="expired",
        start_date="2020-01-01",
        end_date="2021-01-01",
        km_limit=None,
    )
    mk_cov(
        client,
        auth_headers,
        name="future",
        start_date="2027-01-01",
        end_date="2030-01-01",
        km_limit=None,
    )
    mk_cov(client, auth_headers, name="active-late", end_date="2035-01-01", km_limit=None)
    mk_cov(client, auth_headers, name="active-early", end_date="2031-01-01", km_limit=None)
    mk_cov(client, auth_headers, name="active-km-only", end_date=None)
    mk_cov(client, auth_headers, name="soon", end_date="2026-12-01", km_limit=None)
    mk_cov(client, auth_headers, name="active-b", end_date="2031-01-01", km_limit=None)
    items = client.get(COV, params={"today": TODAY}, headers=auth_headers).json()["items"]
    assert [i["name"] for i in items] == [
        "soon",
        "active-b",
        "active-early",
        "active-late",
        "active-km-only",
        "future",
        "expired",
    ]


# --- AC-55 ----------------------------------------------------------------------------------


def test_ac55_template_content_exact(client: TestClient, auth_headers: dict[str, str]) -> None:
    r = client.get(TPL, headers=auth_headers)
    assert r.status_code == 200
    assert client.get(TPL, headers=auth_headers).json() == r.json()
    items = r.json()["items"]
    assert len(items) == 1
    t = items[0]
    assert t["id"] == "my-factory-warranty" and t["version"] == 1
    assert t["name"] == "Zeekr Malaysia factory warranty terms"
    assert t["source"] == {
        "title": "Zeekr Malaysia Warranty (PDF)",
        "url": "https://assets.zeekrlife.com/assets/my/Warranty.pdf",
        "research_ref": "M8, M9, M10",
        "status": "verified",
        "retrieved": "2026-10-22",
    }
    assert t["caveat"] == (
        "Terms, scope, exclusions and conditions vary by build date, usage and local rules. "
        "Confirm against your own warranty booklet or service centre."
    )
    assert t["baseline_required"] is True
    assert t["items"] == [
        {
            "key": "general",
            "name": "Vehicle warranty",
            "months": 60,
            "km": 150000,
            "research_ref": "M8",
        },
        {
            "key": "paint_corrosion",
            "name": "Paint and surface corrosion warranty",
            "months": 60,
            "km": 150000,
            "research_ref": "M8",
        },
        {
            "key": "powertrain",
            "name": "Electric powertrain warranty",
            "months": 96,
            "km": 160000,
            "research_ref": "M9",
        },
        {
            "key": "wear_short",
            "name": "Wear-and-tear cover (short)",
            "months": 6,
            "km": 10000,
            "research_ref": "M10",
        },
        {
            "key": "wear_long",
            "name": "Wear-and-tear cover (long)",
            "months": 12,
            "km": 20000,
            "research_ref": "M10",
        },
        {
            "key": "genuine_parts",
            "name": "Genuine replacement parts",
            "months": None,
            "km": None,
            "research_ref": "M10",
            "enter_manually": True,
        },
    ]


def test_ac55_template_has_no_parts_price_or_provider(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    t = client.get(TPL, headers=auth_headers).json()["items"][0]
    allowed_item = {"key", "name", "months", "km", "research_ref", "enter_manually"}
    for item in t["items"]:
        assert set(item) <= allowed_item
    assert set(t) == {"id", "version", "name", "source", "caveat", "baseline_required", "items"}
    blob = json.dumps(t).lower()
    for word in (
        "price",
        "myr",
        "excluded",
        "exclusion list",
        "brake pad",
        "wiper",
        "tyre",
        "provider",
        "certificate",
        "vin",
    ):
        assert word not in blob
    assert not any(k in t for k in ("parts", "covered", "excludes", "price"))
    assert t["items"][-1]["enter_manually"] is True


def test_ac55_no_coverage_created_by_events(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    assert client.get(COV, headers=auth_headers).json()["items"] == []
    client.get(TPL, headers=auth_headers)
    client.put(
        "/api/v1/vehicle",
        json={"model": "7X", "purchase_date": "2026-01-01"},
        headers=auth_headers,
    )
    client.post("/api/v1/service-records", json=record_body(), headers=auth_headers)
    assert client.get(COV, headers=auth_headers).json()["items"] == []
    assert client.get(CLM, headers=auth_headers).json()["items"] == []


def test_ac55_template_endpoint_is_read_only(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    for method in ("post", "put", "patch", "delete"):
        r = client.request(method, TPL, headers=auth_headers, json={})
        assert r.status_code == 405 and r.json()["error"]["code"] == "method_not_allowed"
    assert client.get(f"{TPL}/my-factory-warranty", headers=auth_headers).status_code == 404


def test_ac56_template_item_is_an_ordinary_coverage(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    c = mk_cov(
        client,
        auth_headers,
        name="Vehicle warranty",
        source_kind="template",
        verification_status="proposed",
        template_ref="my-factory-warranty:general",
        start_date="2026-01-01",
        end_date="2031-01-01",
        km_limit=150000,
    )
    assert (c["source_kind"], c["verification_status"], c["provider_type"]) == (
        "template",
        "proposed",
        "factory",
    )
    again = {k: c[k] for k in cov() if k in c}
    again["id"] = new_id()
    assert client.post(COV, json=again, headers=auth_headers).status_code == 201


# --- AC-57 ----------------------------------------------------------------------------------


def test_ac57_future_extended_coverage_leaves_factory_status(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    factory = mk_cov(
        client,
        auth_headers,
        name="Fictional factory",
        start_date="2021-01-01",
        end_date="2026-01-01",
    )
    before = client.get(
        f"{COV}/{factory['id']}", params={"today": TODAY}, headers=auth_headers
    ).json()
    ext = mk_cov(
        client,
        auth_headers,
        name="Fictional extension",
        provider_type="extended",
        start_date="2027-10-22",
        end_date="2030-10-22",
        km_limit=200000,
    )
    after = client.get(
        f"{COV}/{factory['id']}", params={"today": TODAY}, headers=auth_headers
    ).json()
    e = client.get(f"{COV}/{ext['id']}", params={"today": TODAY}, headers=auth_headers).json()
    assert e["status"] == "not_started" and e["expired_by"] == [] and e["expiring_soon_by"] == []
    assert after["status"] == before["status"] == "expired"
    assert after["expired_by"] == before["expired_by"] == ["date"]
    assert e["source_kind"] == "owner_entered" and e["template_ref"] is None


# --- AC-58 ----------------------------------------------------------------------------------


def test_ac58_create_get_replay_conflict(client: TestClient, auth_headers: dict[str, str]) -> None:
    c = mk_cov(client, auth_headers)
    b = clm(c["id"], cost_covered_minor=0)
    r = client.post(CLM, json=b, headers=auth_headers)
    assert r.status_code == 201
    out = r.json()
    for k, v in b.items():
        assert out[k] == v
    assert set(out) == {
        "id",
        "coverage_id",
        "date",
        "odometer",
        "description",
        "status",
        "cost_covered_minor",
        "currency",
        "notes",
        "created_at",
        "updated_at",
    }
    assert client.get(f"{CLM}/{b['id']}", headers=auth_headers).json() == out
    again = client.post(CLM, json=b, headers=auth_headers)
    assert again.status_code == 200 and again.json() == out
    assert len(client.get(CLM, headers=auth_headers).json()["items"]) == 1
    for change in ({"description": "Other"}, {"cost_covered_minor": 5}, {"status": "approved"}):
        x = client.post(CLM, json={**b, **change}, headers=auth_headers)
        assert x.status_code == 409 and x.json()["error"]["code"] == "conflict"


def test_ac58_defaults_and_null_cost(client: TestClient, auth_headers: dict[str, str]) -> None:
    c = mk_cov(client, auth_headers)
    b = clm(c["id"])
    del b["currency"], b["cost_covered_minor"], b["notes"]
    r = client.post(CLM, json=b, headers=auth_headers)
    assert r.status_code == 201
    assert r.json()["currency"] == "MYR" and r.json()["cost_covered_minor"] is None
    assert r.json()["notes"] is None


def test_ac58_unknown_coverage_is_400_on_coverage_id(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    r = client.post(CLM, json=clm(new_id()), headers=auth_headers)
    assert r.status_code == 400 and r.json()["error"]["code"] == "validation_error"
    assert fields(r) == ["coverage_id"]
    assert client.get(CLM, headers=auth_headers).json()["items"] == []
    # a replay of an existing claim after its coverage was deleted is a plain create again
    c = mk_cov(client, auth_headers)
    b = clm(c["id"])
    assert client.post(CLM, json=b, headers=auth_headers).status_code == 201
    client.delete(f"{COV}/{c['id']}", headers=auth_headers)
    again = client.post(CLM, json=b, headers=auth_headers)
    assert again.status_code == 400 and fields(again) == ["coverage_id"]


# --- AC-59 ----------------------------------------------------------------------------------


def _tomorrow() -> str:
    return str(today_kl() + dt.timedelta(days=1))


@pytest.mark.parametrize(
    ("change", "field"),
    [
        ({"date": None}, "date"),
        ({"date": "2026/09/01"}, "date"),
        ({"date": 20260901}, "date"),
        ({"date": "1999-12-31"}, "date"),
        ({"date": "2026-02-30"}, "date"),
        ({"odometer": -1}, "odometer"),
        ({"odometer": 10_000_001}, "odometer"),
        ({"odometer": 1.5}, "odometer"),
        ({"odometer": "100"}, "odometer"),
        ({"odometer": True}, "odometer"),
        ({"description": ""}, "description"),
        ({"description": "   "}, "description"),
        ({"description": "x" * 501}, "description"),
        ({"description": "a\x00b"}, "description"),
        ({"status": "pending"}, "status"),
        ({"status": None}, "status"),
        ({"cost_covered_minor": -1}, "cost_covered_minor"),
        ({"cost_covered_minor": 10**12 + 1}, "cost_covered_minor"),
        ({"cost_covered_minor": 1.5}, "cost_covered_minor"),
        ({"cost_covered_minor": "5"}, "cost_covered_minor"),
        ({"currency": "USD"}, "currency"),
        ({"notes": "x" * 5001}, "notes"),
        ({"notes": "a\x00"}, "notes"),
        ({"coverage_id": "nope"}, "coverage_id"),
        ({"coverage_id": None}, "coverage_id"),
        ({"expense_id": new_id()}, "expense_id"),
        ({"create_expense": True}, "create_expense"),
    ],
)
def test_ac59_validation(
    client: TestClient, auth_headers: dict[str, str], change: dict[str, Any], field: str
) -> None:
    c = mk_cov(client, auth_headers)
    r = client.post(CLM, json=clm(c["id"], **change), headers=auth_headers)
    assert r.status_code == 400, r.text
    assert field in fields(r)
    assert client.get(CLM, headers=auth_headers).json()["items"] == []


def test_ac59_future_date_uses_kl_and_missing_fields(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    c = mk_cov(client, auth_headers)
    r = client.post(CLM, json=clm(c["id"], date=_tomorrow()), headers=auth_headers)
    assert r.status_code == 400 and fields(r) == ["date"]
    ok = client.post(CLM, json=clm(c["id"], date=str(today_kl())), headers=auth_headers)
    assert ok.status_code == 201
    for missing in ("coverage_id", "date", "odometer", "description", "status", "id"):
        b = clm(c["id"])
        del b[missing]
        r = client.post(CLM, json=b, headers=auth_headers)
        assert r.status_code == 400 and missing in fields(r)


def test_ac59_accepted_edges_and_date_outside_coverage(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    c = mk_cov(client, auth_headers, start_date="2026-01-01", end_date="2026-06-01")
    for change in (
        {"date": "2000-01-01"},
        {"date": "2026-09-01"},  # after the coverage end
        {"odometer": 0},
        {"odometer": 10_000_000},
        {"cost_covered_minor": 0},
        {"cost_covered_minor": 10**12},
        {"cost_covered_minor": None},
        {"description": "d" * 500},
        {"notes": "n" * 5000},
        {"notes": "  "},
    ):
        r = client.post(CLM, json=clm(c["id"], **change), headers=auth_headers)
        assert r.status_code == 201, (change, r.text)
    for st in ("submitted", "approved", "rejected", "completed"):
        assert (
            client.post(CLM, json=clm(c["id"], status=st), headers=auth_headers).status_code == 201
        )


def test_ac59_cap_of_500_claims(
    client: TestClient, auth_headers: dict[str, str], database_url: str
) -> None:
    c = mk_cov(client, auth_headers)
    rows = [
        {"id": str(uuid.uuid4()), "cid": c["id"], "d": "2026-01-01"}
        for _ in range(schemas.MAX_WARRANTY_CLAIMS)
    ]
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(
            text(
                "INSERT INTO warranty_claim (id, coverage_id, date, odometer, description, status) "
                "VALUES (:id, :cid, :d, 1, 'seed', 'submitted')"
            ),
            rows,
        )
    over = client.post(CLM, json=clm(c["id"]), headers=auth_headers)
    assert over.status_code == 400 and fields(over) == ["body"]
    existing = client.get(CLM, headers=auth_headers).json()["items"][0]
    replay = {
        k: existing[k]
        for k in (
            "id",
            "coverage_id",
            "date",
            "odometer",
            "description",
            "status",
            "cost_covered_minor",
            "currency",
            "notes",
        )
    }
    assert client.post(CLM, json=replay, headers=auth_headers).status_code == 200
    assert len(client.get(CLM, headers=auth_headers).json()["items"]) == 500


# --- AC-60 ----------------------------------------------------------------------------------


def test_ac60_patch_including_status(client: TestClient, auth_headers: dict[str, str]) -> None:
    c = mk_cov(client, auth_headers)
    k = mk_clm(client, auth_headers, c["id"], cost_covered_minor=100)
    r = client.patch(
        f"{CLM}/{k['id']}",
        json={
            "status": "approved",
            "description": "Edited",
            "date": "2026-09-02",
            "odometer": 12500,
            "cost_covered_minor": 0,
            "notes": "later",
        },
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert (out["status"], out["description"], out["date"], out["odometer"]) == (
        "approved",
        "Edited",
        "2026-09-02",
        12500,
    )
    assert out["cost_covered_minor"] == 0 and out["coverage_id"] == c["id"]
    nulls = client.patch(
        f"{CLM}/{k['id']}", json={"cost_covered_minor": None, "notes": None}, headers=auth_headers
    )
    assert nulls.json()["cost_covered_minor"] is None and nulls.json()["notes"] is None
    assert client.patch(f"{CLM}/{k['id']}", json={}, headers=auth_headers).status_code == 200
    assert (
        client.patch(
            f"{CLM}/{uuid.uuid4()}", json={"status": "approved"}, headers=auth_headers
        ).status_code
        == 404
    )


@pytest.mark.parametrize(
    "patch",
    [
        {"coverage_id": new_id()},
        {"id": new_id()},
        {"status": "nope"},
        {"status": None},
        {"date": None},
        {"date": "2000-01-01x"},
        {"odometer": None},
        {"odometer": -1},
        {"description": ""},
        {"description": None},
        {"cost_covered_minor": -5},
        {"currency": "USD"},
        {"currency": None},
        {"notes": "a\x00"},
        {"create_expense": True},
    ],
)
def test_ac60_patch_rejections(
    client: TestClient, auth_headers: dict[str, str], patch: dict[str, Any]
) -> None:
    c = mk_cov(client, auth_headers)
    k = mk_clm(client, auth_headers, c["id"])
    r = client.patch(f"{CLM}/{k['id']}", json=patch, headers=auth_headers)
    assert r.status_code == 400
    assert client.get(f"{CLM}/{k['id']}", headers=auth_headers).json() == k


def test_ac60_patch_future_date_rejected(client: TestClient, auth_headers: dict[str, str]) -> None:
    c = mk_cov(client, auth_headers)
    k = mk_clm(client, auth_headers, c["id"])
    r = client.patch(f"{CLM}/{k['id']}", json={"date": _tomorrow()}, headers=auth_headers)
    assert r.status_code == 400 and fields(r) == ["date"]


def test_ac60_delete(client: TestClient, auth_headers: dict[str, str]) -> None:
    c = mk_cov(client, auth_headers)
    k = mk_clm(client, auth_headers, c["id"])
    d = client.delete(f"{CLM}/{k['id']}", headers=auth_headers)
    assert d.status_code == 204 and d.content == b""
    assert client.get(f"{CLM}/{k['id']}", headers=auth_headers).status_code == 404
    assert client.delete(f"{CLM}/{k['id']}", headers=auth_headers).status_code == 404
    assert client.get(f"{COV}/{c['id']}", headers=auth_headers).status_code == 200


def test_ac60_claim_order_and_filter(client: TestClient, auth_headers: dict[str, str]) -> None:
    a = mk_cov(client, auth_headers, name="A")
    b = mk_cov(client, auth_headers, name="B")
    old = mk_clm(client, auth_headers, a["id"], date="2026-01-01")
    new = mk_clm(client, auth_headers, a["id"], date="2026-08-01")
    tie1 = mk_clm(client, auth_headers, a["id"], date="2026-05-01")
    tie2 = mk_clm(client, auth_headers, a["id"], date="2026-05-01")
    other = mk_clm(client, auth_headers, b["id"], date="2026-09-01")
    ids = [
        i["id"]
        for i in client.get(CLM, params={"coverage_id": a["id"]}, headers=auth_headers).json()[
            "items"
        ]
    ]
    assert ids == [new["id"], tie2["id"], tie1["id"], old["id"]]
    everything = client.get(CLM, headers=auth_headers).json()["items"]
    assert everything[0]["id"] == other["id"] and len(everything) == 5
    assert client.get(CLM, params={"coverage_id": new_id()}, headers=auth_headers).json() == {
        "items": []
    }
    assert client.get(CLM, params={"coverage_id": "x"}, headers=auth_headers).status_code == 400


def test_ac60_claim_cost_has_no_expense_side_effect(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    client.post("/api/v1/service-records", json=record_body(), headers=auth_headers)
    rec_before = client.get("/api/v1/service-records", headers=auth_headers).json()
    c = mk_cov(client, auth_headers)
    k = mk_clm(client, auth_headers, c["id"], cost_covered_minor=123456)
    client.patch(
        f"{CLM}/{k['id']}",
        json={"cost_covered_minor": 999, "status": "completed"},
        headers=auth_headers,
    )
    assert client.get("/api/v1/expenses", headers=auth_headers).json()["items"] == []
    summary = client.get("/api/v1/expenses/summary", headers=auth_headers).json()
    assert summary["total_minor"] == 0 and summary["count"] == 0
    assert client.get("/api/v1/service-records", headers=auth_headers).json() == rec_before


# --- AC-66 / AC-67 --------------------------------------------------------------------------


def test_ac66_text_is_stored_literally(client: TestClient, auth_headers: dict[str, str]) -> None:
    xss = "<img src=x onerror=alert(1)>"
    c = mk_cov(client, auth_headers, name=xss, notes=xss, source_note=xss)
    k = mk_clm(client, auth_headers, c["id"], description=xss, notes=xss)
    got = client.get(f"{COV}/{c['id']}", headers=auth_headers).json()
    assert (got["name"], got["notes"], got["source_note"]) == (xss, xss, xss)
    gk = client.get(f"{CLM}/{k['id']}", headers=auth_headers).json()
    assert (gk["description"], gk["notes"]) == (xss, xss)


def test_ac67_no_provider_certificate_or_document_fields() -> None:
    banned = ("provider", "certificate", "serial", "document", "attachment", "vin", "plate")
    names = {c.name for c in WarrantyCoverage.__table__.columns}
    names |= {c.name for c in WarrantyClaim.__table__.columns}
    names |= set(schemas.WarrantyCoverageOut.model_fields) | set(
        schemas.WarrantyClaimOut.model_fields
    )
    names |= set(schemas.WarrantyCoverageCreate.model_fields) | set(
        schemas.WarrantyClaimCreate.model_fields
    )
    names |= set(schemas.WarrantyCoveragePatch.model_fields) | set(
        schemas.WarrantyClaimPatch.model_fields
    )
    for name in names:
        if name == "provider_type":
            continue
        assert not any(b in name.split("_") for b in banned), name
    # provider_type is the factory/extended enum, not a provider name
    assert schemas.WarrantyCoverageCreate.model_fields["provider_type"].annotation is not str


def test_ac67_no_reminder_is_created_from_warranty(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    mk_cov(client, auth_headers)
    assert client.get("/api/v1/reminders", headers=auth_headers).json()["items"] == []


# --- AC-68 ----------------------------------------------------------------------------------


def test_ac68_schema_matches_models(client: TestClient) -> None:
    insp = inspect(client.app.state.engine)  # type: ignore[attr-defined]
    assert {"warranty_coverage", "warranty_claim"} <= set(insp.get_table_names())
    fks = insp.get_foreign_keys("warranty_claim")
    assert len(fks) == 1
    assert fks[0]["referred_table"] == "warranty_coverage"
    assert fks[0]["options"]["ondelete"] == "CASCADE"


_COVERAGE_INSERT = text(
    "INSERT INTO warranty_coverage (id, name, provider_type, start_date, end_date, km_limit, "
    "source_kind, verification_status) VALUES (:id, :name, :pt, :sd, :ed, :km, :sk, :vs)"
)
_CLAIM_INSERT = text(
    "INSERT INTO warranty_claim (id, coverage_id, date, odometer, description, status) "
    "VALUES (gen_random_uuid(), gen_random_uuid(), '2026-01-01', 1, 'd', 'submitted')"
)


@pytest.mark.parametrize(
    "override",
    [
        {"pt": "dealer"},
        {"ed": None, "km": None},
        {"ed": dt.date(2025, 1, 1)},
        {"ed": None, "km": 0},
        {"ed": None, "km": 10_000_001},
        {"sd": dt.date(1999, 1, 1)},
        {"sk": "import"},
        {"vs": "verified"},
        {"name": ""},
    ],
)
def test_db_check_constraints_back_up_validation(
    client: TestClient, override: dict[str, Any]
) -> None:
    from sqlalchemy.exc import IntegrityError

    params: dict[str, Any] = {
        "id": uuid.uuid4(),
        "name": "n",
        "pt": "factory",
        "sd": dt.date(2026, 1, 1),
        "ed": dt.date(2027, 1, 1),
        "km": 1,
        "sk": "owner_entered",
        "vs": "unverified",
    }
    params.update(override)
    engine = client.app.state.engine  # type: ignore[attr-defined]
    with pytest.raises(IntegrityError, match="ck_warranty_coverage"), engine.begin() as conn:
        conn.execute(_COVERAGE_INSERT, params)


def test_db_claim_foreign_key(client: TestClient) -> None:
    from sqlalchemy.exc import IntegrityError

    engine = client.app.state.engine  # type: ignore[attr-defined]
    with pytest.raises(IntegrityError, match="fk_warranty_claim"), engine.begin() as conn:
        conn.execute(_CLAIM_INSERT)
