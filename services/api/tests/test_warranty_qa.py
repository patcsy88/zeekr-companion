"""Independent QA probes for the Warranty backend (FR-6; AC-48 to AC-68).

Written by QA from the contract and acceptance criteria, separate from tests/test_warranty.py.
Fictional data only. Tests marked xfail(strict=True) document a defect (QA-W<n>, see
docs/testing/qa-report-2026-10-23-warranty-backend.md); when the defect is fixed the strict
xfail fails and the marker must be removed.
"""

from __future__ import annotations

import datetime as dt
import threading
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, text
from sqlalchemy.exc import DataError, IntegrityError

from app import schemas
from app.cli.export_openapi import build_schema
from app.clock import today_kl
from tests.conftest import new_id, record_body

COV = "/api/v1/warranty-coverages"
CLM = "/api/v1/warranty-claims"
TPL = "/api/v1/warranty-templates"
EXP = "/api/v1/expenses"
SR = "/api/v1/service-records"
JSON_CT = {"content-type": "application/json"}
TODAY = "2026-10-22"


def cov(**overrides: Any) -> dict[str, Any]:
    b: dict[str, Any] = {
        "id": new_id(),
        "name": "Sample warranty",
        "provider_type": "factory",
        "start_date": "2026-01-01",
        "end_date": "2031-01-01",
        "km_limit": 150000,
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
    }
    b.update(overrides)
    return b


def mk_cov(client: TestClient, h: dict[str, str], **o: Any) -> dict[str, Any]:
    r = client.post(COV, json=cov(**o), headers=h)
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def mk_clm(client: TestClient, h: dict[str, str], cid: str, **o: Any) -> dict[str, Any]:
    r = client.post(CLM, json=clm(cid, **o), headers=h)
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def fields(r: Any) -> list[str]:
    return [d["field"] for d in r.json()["error"]["details"]]


def utc(*a: int) -> dt.datetime:
    return dt.datetime(*a, tzinfo=dt.UTC)


def freeze(monkeypatch: pytest.MonkeyPatch, instant: dt.datetime) -> None:
    monkeypatch.setattr(schemas, "today_kl", lambda: today_kl(instant))


def count_rows(client: TestClient, table: str) -> int:
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        return int(conn.execute(text(f"SELECT count(*) FROM {table}")).scalar_one())  # noqa: S608


def raw_post(client: TestClient, h: dict[str, str], path: str, raw: str) -> Any:
    return client.post(path, content=raw.encode(), headers={**h, **JSON_CT})


def quiet(client: TestClient) -> TestClient:
    return TestClient(client.app, raise_server_exceptions=False)


# --- AC-64: 401 on every route ---------------------------------------------------------------

_ROUTES = [
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
    ("get", f"{COV}/not-a-uuid"),
    ("get", f"{COV}?today=garbage"),
    ("get", f"{CLM}?coverage_id=garbage"),
]


@pytest.mark.parametrize(("method", "path"), _ROUTES)
@pytest.mark.parametrize(
    "auth",
    [None, "", "Bearer", "Bearer ", "Bearer wrong", "Bearer a.b.c", "Basic dTpw", "Token x"],
)
def test_ac64_401_before_validation_and_404(
    client: TestClient, method: str, path: str, auth: str | None
) -> None:
    headers = {"Authorization": auth} if auth is not None else {}
    kwargs: dict[str, Any] = {"json": {"bogus": 1}} if method in ("post", "patch") else {}
    r = client.request(method, path, headers=headers, **kwargs)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthenticated"
    assert r.headers["www-authenticate"].startswith("Bearer")


def test_ac64_tampered_token_is_401_on_every_route(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    tok = auth_headers["Authorization"]
    bad = {"Authorization": tok[:-2] + ("AA" if not tok.endswith("AA") else "BB")}
    for method, path in _ROUTES:
        assert client.request(method, path, headers=bad).status_code == 401, (method, path)


# --- AC-48: replay / conflict per field ------------------------------------------------------

_BASE = {
    "notes": "n",
    "source_note": "s",
    "source_kind": "owner_entered",
    "verification_status": "unverified",
}


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("name", "Other"),
        ("provider_type", "extended"),
        ("start_date", "2026-01-02"),
        ("end_date", "2031-01-02"),
        ("end_date", None),
        ("km_limit", 150001),
        ("km_limit", None),
        ("notes", "m"),
        ("notes", None),
        ("source_kind", "template"),
        ("verification_status", "confirmed"),
        ("source_note", "t"),
        ("source_note", None),
    ],
)
def test_ac48_conflict_on_every_content_field(
    client: TestClient, auth_headers: dict[str, str], field: str, value: Any
) -> None:
    b = cov(**_BASE)
    assert client.post(COV, json=b, headers=auth_headers).status_code == 201
    r = client.post(COV, json={**b, field: value}, headers=auth_headers)
    assert r.status_code == 409, (field, r.text)
    assert r.json()["error"]["code"] == "conflict"
    assert count_rows(client, "warranty_coverage") == 1
    got = client.get(f"{COV}/{b['id']}", headers=auth_headers).json()
    assert got[field] == b[field]


def test_ac48_conflict_on_template_ref(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = cov(source_kind="template", template_ref="my-factory-warranty:general")
    assert client.post(COV, json=b, headers=auth_headers).status_code == 201
    for ref in ("my-factory-warranty:powertrain", None):
        r = client.post(COV, json={**b, "template_ref": ref}, headers=auth_headers)
        assert r.status_code == 409, ref
    assert client.post(COV, json=b, headers=auth_headers).status_code == 200


def test_ac48_missing_optional_equals_explicit_null_on_replay(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = {
        "id": new_id(),
        "name": "x",
        "provider_type": "factory",
        "start_date": "2026-01-01",
        "end_date": "2031-01-01",
    }
    assert client.post(COV, json=b, headers=auth_headers).status_code == 201
    full = {**b, "km_limit": None, "notes": None, "source_note": None, "template_ref": None}
    assert client.post(COV, json=full, headers=auth_headers).status_code == 200
    explicit_defaults = {
        **full,
        "source_kind": "owner_entered",
        "verification_status": "unverified",
    }
    assert client.post(COV, json=explicit_defaults, headers=auth_headers).status_code == 200


def test_ac48_missing_vs_present_value_conflicts(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = cov(notes="keep", source_note="src")
    assert client.post(COV, json=b, headers=auth_headers).status_code == 201
    for k in ("notes", "source_note", "km_limit", "end_date"):
        partial = {x: y for x, y in b.items() if x != k}
        assert client.post(COV, json=partial, headers=auth_headers).status_code == 409, k


@pytest.mark.parametrize("blank", ["", "   ", "\n\t "])
def test_ac48_blank_text_normalises_to_null_and_replays(
    client: TestClient, auth_headers: dict[str, str], blank: str
) -> None:
    b = cov(notes=blank, source_note=blank)
    r = client.post(COV, json=b, headers=auth_headers)
    assert r.status_code == 201
    assert r.json()["notes"] is None
    assert r.json()["source_note"] is None
    assert client.post(COV, json={**b, "notes": None, "source_note": None}, headers=auth_headers)
    again = client.post(COV, json={**b, "notes": None, "source_note": ""}, headers=auth_headers)
    assert again.status_code == 200


def test_ac48_blank_template_ref_is_null_and_does_not_need_template_kind(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    r = client.post(COV, json=cov(template_ref="   "), headers=auth_headers)
    assert r.status_code == 201
    assert r.json()["template_ref"] is None


def test_ac48_replay_after_trim_and_after_patch(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = cov(name="  padded  ")
    assert client.post(COV, json=b, headers=auth_headers).json()["name"] == "padded"
    assert client.post(COV, json={**b, "name": "padded"}, headers=auth_headers).status_code == 200
    client.patch(f"{COV}/{b['id']}", json={"name": "changed"}, headers=auth_headers)
    assert client.post(COV, json=b, headers=auth_headers).status_code == 409


def test_ac48_replay_does_not_bump_updated_at_or_claim_count(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = cov()
    first = client.post(COV, json=b, headers=auth_headers).json()
    mk_clm(client, auth_headers, b["id"])
    again = client.post(COV, json=b, headers=auth_headers)
    assert again.status_code == 200
    assert again.json()["updated_at"] == first["updated_at"]
    assert again.json()["claim_count"] == 1


def test_ac48_delete_then_recreate_same_id_is_201(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = cov()
    client.post(COV, json=b, headers=auth_headers)
    assert client.delete(f"{COV}/{b['id']}", headers=auth_headers).status_code == 204
    assert client.post(COV, json=b, headers=auth_headers).status_code == 201


def test_ac48_uppercase_id_is_same_row(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = cov()
    assert client.post(COV, json=b, headers=auth_headers).status_code == 201
    up = {**b, "id": b["id"].upper()}
    assert client.post(COV, json=up, headers=auth_headers).status_code == 200
    assert client.get(f"{COV}/{b['id'].upper()}", headers=auth_headers).status_code == 200


@pytest.mark.parametrize("bad", [None, "", "abc", 5, [], {}, "0" * 36, new_id() + "0"])
def test_ac48_bad_ids_rejected(client: TestClient, auth_headers: dict[str, str], bad: Any) -> None:
    r = client.post(COV, json=cov(id=bad), headers=auth_headers)
    assert r.status_code == 400
    assert "id" in fields(r)


def test_ac48_missing_id_rejected(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = cov()
    del b["id"]
    r = client.post(COV, json=b, headers=auth_headers)
    assert r.status_code == 400
    assert "id" in fields(r)


def test_ac48_concurrent_identical_creates_one_201(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = cov()
    codes: list[int] = []
    tc = quiet(client)

    def go() -> None:
        codes.append(tc.post(COV, json=b, headers=auth_headers).status_code)

    ts = [threading.Thread(target=go) for _ in range(8)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sorted(codes) == [200] * 7 + [201], codes
    assert count_rows(client, "warranty_coverage") == 1


def test_ac48_concurrent_conflicting_creates_one_winner(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    i = new_id()
    codes: list[int] = []
    tc = quiet(client)

    def go(n: int) -> None:
        codes.append(tc.post(COV, json=cov(id=i, name=f"n{n}"), headers=auth_headers).status_code)

    ts = [threading.Thread(target=go, args=(n,)) for n in range(8)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert codes.count(201) == 1
    assert set(codes) <= {201, 409}, codes
    assert count_rows(client, "warranty_coverage") == 1


# --- AC-49: coverage validation ---------------------------------------------------------------


def _bad(client: TestClient, h: dict[str, str], field: str, **o: Any) -> None:
    before = count_rows(client, "warranty_coverage")
    r = client.post(COV, json=cov(**o), headers=h)
    assert r.status_code == 400, (o, r.text)
    assert r.json()["error"]["code"] == "validation_error"
    assert field in fields(r), (o, fields(r))
    assert count_rows(client, "warranty_coverage") == before


@pytest.mark.parametrize("km", [0, -1, 10_000_001, 2**31, 10**30])
def test_ac49_km_limit_out_of_range(
    client: TestClient, auth_headers: dict[str, str], km: int
) -> None:
    _bad(client, auth_headers, "km_limit", km_limit=km)


@pytest.mark.parametrize("km", [1, 10, 10_000_000])
def test_ac49_km_limit_boundaries_accepted(
    client: TestClient, auth_headers: dict[str, str], km: int
) -> None:
    c = mk_cov(client, auth_headers, km_limit=km)
    assert client.get(f"{COV}/{c['id']}", headers=auth_headers).json()["km_limit"] == km


@pytest.mark.parametrize(
    "raw", ["true", "false", "1.0", "1e3", '"100"', "[1]", "{}", "NaN", "Infinity", "-0.5", "1.5"]
)
def test_ac49_km_limit_not_a_strict_integer(
    client: TestClient, auth_headers: dict[str, str], raw: str
) -> None:
    i = new_id()
    content = (
        f'{{"id":"{i}","name":"n","provider_type":"factory","start_date":"2026-01-01",'
        f'"km_limit":{raw}}}'
    )
    r = raw_post(client, auth_headers, COV, content)
    assert r.status_code == 400, raw
    assert "km_limit" in fields(r)
    assert count_rows(client, "warranty_coverage") == 0


def test_ac49_km_limit_giant_integer_is_400_not_500(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    content = (
        f'{{"id":"{new_id()}","name":"n","provider_type":"factory",'
        f'"start_date":"2026-01-01","km_limit":{"9" * 300}}}'
    )
    assert raw_post(quiet(client), auth_headers, COV, content).status_code == 400


@pytest.mark.parametrize(
    ("start", "ok"),
    [
        ("1999-12-31", False),
        ("2000-01-01", True),
        ("2200-12-31", True),
        ("2201-01-01", False),
        ("0001-01-01", False),
        ("9999-12-31", False),
    ],
)
def test_ac49_start_date_range(
    client: TestClient, auth_headers: dict[str, str], start: str, ok: bool
) -> None:
    r = client.post(COV, json=cov(start_date=start, end_date=None), headers=auth_headers)
    assert r.status_code == (201 if ok else 400), (start, r.text)
    if not ok:
        assert "start_date" in fields(r)


@pytest.mark.parametrize(
    ("end", "ok"),
    [("1999-12-31", False), ("2000-01-01", True), ("2200-12-31", True), ("2201-01-01", False)],
)
def test_ac49_end_date_range(
    client: TestClient, auth_headers: dict[str, str], end: str, ok: bool
) -> None:
    r = client.post(COV, json=cov(start_date="2000-01-01", end_date=end), headers=auth_headers)
    assert r.status_code == (201 if ok else 400), (end, r.text)
    if not ok:
        assert "end_date" in fields(r)


@pytest.mark.parametrize(
    "d",
    [
        "2026-02-30",
        "2026-13-01",
        "2026-00-10",
        "2026-04-31",
        "2025-02-29",
        "2026-1-5",
        "2026/01/01",
        "20260101",
        "2026-01-01T00:00:00",
        "2026-01-01T00:00:00Z",
        " 2026-01-01",
        "2026-01-01 ",
        "",
        "today",
        "\u0662\u0660\u0662\u0666-01-01",
        "2026-01-01\n",
    ],
)
@pytest.mark.parametrize("which", ["start_date", "end_date"])
def test_ac49_malformed_dates(
    client: TestClient, auth_headers: dict[str, str], d: str, which: str
) -> None:
    o: dict[str, Any] = {which: d}
    if which == "end_date":
        o["km_limit"] = 5
    r = client.post(COV, json=cov(**o), headers=auth_headers)
    if r.status_code == 201:
        # tolerated only when the server normalised surrounding whitespace to the same date
        assert r.json()[which] == "2026-01-01"
        assert d.strip() == "2026-01-01"
    else:
        assert r.status_code == 400
        assert which in fields(r)


@pytest.mark.parametrize("d", [20260101, 1.5, True, [], {}, None])
def test_ac49_non_string_start_date(
    client: TestClient, auth_headers: dict[str, str], d: Any
) -> None:
    _bad(client, auth_headers, "start_date", start_date=d)


@pytest.mark.parametrize("d", [20260101, 1.5, True, [], {}])
def test_ac49_non_string_end_date(client: TestClient, auth_headers: dict[str, str], d: Any) -> None:
    _bad(client, auth_headers, "end_date", end_date=d)


def test_ac49_start_date_missing(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = cov()
    del b["start_date"]
    r = client.post(COV, json=b, headers=auth_headers)
    assert r.status_code == 400
    assert "start_date" in fields(r)


def test_ac49_end_before_start_and_equal(client: TestClient, auth_headers: dict[str, str]) -> None:
    _bad(client, auth_headers, "end_date", start_date="2026-05-02", end_date="2026-05-01")
    c = mk_cov(client, auth_headers, start_date="2026-05-01", end_date="2026-05-01", km_limit=None)
    assert c["end_date"] == "2026-05-01"


def test_ac49_end_and_km_both_null_names_both(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    for o in ({"end_date": None, "km_limit": None},):
        r = client.post(COV, json=cov(**o), headers=auth_headers)
        assert r.status_code == 400
        assert set(fields(r)) >= {"end_date", "km_limit"}
    b = cov()
    del b["end_date"]
    del b["km_limit"]
    r = client.post(COV, json=b, headers=auth_headers)
    assert r.status_code == 400
    assert set(fields(r)) >= {"end_date", "km_limit"}


def test_ac49_end_only_and_km_only_accepted(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    a = mk_cov(client, auth_headers, km_limit=None)
    b = mk_cov(client, auth_headers, end_date=None)
    assert a["km_limit"] is None
    assert b["end_date"] is None


def test_ac49_future_start_and_past_end_accepted(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    assert mk_cov(client, auth_headers, start_date="2150-01-01", end_date="2160-01-01")
    assert mk_cov(client, auth_headers, start_date="2001-01-01", end_date="2002-01-01")


@pytest.mark.parametrize("n", [1, 200])
def test_ac49_name_length_ok(client: TestClient, auth_headers: dict[str, str], n: int) -> None:
    assert mk_cov(client, auth_headers, name="a" * n)["name"] == "a" * n


@pytest.mark.parametrize("name", ["a" * 201, "", " ", "   \t\n", "\u00a0", "\u3000"])
def test_ac49_name_invalid(client: TestClient, auth_headers: dict[str, str], name: str) -> None:
    r = client.post(COV, json=cov(name=name), headers=auth_headers)
    if r.status_code == 201:
        pytest.fail(f"name {name!r} accepted as {r.json()['name']!r}")
    assert r.status_code == 400
    assert "name" in fields(r)


def test_ac49_name_201_chars_after_trim_boundary(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    assert mk_cov(client, auth_headers, name=" " + "a" * 200 + " ")["name"] == "a" * 200
    r = client.post(COV, json=cov(name=" " + "a" * 201 + " "), headers=auth_headers)
    assert r.status_code == 400
    assert "name" in fields(r)


def test_ac49_name_200_emoji_by_characters_not_bytes(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    assert mk_cov(client, auth_headers, name="\U0001f697" * 200)
    _bad(client, auth_headers, "name", name="\U0001f697" * 201)


@pytest.mark.parametrize("name", [None, 5, True, [], {}])
def test_ac49_name_wrong_type(client: TestClient, auth_headers: dict[str, str], name: Any) -> None:
    _bad(client, auth_headers, "name", name=name)


@pytest.mark.parametrize("field", ["name", "notes", "source_note", "template_ref"])
@pytest.mark.parametrize("where", ["start", "middle", "end"])
def test_ac49_nul_anywhere_rejected(
    client: TestClient, auth_headers: dict[str, str], field: str, where: str
) -> None:
    v = {"start": "\x00abc", "middle": "ab\x00c", "end": "abc\x00"}[where]
    o: dict[str, Any] = {field: v}
    if field == "template_ref":
        o["source_kind"] = "template"
    r = quiet(client).post(COV, json=cov(**o), headers=auth_headers)
    assert r.status_code == 400, (field, where, r.text)
    assert field in fields(r)


def test_ac49_nul_via_escape_in_raw_json(client: TestClient, auth_headers: dict[str, str]) -> None:
    content = (
        f'{{"id":"{new_id()}","name":"a\\u0000b","provider_type":"factory",'
        f'"start_date":"2026-01-01","km_limit":5}}'
    )
    assert raw_post(quiet(client), auth_headers, COV, content).status_code == 400


def test_ac49_lone_surrogate_is_400(client: TestClient, auth_headers: dict[str, str]) -> None:
    content = (
        f'{{"id":"{new_id()}","name":"a\\ud800b","provider_type":"factory",'
        f'"start_date":"2026-01-01","km_limit":5}}'
    )
    assert raw_post(quiet(client), auth_headers, COV, content).status_code == 400


@pytest.mark.parametrize(
    ("field", "n", "ok"),
    [
        ("notes", 5000, True),
        ("notes", 5001, False),
        ("source_note", 200, True),
        ("source_note", 201, False),
    ],
)
def test_ac49_text_length_boundaries(
    client: TestClient, auth_headers: dict[str, str], field: str, n: int, ok: bool
) -> None:
    r = client.post(COV, json=cov(**{field: "x" * n}), headers=auth_headers)
    assert r.status_code == (201 if ok else 400)
    if not ok:
        assert field in fields(r)


@pytest.mark.parametrize(("n", "ok"), [(100, True), (101, False)])
def test_ac49_template_ref_length(
    client: TestClient, auth_headers: dict[str, str], n: int, ok: bool
) -> None:
    r = client.post(
        COV, json=cov(source_kind="template", template_ref="x" * n), headers=auth_headers
    )
    assert r.status_code == (201 if ok else 400)


def test_ac49_template_ref_requires_template_kind(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    r = client.post(COV, json=cov(template_ref="my-factory-warranty:general"), headers=auth_headers)
    assert r.status_code == 400
    assert "template_ref" in fields(r)
    r = client.post(
        COV,
        json=cov(source_kind="owner_entered", template_ref="my-factory-warranty:general"),
        headers=auth_headers,
    )
    assert r.status_code == 400
    ok = client.post(
        COV,
        json=cov(source_kind="template", template_ref="my-factory-warranty:general"),
        headers=auth_headers,
    )
    assert ok.status_code == 201
    no_ref = client.post(COV, json=cov(source_kind="template"), headers=auth_headers)
    assert no_ref.status_code == 201
    assert no_ref.json()["template_ref"] is None


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("provider_type", "dealer"),
        ("provider_type", "Factory"),
        ("provider_type", "FACTORY"),
        ("provider_type", " factory"),
        ("provider_type", ""),
        ("provider_type", None),
        ("provider_type", 1),
        ("source_kind", "import"),
        ("source_kind", "Template"),
        ("source_kind", None),
        ("verification_status", "verified"),
        ("verification_status", "Confirmed"),
        ("verification_status", None),
    ],
)
def test_ac49_enums_rejected(
    client: TestClient, auth_headers: dict[str, str], field: str, value: Any
) -> None:
    _bad(client, auth_headers, field, **{field: value})


def test_ac49_provider_type_missing(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = cov()
    del b["provider_type"]
    r = client.post(COV, json=b, headers=auth_headers)
    assert r.status_code == 400
    assert "provider_type" in fields(r)


@pytest.mark.parametrize(
    "extra",
    [
        {"status": "active"},
        {"status": "expired"},
        {"claim_count": 3},
        {"expired_by": ["date"]},
        {"expiring_soon_by": []},
        {"created_at": "2026-01-01T00:00:00Z"},
        {"updated_at": "2026-01-01T00:00:00Z"},
        {"provider": "Some Provider"},
        {"certificate_number": "X1"},
        {"attachments": []},
        {"Name": "case"},
        {"": 1},
    ],
)
def test_ac49_unknown_fields_rejected_on_create(
    client: TestClient, auth_headers: dict[str, str], extra: dict[str, Any]
) -> None:
    r = client.post(COV, json={**cov(), **extra}, headers=auth_headers)
    assert r.status_code == 400
    assert count_rows(client, "warranty_coverage") == 0


def test_ac49_non_object_bodies(client: TestClient, auth_headers: dict[str, str]) -> None:
    for raw in ("[]", "null", '"x"', "5", "", "{", "{}"):
        r = raw_post(quiet(client), auth_headers, COV, raw)
        assert r.status_code == 400, raw


def test_ac49_oversized_body_is_400(client: TestClient, auth_headers: dict[str, str]) -> None:
    big = f'{{"id":"{new_id()}","notes":"{"x" * 70_000}"}}'
    r = raw_post(client, auth_headers, COV, big)
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "validation_error"
    r = raw_post(client, auth_headers, CLM, big)
    assert r.status_code == 400


def test_ac49_cap_50_with_replay_at_cap(client: TestClient, auth_headers: dict[str, str]) -> None:
    made = [mk_cov(client, auth_headers, name=f"c{n:02d}") for n in range(50)]
    r = client.post(COV, json=cov(), headers=auth_headers)
    assert r.status_code == 400
    assert fields(r) == ["body"]
    replay = cov(id=made[0]["id"], name="c00")
    assert client.post(COV, json=replay, headers=auth_headers).status_code == 200
    conflict = cov(id=made[0]["id"], name="different")
    assert client.post(COV, json=conflict, headers=auth_headers).status_code == 409
    assert (
        client.patch(
            f"{COV}/{made[1]['id']}", json={"name": "renamed"}, headers=auth_headers
        ).status_code
        == 200
    )
    assert client.delete(f"{COV}/{made[2]['id']}", headers=auth_headers).status_code == 204
    assert client.post(COV, json=cov(), headers=auth_headers).status_code == 201
    assert count_rows(client, "warranty_coverage") == 50


def test_ac49_field_errors_beat_cap_error(client: TestClient, auth_headers: dict[str, str]) -> None:
    for n in range(50):
        mk_cov(client, auth_headers, name=f"c{n:02d}")
    r = client.post(COV, json=cov(name=""), headers=auth_headers)
    assert r.status_code == 400
    assert "name" in fields(r)
    assert "body" not in fields(r)


# --- AC-50: PATCH -----------------------------------------------------------------------------


def _patch(client: TestClient, h: dict[str, str], cid: str, body: Any) -> Any:
    return client.patch(f"{COV}/{cid}", json=body, headers=h)


@pytest.mark.parametrize(
    "body",
    [
        {"source_kind": "template"},
        {"source_kind": "owner_entered"},
        {"template_ref": "x"},
        {"template_ref": None},
        {"coverage_id": new_id()},
        {"id": new_id()},
        {"status": "expired"},
        {"claim_count": 9},
        {"expired_by": ["date"]},
        {"expiring_soon_by": ["date"]},
        {"created_at": "2026-01-01T00:00:00Z"},
        {"updated_at": "2026-01-01T00:00:00Z"},
        {"provider": "x"},
    ],
)
def test_ac50_patch_unknown_or_immutable_fields_are_400(
    client: TestClient, auth_headers: dict[str, str], body: dict[str, Any]
) -> None:
    c = mk_cov(client, auth_headers, source_kind="template", template_ref="my-factory-warranty:x")
    r = _patch(client, auth_headers, c["id"], body)
    assert r.status_code == 400, body
    assert r.json()["error"]["code"] == "validation_error"
    after = client.get(f"{COV}/{c['id']}", headers=auth_headers).json()
    assert after["updated_at"] == c["updated_at"]
    assert after["source_kind"] == "template"
    assert after["template_ref"] == "my-factory-warranty:x"


@pytest.mark.parametrize("field", ["name", "provider_type", "start_date", "verification_status"])
def test_ac50_patch_null_rejected_for_non_nullable(
    client: TestClient, auth_headers: dict[str, str], field: str
) -> None:
    c = mk_cov(client, auth_headers)
    r = _patch(client, auth_headers, c["id"], {field: None})
    assert r.status_code == 400
    assert field in fields(r)


@pytest.mark.parametrize("field", ["end_date", "km_limit", "notes", "source_note"])
def test_ac50_patch_null_allowed_for_nullable_when_rule_holds(
    client: TestClient, auth_headers: dict[str, str], field: str
) -> None:
    c = mk_cov(client, auth_headers, notes="n", source_note="s")
    r = _patch(client, auth_headers, c["id"], {field: None})
    assert r.status_code == 200, r.text
    assert r.json()[field] is None


def test_ac50_patch_null_one_then_both(client: TestClient, auth_headers: dict[str, str]) -> None:
    c = mk_cov(client, auth_headers)
    assert _patch(client, auth_headers, c["id"], {"end_date": None}).status_code == 200
    r = _patch(client, auth_headers, c["id"], {"km_limit": None})
    assert r.status_code == 400
    assert set(fields(r)) >= {"end_date", "km_limit"}
    got = client.get(f"{COV}/{c['id']}", headers=auth_headers).json()
    assert got["km_limit"] == 150000
    assert got["end_date"] is None


def test_ac50_patch_null_both_in_one_request(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    c = mk_cov(client, auth_headers)
    r = _patch(client, auth_headers, c["id"], {"end_date": None, "km_limit": None})
    assert r.status_code == 400
    assert set(fields(r)) >= {"end_date", "km_limit"}


def test_ac50_patch_null_one_while_setting_other(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    c = mk_cov(client, auth_headers, km_limit=None)
    r = _patch(client, auth_headers, c["id"], {"end_date": None, "km_limit": 100})
    assert r.status_code == 200
    assert r.json()["end_date"] is None
    assert r.json()["km_limit"] == 100


def test_ac50_patch_only_end_before_start(client: TestClient, auth_headers: dict[str, str]) -> None:
    c = mk_cov(client, auth_headers, start_date="2026-05-01", end_date="2026-06-01")
    r = _patch(client, auth_headers, c["id"], {"end_date": "2026-04-30"})
    assert r.status_code == 400
    assert "end_date" in fields(r)
    assert _patch(client, auth_headers, c["id"], {"end_date": "2026-05-01"}).status_code == 200


def test_ac50_patch_only_start_after_end(client: TestClient, auth_headers: dict[str, str]) -> None:
    c = mk_cov(client, auth_headers, start_date="2026-05-01", end_date="2026-06-01")
    r = _patch(client, auth_headers, c["id"], {"start_date": "2026-06-02"})
    assert r.status_code == 400
    assert "end_date" in fields(r)
    assert _patch(client, auth_headers, c["id"], {"start_date": "2026-06-01"}).status_code == 200


def test_ac50_patch_start_after_end_ok_when_end_is_null(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    c = mk_cov(client, auth_headers, end_date=None)
    assert _patch(client, auth_headers, c["id"], {"start_date": "2150-01-01"}).status_code == 200


def test_ac50_patch_both_dates_together_fixes_order(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    c = mk_cov(client, auth_headers, start_date="2026-05-01", end_date="2026-06-01")
    r = _patch(
        client, auth_headers, c["id"], {"start_date": "2030-01-01", "end_date": "2030-02-01"}
    )
    assert r.status_code == 200


@pytest.mark.parametrize(
    "body",
    [
        {"km_limit": 0},
        {"km_limit": 10_000_001},
        {"km_limit": True},
        {"km_limit": 1.0},
        {"km_limit": "5"},
        {"start_date": "1999-12-31"},
        {"start_date": "2201-01-01"},
        {"end_date": "2201-01-01"},
        {"end_date": "2026-02-30"},
        {"end_date": "2026-01-01T00:00:00"},
        {"name": ""},
        {"name": "   "},
        {"name": "a" * 201},
        {"name": "a\x00"},
        {"notes": "x" * 5001},
        {"notes": "a\x00"},
        {"source_note": "x" * 201},
        {"provider_type": "dealer"},
        {"verification_status": "verified"},
    ],
)
def test_ac50_patch_validation(
    client: TestClient, auth_headers: dict[str, str], body: dict[str, Any]
) -> None:
    c = mk_cov(client, auth_headers)
    r = quiet(client).patch(f"{COV}/{c['id']}", json=body, headers=auth_headers)
    assert r.status_code == 400, body
    assert (
        client.get(f"{COV}/{c['id']}", headers=auth_headers).json()["updated_at"] == c["updated_at"]
    )


@pytest.mark.parametrize(
    ("body", "key", "value"),
    [
        ({"km_limit": 1}, "km_limit", 1),
        ({"km_limit": 10_000_000}, "km_limit", 10_000_000),
        ({"start_date": "2000-01-01"}, "start_date", "2000-01-01"),
        ({"end_date": "2200-12-31"}, "end_date", "2200-12-31"),
        ({"name": "a" * 200}, "name", "a" * 200),
        ({"name": "  trimmed "}, "name", "trimmed"),
        ({"notes": ""}, "notes", None),
        ({"notes": "   "}, "notes", None),
        ({"source_note": ""}, "source_note", None),
        ({"provider_type": "extended"}, "provider_type", "extended"),
        ({"verification_status": "confirmed"}, "verification_status", "confirmed"),
    ],
)
def test_ac50_patch_accepted(
    client: TestClient, auth_headers: dict[str, str], body: dict[str, Any], key: str, value: Any
) -> None:
    c = mk_cov(client, auth_headers, notes="n", source_note="s")
    r = _patch(client, auth_headers, c["id"], body)
    assert r.status_code == 200, r.text
    assert r.json()[key] == value
    assert client.get(f"{COV}/{c['id']}", headers=auth_headers).json()[key] == value


def test_ac50_patch_empty_body_is_ok_and_noop(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    c = mk_cov(client, auth_headers)
    r = _patch(client, auth_headers, c["id"], {})
    assert r.status_code == 200
    assert r.json()["updated_at"] == c["updated_at"]


@pytest.mark.parametrize("raw", ["[]", "null", '"x"', "5", "", "{"])
def test_ac50_patch_non_object_body(
    client: TestClient, auth_headers: dict[str, str], raw: str
) -> None:
    c = mk_cov(client, auth_headers)
    r = quiet(client).patch(
        f"{COV}/{c['id']}", content=raw.encode(), headers={**auth_headers, **JSON_CT}
    )
    assert r.status_code == 400


def test_ac50_patch_moves_updated_at_not_created_at(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    c = mk_cov(client, auth_headers)
    r = _patch(client, auth_headers, c["id"], {"name": "New"}).json()
    assert r["created_at"] == c["created_at"]
    assert r["updated_at"] > c["updated_at"]


def test_ac50_patch_unknown_id_404_but_validation_first(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    missing = new_id()
    assert _patch(client, auth_headers, missing, {"name": "x"}).status_code == 404
    assert _patch(client, auth_headers, missing, {"name": ""}).status_code == 400
    assert _patch(client, auth_headers, missing, {}).status_code == 404
    assert client.patch(f"{COV}/nope", json={}, headers=auth_headers).status_code == 400


def test_ac50_patch_does_not_alter_claims_or_count(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    c = mk_cov(client, auth_headers)
    k = mk_clm(client, auth_headers, c["id"])
    r = _patch(client, auth_headers, c["id"], {"name": "Renamed"})
    assert r.json()["claim_count"] == 1
    assert client.get(f"{CLM}/{k['id']}", headers=auth_headers).json() == k


def test_ac50_replay_original_create_after_patch_is_409(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = cov()
    client.post(COV, json=b, headers=auth_headers)
    _patch(client, auth_headers, b["id"], {"km_limit": 7})
    assert client.post(COV, json=b, headers=auth_headers).status_code == 409


def test_ac50_delete_cascade_and_404_afterwards(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    c = mk_cov(client, auth_headers)
    other = mk_cov(client, auth_headers)
    ks = [mk_clm(client, auth_headers, c["id"]) for _ in range(3)]
    keep = mk_clm(client, auth_headers, other["id"])
    assert client.get(f"{COV}/{c['id']}", headers=auth_headers).json()["claim_count"] == 3
    r = client.delete(f"{COV}/{c['id']}", headers=auth_headers)
    assert r.status_code == 204
    assert r.content == b""
    for k in ks:
        assert client.get(f"{CLM}/{k['id']}", headers=auth_headers).status_code == 404
    assert client.get(f"{CLM}/{keep['id']}", headers=auth_headers).status_code == 200
    assert client.get(f"{COV}/{c['id']}", headers=auth_headers).status_code == 404
    assert client.delete(f"{COV}/{c['id']}", headers=auth_headers).status_code == 404
    assert count_rows(client, "warranty_claim") == 1
    assert client.get(CLM, params={"coverage_id": c["id"]}, headers=auth_headers).json() == {
        "items": []
    }


# --- AC-51: status ----------------------------------------------------------------------------


def _status(client: TestClient, h: dict[str, str], c: dict[str, Any], today: str = TODAY) -> Any:
    r = client.get(f"{COV}/{c['id']}", params={"today": today}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def _add_record(client: TestClient, h: dict[str, str], **o: Any) -> dict[str, Any]:
    r = client.post(SR, json=record_body(**o), headers=h)
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


@pytest.mark.parametrize(
    ("end", "status", "soon"),
    [
        ("2026-10-21", "expired", []),
        ("2026-10-22", "expiring_soon", ["date"]),
        ("2026-10-23", "expiring_soon", ["date"]),
        ("2027-01-20", "expiring_soon", ["date"]),
        ("2027-01-21", "active", []),
        ("2027-01-22", "active", []),
    ],
)
def test_ac51_date_boundaries_90_days(
    client: TestClient, auth_headers: dict[str, str], end: str, status: str, soon: list[str]
) -> None:
    c = mk_cov(client, auth_headers, end_date=end, km_limit=None, start_date="2020-01-01")
    got = _status(client, auth_headers, c)
    assert got["status"] == status
    assert got["expiring_soon_by"] == soon
    assert got["expired_by"] == (["date"] if status == "expired" else [])


@pytest.mark.parametrize(
    ("odo", "status", "expired_by", "soon_by"),
    [
        (9999, "active", [], []),
        (10000, "active", [], []),
        (14999, "active", [], []),
        (15000, "expiring_soon", [], ["odometer"]),
        (15001, "expiring_soon", [], ["odometer"]),
        (20000, "expiring_soon", [], ["odometer"]),
        (20001, "expired", ["odometer"], []),
    ],
)
def test_ac51_km_boundaries_5000(
    client: TestClient,
    auth_headers: dict[str, str],
    odo: int,
    status: str,
    expired_by: list[str],
    soon_by: list[str],
) -> None:
    _add_record(client, auth_headers, odometer=odo)
    c = mk_cov(client, auth_headers, end_date=None, km_limit=20000)
    got = _status(client, auth_headers, c)
    assert got["status"] == status
    assert got["expired_by"] == expired_by
    assert got["expiring_soon_by"] == soon_by


def test_ac51_both_expired_by_values(client: TestClient, auth_headers: dict[str, str]) -> None:
    _add_record(client, auth_headers, odometer=30000)
    c = mk_cov(client, auth_headers, start_date="2020-01-01", end_date="2026-01-01", km_limit=20000)
    got = _status(client, auth_headers, c)
    assert got["status"] == "expired"
    assert got["expired_by"] == ["date", "odometer"]
    assert got["expiring_soon_by"] == []


def test_ac51_both_soon_by_values(client: TestClient, auth_headers: dict[str, str]) -> None:
    _add_record(client, auth_headers, odometer=18000)
    c = mk_cov(client, auth_headers, start_date="2020-01-01", end_date="2026-11-01", km_limit=20000)
    got = _status(client, auth_headers, c)
    assert got["status"] == "expiring_soon"
    assert got["expiring_soon_by"] == ["date", "odometer"]
    assert got["expired_by"] == []


def test_ac51_expired_by_odometer_while_date_would_be_soon(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    _add_record(client, auth_headers, odometer=50000)
    c = mk_cov(client, auth_headers, start_date="2020-01-01", end_date="2026-11-01", km_limit=20000)
    got = _status(client, auth_headers, c)
    assert got["status"] == "expired"
    assert got["expired_by"] == ["odometer"]
    assert got["expiring_soon_by"] == []


def test_ac51_not_started_precedence(client: TestClient, auth_headers: dict[str, str]) -> None:
    c = mk_cov(client, auth_headers, start_date="2026-11-01", end_date="2026-11-10", km_limit=None)
    got = _status(client, auth_headers, c)
    assert got["status"] == "not_started"
    assert got["expiring_soon_by"] == []
    c2 = mk_cov(client, auth_headers, start_date="2026-10-22", end_date="2026-11-10", km_limit=None)
    assert _status(client, auth_headers, c2)["status"] == "expiring_soon"


def test_ac51_expired_beats_not_started(client: TestClient, auth_headers: dict[str, str]) -> None:
    _add_record(client, auth_headers, odometer=99999)
    c = mk_cov(client, auth_headers, start_date="2030-01-01", end_date=None, km_limit=1000)
    got = _status(client, auth_headers, c)
    assert got["status"] == "expired"
    assert got["expired_by"] == ["odometer"]


def test_ac51_km_only_coverage_never_expires_by_date(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    c = mk_cov(client, auth_headers, end_date=None, km_limit=100000, start_date="2001-01-01")
    got = _status(client, auth_headers, c, today="2199-01-01")
    assert got["status"] == "active"


def test_ac51_date_only_coverage_ignores_odometer(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    _add_record(client, auth_headers, odometer=9_999_999)
    c = mk_cov(client, auth_headers, km_limit=None, end_date="2031-01-01")
    assert _status(client, auth_headers, c)["status"] == "active"


def test_ac51_odometer_unknown_skips_km(client: TestClient, auth_headers: dict[str, str]) -> None:
    c = mk_cov(client, auth_headers, end_date=None, km_limit=1)
    got = _status(client, auth_headers, c)
    assert got["status"] == "active"
    assert client.get(COV, headers=auth_headers).json()["current_odometer"] is None


def test_ac51_today_query_default_is_kl_date(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.services.warranty as svc

    c = mk_cov(client, auth_headers, start_date="2020-01-01", end_date="2026-10-21", km_limit=None)
    monkeypatch.setattr(svc, "today_kl", lambda: today_kl(utc(2026, 10, 21, 15, 59, 59)))
    assert client.get(f"{COV}/{c['id']}", headers=auth_headers).json()["status"] == "expiring_soon"
    monkeypatch.setattr(svc, "today_kl", lambda: today_kl(utc(2026, 10, 21, 16, 0, 0)))
    one = client.get(f"{COV}/{c['id']}", headers=auth_headers).json()
    assert one["status"] == "expired"
    lst = client.get(COV, headers=auth_headers).json()
    assert lst["items"][0]["status"] == "expired"


@pytest.mark.parametrize(
    "today",
    [
        "garbage",
        "2026-02-30",
        "2026-13-01",
        "20261022",
        "2026/10/22",
        "2026-10-22T00:00:00",
        "2026-10-22T00:00:00Z",
        " 2026-10-22",
        "",
        "null",
        "1666656000",
        "\u0662\u0660\u0662\u0666-10-22",
        "2026-10-22\x00",
    ],
)
def test_ac51_malformed_today_is_400(
    client: TestClient, auth_headers: dict[str, str], today: str
) -> None:
    c = mk_cov(client, auth_headers)
    for url in (COV, f"{COV}/{c['id']}"):
        r = quiet(client).get(url, params={"today": today}, headers=auth_headers)
        assert r.status_code == 400, (url, today, r.text)
        assert "today" in fields(r)


def test_ac51_today_extremes_accepted(client: TestClient, auth_headers: dict[str, str]) -> None:
    mk_cov(client, auth_headers)
    for t in ("0001-01-01", "9999-12-31", "2000-01-01"):
        assert client.get(COV, params={"today": t}, headers=auth_headers).status_code == 200


def test_ac51_status_never_stored_and_post_response_computed(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    c = mk_cov(client, auth_headers, start_date="2020-01-01", end_date="2021-01-01", km_limit=None)
    assert c["status"] == "expired"
    assert c["expired_by"] == ["date"]
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        cols = {
            r[0]
            for r in conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name='warranty_coverage'"
                )
            )
        }
    assert not cols & {"status", "expired_by", "expiring_soon_by", "claim_count"}


def test_ac51_lists_and_gets_agree(client: TestClient, auth_headers: dict[str, str]) -> None:
    _add_record(client, auth_headers, odometer=19000)
    cs = [
        mk_cov(client, auth_headers, name="a", end_date=None, km_limit=20000),
        mk_cov(client, auth_headers, name="b", start_date="2030-01-01"),
        mk_cov(client, auth_headers, name="c", end_date="2020-01-01", start_date="2010-01-01"),
    ]
    mk_clm(client, auth_headers, cs[0]["id"])
    items = {
        i["id"]: i
        for i in client.get(COV, params={"today": TODAY}, headers=auth_headers).json()["items"]
    }
    for c in cs:
        assert items[c["id"]] == _status(client, auth_headers, c)


# --- list order -------------------------------------------------------------------------------


def test_ac51_list_order_full(client: TestClient, auth_headers: dict[str, str]) -> None:
    _add_record(client, auth_headers, odometer=1000)
    mk = lambda name, **o: mk_cov(client, auth_headers, name=name, **o)  # noqa: E731
    base = {"start_date": "2020-01-01"}
    e_late = mk("exp-late", end_date="2026-10-01", km_limit=None, **base)
    e_early = mk("exp-early", end_date="2026-01-01", km_limit=None, **base)
    ns_b = mk("ns-b", start_date="2027-01-01", end_date="2030-01-01", km_limit=None)
    ns_nullend = mk("ns-null", start_date="2027-01-01", end_date=None, km_limit=5000)
    ns_a = mk("ns-a", start_date="2027-01-01", end_date="2030-01-01", km_limit=None)
    ac_far = mk("act-far", end_date="2040-01-01", km_limit=None, **base)
    ac_null = mk("act-null", end_date=None, km_limit=500000, **base)
    ac_near = mk("act-near", end_date="2030-01-01", km_limit=None, **base)
    soon_b = mk("soon-b", end_date="2026-12-01", km_limit=None, **base)
    soon_a = mk("soon-a", end_date="2026-12-01", km_limit=None, **base)
    soon_first = mk("soon-z", end_date="2026-11-01", km_limit=None, **base)
    got = [
        i["name"]
        for i in client.get(COV, params={"today": TODAY}, headers=auth_headers).json()["items"]
    ]
    assert got == [
        soon_first["name"],
        soon_a["name"],
        soon_b["name"],
        ac_near["name"],
        ac_far["name"],
        ac_null["name"],
        ns_a["name"],
        ns_b["name"],
        ns_nullend["name"],
        e_early["name"],
        e_late["name"],
    ]


def test_ac51_list_order_ties_break_on_id(client: TestClient, auth_headers: dict[str, str]) -> None:
    ids = sorted(new_id() for _ in range(5))
    for i in reversed(ids):
        mk_cov(client, auth_headers, id=i, name="same", end_date="2031-01-01", km_limit=None)
    got = [
        i["id"]
        for i in client.get(COV, params={"today": TODAY}, headers=auth_headers).json()["items"]
    ]
    assert got == ids


def test_ac51_list_empty_shape(client: TestClient, auth_headers: dict[str, str]) -> None:
    assert client.get(COV, headers=auth_headers).json() == {"items": [], "current_odometer": None}


def test_ac51_list_extra_query_params_ignored_or_400_not_500(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    r = quiet(client).get(COV, params={"limit": "x", "cursor": "y"}, headers=auth_headers)
    assert r.status_code in (200, 400)


# --- AC-52: odometer shared with reminders ----------------------------------------------------


def test_ac52_ties_on_date_resolve_by_created_at_then_id_same_for_both(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    a = _add_record(client, auth_headers, date="2026-05-05", odometer=11000)
    b = _add_record(client, auth_headers, date="2026-05-05", odometer=12000)
    older = _add_record(client, auth_headers, date="2026-01-01", odometer=99999)
    mk_cov(client, auth_headers)
    w = client.get(COV, params={"today": TODAY}, headers=auth_headers).json()["current_odometer"]
    r = client.get("/api/v1/reminders", headers=auth_headers).json()["current_odometer"]
    assert w == r
    assert w["service_record_id"] == b["id"]
    assert w["km"] == 12000
    assert w["date"] == "2026-05-05"
    assert a["id"] != b["id"] != older["id"]


def test_ac52_identical_created_at_ties_break_on_id(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    ids = sorted([new_id(), new_id()])
    for n, i in enumerate(ids):
        _add_record(client, auth_headers, id=i, date="2026-05-05", odometer=1000 + n)
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(text("UPDATE service_record SET created_at = '2026-05-05T00:00:00Z'"))
    w = client.get(COV, headers=auth_headers).json()["current_odometer"]
    r = client.get("/api/v1/reminders", headers=auth_headers).json()["current_odometer"]
    assert w == r
    assert w["service_record_id"] == ids[-1]


def test_ac52_lower_odometer_on_later_date_wins(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    _add_record(client, auth_headers, date="2026-01-01", odometer=50000)
    _add_record(client, auth_headers, date="2026-06-01", odometer=40000)
    assert client.get(COV, headers=auth_headers).json()["current_odometer"]["km"] == 40000


def test_ac52_claims_never_change_current_odometer(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    _add_record(client, auth_headers, odometer=10000)
    c = mk_cov(client, auth_headers, end_date=None, km_limit=12000)
    before = client.get(COV, headers=auth_headers).json()
    k = mk_clm(client, auth_headers, c["id"], odometer=999999, date="2026-10-01")
    client.patch(f"{CLM}/{k['id']}", json={"odometer": 888888}, headers=auth_headers)
    after = client.get(COV, headers=auth_headers).json()
    assert after["current_odometer"] == before["current_odometer"]
    assert after["items"][0]["status"] == before["items"][0]["status"] == "expiring_soon"
    assert (
        client.get("/api/v1/reminders", headers=auth_headers).json()["current_odometer"]
        == (before["current_odometer"])
    )
    assert count_rows(client, "service_record") == 1


def test_ac52_deleting_latest_record_falls_back(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    _add_record(client, auth_headers, date="2026-01-01", odometer=5000)
    latest = _add_record(client, auth_headers, date="2026-06-01", odometer=9000)
    client.delete(f"{SR}/{latest['id']}", headers=auth_headers)
    assert client.get(COV, headers=auth_headers).json()["current_odometer"]["km"] == 5000


# --- AC-55: template --------------------------------------------------------------------------


def test_ac55_template_exact_content(client: TestClient, auth_headers: dict[str, str]) -> None:
    r = client.get(TPL, headers=auth_headers)
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 1
    t = items[0]
    assert t["id"] == "my-factory-warranty"
    assert t["version"] == 1
    assert t["baseline_required"] is True
    assert t["source"]["status"] == "verified"
    assert t["source"]["research_ref"] == "M8, M9, M10"
    assert "Confirm against" in t["caveat"]
    assert [(i["key"], i["months"], i["km"], i["research_ref"]) for i in t["items"]] == [
        ("general", 60, 150000, "M8"),
        ("paint_corrosion", 60, 150000, "M8"),
        ("powertrain", 96, 160000, "M9"),
        ("wear_short", 6, 10000, "M10"),
        ("wear_long", 12, 20000, "M10"),
        ("genuine_parts", None, None, "M10"),
    ]
    for i in t["items"][:-1]:
        assert "enter_manually" not in i
        assert set(i) == {"key", "name", "months", "km", "research_ref"}
    gp = t["items"][-1]
    assert gp["enter_manually"] is True
    assert set(gp) == {"key", "name", "months", "km", "research_ref", "enter_manually"}
    assert set(t) == {
        "id",
        "version",
        "name",
        "source",
        "caveat",
        "baseline_required",
        "items",
    }


def test_ac55_template_has_no_parts_price_provider_or_coverage_claims(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    text_ = client.get(TPL, headers=auth_headers).text.lower()
    for word in (
        "rm5",
        "price",
        "myr",
        "provider",
        "certificate",
        "includes",
        "excludes",
        "bumper",
    ):
        assert word not in text_, word
    assert "covered" not in text_
    assert "extended" not in text_


def test_ac55_get_template_creates_nothing_and_is_idempotent(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    first = client.get(TPL, headers=auth_headers).json()
    for _ in range(3):
        assert client.get(TPL, headers=auth_headers).json() == first
    assert count_rows(client, "warranty_coverage") == 0
    assert count_rows(client, "warranty_claim") == 0
    assert client.get(COV, headers=auth_headers).json()["items"] == []
    _add_record(client, auth_headers)
    client.get(TPL, headers=auth_headers)
    assert count_rows(client, "warranty_coverage") == 0


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_ac55_no_apply_endpoint_or_template_writes(
    client: TestClient, auth_headers: dict[str, str], method: str
) -> None:
    r = client.request(method, TPL, headers=auth_headers, json={})
    assert r.status_code == 405
    assert r.json()["error"]["code"] == "method_not_allowed"
    for p in (f"{TPL}/apply", f"{TPL}/my-factory-warranty", "/api/v1/warranty-templates/apply"):
        assert client.request(method, p, headers=auth_headers, json={}).status_code in (404, 405)


def test_ac55_template_does_not_mutate_between_calls(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    a = client.get(TPL, headers=auth_headers).json()
    a["items"][0]["items"][0]["name"] = "tampered"
    b = client.get(TPL, headers=auth_headers).json()
    assert b["items"][0]["items"][0]["name"] == "Vehicle warranty"


def test_ac56_template_item_accepted_as_ordinary_coverage(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    c = mk_cov(
        client,
        auth_headers,
        provider_type="factory",
        source_kind="template",
        verification_status="proposed",
        template_ref="my-factory-warranty:general",
        start_date="2026-01-01",
        end_date="2031-01-01",
        km_limit=150000,
    )
    assert c["source_kind"] == "template"
    assert c["verification_status"] == "proposed"
    assert (
        _patch(client, auth_headers, c["id"], {"verification_status": "confirmed"}).status_code
        == 200
    )
    assert client.delete(f"{COV}/{c['id']}", headers=auth_headers).status_code == 204


def test_ac57_future_extended_does_not_change_factory(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    f = mk_cov(client, auth_headers, name="F", end_date="2031-01-01", km_limit=None)
    before = _status(client, auth_headers, f)
    e = mk_cov(
        client,
        auth_headers,
        name="E",
        provider_type="extended",
        start_date="2031-01-02",
        end_date="2036-01-01",
        km_limit=None,
    )
    assert _status(client, auth_headers, e)["status"] == "not_started"
    assert _status(client, auth_headers, f) == before


# --- AC-58 / AC-59: claims --------------------------------------------------------------------


@pytest.fixture
def cv(client: TestClient, auth_headers: dict[str, str]) -> dict[str, Any]:
    return mk_cov(client, auth_headers)


def _bad_claim(client: TestClient, h: dict[str, str], cid: str, field: str, **o: Any) -> None:
    before = count_rows(client, "warranty_claim")
    r = quiet(client).post(CLM, json=clm(cid, **o), headers=h)
    assert r.status_code == 400, (o, r.text)
    assert r.json()["error"]["code"] == "validation_error"
    assert field in fields(r), (o, fields(r))
    assert count_rows(client, "warranty_claim") == before


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("description", "Other"),
        ("date", "2026-09-02"),
        ("odometer", 12001),
        ("status", "approved"),
        ("cost_covered_minor", 100),
        ("notes", "different"),
    ],
)
def test_ac58_conflict_on_every_content_field(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any], field: str, value: Any
) -> None:
    b = clm(cv["id"], notes="n", cost_covered_minor=50)
    assert client.post(CLM, json=b, headers=auth_headers).status_code == 201
    assert client.post(CLM, json=b, headers=auth_headers).status_code == 200
    assert client.post(CLM, json={**b, field: value}, headers=auth_headers).status_code == 409
    for nullable in ("cost_covered_minor", "notes"):
        r = client.post(CLM, json={**b, nullable: None}, headers=auth_headers)
        assert r.status_code == 409, nullable
    assert count_rows(client, "warranty_claim") == 1


def test_ac58_conflict_on_coverage_id(client: TestClient, auth_headers: dict[str, str]) -> None:
    a = mk_cov(client, auth_headers)
    b = mk_cov(client, auth_headers)
    k = clm(a["id"])
    assert client.post(CLM, json=k, headers=auth_headers).status_code == 201
    assert (
        client.post(CLM, json={**k, "coverage_id": b["id"]}, headers=auth_headers).status_code
        == 409
    )
    assert (
        client.post(CLM, json={**k, "coverage_id": new_id()}, headers=auth_headers).status_code
        == 409
    )


def test_ac58_defaults_and_missing_equals_null_on_replay(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any]
) -> None:
    b = clm(cv["id"])
    r = client.post(CLM, json=b, headers=auth_headers)
    assert r.json()["cost_covered_minor"] is None
    assert r.json()["currency"] == "MYR"
    assert r.json()["notes"] is None
    full = {**b, "cost_covered_minor": None, "currency": "MYR", "notes": ""}
    assert client.post(CLM, json=full, headers=auth_headers).status_code == 200


def test_ac58_response_shape(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any]
) -> None:
    k = mk_clm(client, auth_headers, cv["id"])
    assert set(k) == {
        "id", "coverage_id", "date", "odometer", "description", "status",
        "cost_covered_minor", "currency", "notes", "created_at", "updated_at",
    }  # fmt: skip
    assert client.get(f"{CLM}/{k['id']}", headers=auth_headers).json() == k


def test_ac58_unknown_coverage_400_on_coverage_id(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    _bad_claim(client, auth_headers, new_id(), "coverage_id")


@pytest.mark.parametrize("bad", [None, "", "abc", 5, []])
def test_ac58_malformed_coverage_id(
    client: TestClient, auth_headers: dict[str, str], bad: Any
) -> None:
    _bad_claim(client, auth_headers, bad, "coverage_id")


def test_ac58_coverage_id_missing(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = clm(new_id())
    del b["coverage_id"]
    r = client.post(CLM, json=b, headers=auth_headers)
    assert r.status_code == 400
    assert "coverage_id" in fields(r)


def test_ac58_uppercase_coverage_id_accepted(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any]
) -> None:
    r = client.post(CLM, json=clm(cv["id"].upper()), headers=auth_headers)
    assert r.status_code == 201
    assert r.json()["coverage_id"] == cv["id"]


def test_ac58_replay_after_coverage_deleted_is_400_on_coverage_id(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any]
) -> None:
    b = clm(cv["id"])
    client.post(CLM, json=b, headers=auth_headers)
    client.delete(f"{COV}/{cv['id']}", headers=auth_headers)
    r = client.post(CLM, json=b, headers=auth_headers)
    assert r.status_code == 400
    assert "coverage_id" in fields(r)
    assert client.get(f"{CLM}/{b['id']}", headers=auth_headers).status_code == 404


def test_ac58_delete_coverage_then_get_claim_404(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any]
) -> None:
    k = mk_clm(client, auth_headers, cv["id"])
    client.delete(f"{COV}/{cv['id']}", headers=auth_headers)
    r = client.get(f"{CLM}/{k['id']}", headers=auth_headers)
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"
    assert (
        client.patch(f"{CLM}/{k['id']}", json={"notes": "x"}, headers=auth_headers).status_code
        == 404
    )
    assert client.delete(f"{CLM}/{k['id']}", headers=auth_headers).status_code == 404


@pytest.mark.parametrize("o", [-1, 10_000_001, 2**40])
def test_ac59_odometer_out_of_range(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any], o: int
) -> None:
    _bad_claim(client, auth_headers, cv["id"], "odometer", odometer=o)


@pytest.mark.parametrize("o", [0, 1, 10_000_000])
def test_ac59_odometer_boundaries_ok(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any], o: int
) -> None:
    assert mk_clm(client, auth_headers, cv["id"], odometer=o)["odometer"] == o


@pytest.mark.parametrize("o", [True, 1.0, 1.5, "5", None, [], {}])
def test_ac59_odometer_not_strict_int(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any], o: Any
) -> None:
    _bad_claim(client, auth_headers, cv["id"], "odometer", odometer=o)


@pytest.mark.parametrize("c", [-1, 10**12 + 1, True, 1.0, 12.5, "5", [], {}])
def test_ac59_cost_invalid(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any], c: Any
) -> None:
    _bad_claim(client, auth_headers, cv["id"], "cost_covered_minor", cost_covered_minor=c)


@pytest.mark.parametrize("c", [0, 1, 10**12, None])
def test_ac59_cost_valid(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any], c: Any
) -> None:
    k = mk_clm(client, auth_headers, cv["id"], cost_covered_minor=c)
    assert client.get(f"{CLM}/{k['id']}", headers=auth_headers).json()["cost_covered_minor"] == c


@pytest.mark.parametrize("raw", ["1e3", "1000.0", "NaN", "Infinity", "9" * 300])
def test_ac59_cost_raw_json(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any], raw: str
) -> None:
    content = (
        f'{{"id":"{new_id()}","coverage_id":"{cv["id"]}","date":"2026-09-01","odometer":1,'
        f'"description":"d","status":"submitted","cost_covered_minor":{raw}}}'
    )
    r = raw_post(quiet(client), auth_headers, CLM, content)
    assert r.status_code == 400, raw
    assert "cost_covered_minor" in fields(r)


@pytest.mark.parametrize("d", ["", "   ", "a\x00", "x" * 501, None, 5])
def test_ac59_description_invalid(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any], d: Any
) -> None:
    _bad_claim(client, auth_headers, cv["id"], "description", description=d)


@pytest.mark.parametrize("n", [1, 500])
def test_ac59_description_boundaries_ok(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any], n: int
) -> None:
    assert mk_clm(client, auth_headers, cv["id"], description="d" * n)


@pytest.mark.parametrize(
    "s", ["Submitted", "APPROVED", "pending", "", None, 1, " approved", "closed"]
)
def test_ac59_status_enum(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any], s: Any
) -> None:
    _bad_claim(client, auth_headers, cv["id"], "status", status=s)


@pytest.mark.parametrize("s", ["submitted", "approved", "rejected", "completed"])
def test_ac59_status_enum_ok(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any], s: str
) -> None:
    assert mk_clm(client, auth_headers, cv["id"], status=s)["status"] == s


@pytest.mark.parametrize("c", ["myr", "USD", "", None, "MYR ", 1])
def test_ac59_currency(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any], c: Any
) -> None:
    r = quiet(client).post(CLM, json=clm(cv["id"], currency=c), headers=auth_headers)
    if r.status_code == 201:
        assert c == "MYR " and r.json()["currency"] == "MYR"  # surrounding blanks are trimmed
    else:
        assert r.status_code == 400
        assert "currency" in fields(r)


@pytest.mark.parametrize("n", [5000, 5001])
def test_ac59_notes_length(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any], n: int
) -> None:
    r = client.post(CLM, json=clm(cv["id"], notes="n" * n), headers=auth_headers)
    assert r.status_code == (201 if n == 5000 else 400)


def test_ac59_notes_nul_and_blank(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any]
) -> None:
    _bad_claim(client, auth_headers, cv["id"], "notes", notes="a\x00b")
    assert mk_clm(client, auth_headers, cv["id"], notes="   ")["notes"] is None


@pytest.mark.parametrize(
    "d",
    [
        "1999-12-31", "0001-01-01", "2026-02-30", "2026-13-01", "2026-1-1", "20260901",
        "2026-09-01T00:00:00", "2026-09-01T00:00:00Z", " 2026-09-01", "", 20260901, True, None,
    ],
)  # fmt: skip
def test_ac59_claim_date_invalid(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any], d: Any
) -> None:
    r = quiet(client).post(CLM, json=clm(cv["id"], date=d), headers=auth_headers)
    if r.status_code == 201:
        assert d == " 2026-09-01"
    else:
        assert r.status_code == 400
        assert "date" in fields(r)


def test_ac59_claim_date_2000_ok_and_missing(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any]
) -> None:
    assert mk_clm(client, auth_headers, cv["id"], date="2000-01-01")
    b = clm(cv["id"])
    del b["date"]
    assert "date" in fields(client.post(CLM, json=b, headers=auth_headers))


@pytest.mark.parametrize(
    ("now", "ok", "bad"),
    [
        (utc(2026, 10, 21, 15, 59, 59), "2026-10-21", "2026-10-22"),
        (utc(2026, 10, 21, 16, 0, 0), "2026-10-22", "2026-10-23"),
        (utc(2026, 12, 31, 16, 0, 0), "2027-01-01", "2027-01-02"),
    ],
)
def test_ac59_claim_future_date_kl(
    client: TestClient,
    auth_headers: dict[str, str],
    cv: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    now: dt.datetime,
    ok: str,
    bad: str,
) -> None:
    freeze(monkeypatch, now)
    assert client.post(CLM, json=clm(cv["id"], date=ok), headers=auth_headers).status_code == 201
    _bad_claim(client, auth_headers, cv["id"], "date", date=bad)
    k = clm(cv["id"], date=ok)
    client.post(CLM, json=k, headers=auth_headers)
    assert (
        client.patch(f"{CLM}/{k['id']}", json={"date": bad}, headers=auth_headers).status_code
        == 400
    )
    assert (
        client.patch(f"{CLM}/{k['id']}", json={"date": ok}, headers=auth_headers).status_code == 200
    )


def test_ac59_date_outside_coverage_dates_accepted(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    c = mk_cov(client, auth_headers, start_date="2026-05-01", end_date="2026-06-01", km_limit=None)
    assert mk_clm(client, auth_headers, c["id"], date="2020-01-01")
    assert mk_clm(client, auth_headers, c["id"], date="2026-09-01")


@pytest.mark.parametrize(
    "extra",
    [{"created_at": "2026-01-01T00:00:00Z"}, {"cost": 5}, {"provider": "x"}, {"claim_number": "1"},
     {"attachments": []}, {"expense_id": new_id()}, {"Status": "x"}],
)  # fmt: skip
def test_ac59_unknown_fields(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any], extra: dict[str, Any]
) -> None:
    r = client.post(CLM, json={**clm(cv["id"]), **extra}, headers=auth_headers)
    assert r.status_code == 400
    assert count_rows(client, "warranty_claim") == 0


def test_ac59_cap_500_claims(client: TestClient, auth_headers: dict[str, str]) -> None:
    c = mk_cov(client, auth_headers)
    rows = [clm(c["id"], description=f"d{n}") for n in range(500)]
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(
            text(
                "INSERT INTO warranty_claim (id, coverage_id, date, odometer, description, status)"
                " VALUES (:id, :coverage_id, :date, :odometer, :description, :status)"
            ),
            [{**r, "date": dt.date(2026, 9, 1)} for r in rows],
        )
    r = client.post(CLM, json=clm(c["id"]), headers=auth_headers)
    assert r.status_code == 400
    assert fields(r) == ["body"]
    assert client.post(CLM, json=rows[0], headers=auth_headers).status_code == 200
    assert (
        client.post(CLM, json={**rows[0], "odometer": 1}, headers=auth_headers).status_code == 409
    )
    assert (
        client.patch(
            f"{CLM}/{rows[1]['id']}", json={"notes": "x"}, headers=auth_headers
        ).status_code
        == 200
    )
    assert client.delete(f"{CLM}/{rows[2]['id']}", headers=auth_headers).status_code == 204
    assert client.post(CLM, json=clm(c["id"]), headers=auth_headers).status_code == 201
    assert len(client.get(CLM, headers=auth_headers).json()["items"]) == 500


def test_ac59_bad_claim_at_cap_reports_field_not_body_and_unknown_coverage_wins(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    c = mk_cov(client, auth_headers)
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(
            text(
                "INSERT INTO warranty_claim (id, coverage_id, date, odometer, description, status)"
                " SELECT gen_random_uuid(), :c, '2026-09-01', 1, 'd', 'submitted'"
                " FROM generate_series(1, 500)"
            ),
            {"c": c["id"]},
        )
    r = client.post(CLM, json=clm(c["id"], description=""), headers=auth_headers)
    assert "description" in fields(r)
    r = client.post(CLM, json=clm(new_id()), headers=auth_headers)
    assert r.status_code == 400
    assert "coverage_id" in fields(r)


# --- AC-60: claim PATCH, delete, list ---------------------------------------------------------


def _cpatch(client: TestClient, h: dict[str, str], kid: str, body: Any) -> Any:
    return client.patch(f"{CLM}/{kid}", json=body, headers=h)


@pytest.mark.parametrize("s", ["submitted", "approved", "rejected", "completed"])
def test_ac60_patch_status_all_transitions(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any], s: str
) -> None:
    k = mk_clm(client, auth_headers, cv["id"], status="completed")
    r = _cpatch(client, auth_headers, k["id"], {"status": s})
    assert r.status_code == 200
    assert r.json()["status"] == s


@pytest.mark.parametrize("s", ["Approved", "", None, "closed", 3])
def test_ac60_patch_status_invalid(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any], s: Any
) -> None:
    k = mk_clm(client, auth_headers, cv["id"])
    r = _cpatch(client, auth_headers, k["id"], {"status": s})
    assert r.status_code == 400
    assert "status" in fields(r)


@pytest.mark.parametrize("field", ["date", "odometer", "description", "currency"])
def test_ac60_patch_null_rejected_for_non_nullable(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any], field: str
) -> None:
    k = mk_clm(client, auth_headers, cv["id"])
    r = _cpatch(client, auth_headers, k["id"], {field: None})
    assert r.status_code == 400
    assert field in fields(r)


def test_ac60_patch_cost_null_zero_and_value(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any]
) -> None:
    k = mk_clm(client, auth_headers, cv["id"], cost_covered_minor=500, notes="n")
    assert (
        _cpatch(client, auth_headers, k["id"], {"cost_covered_minor": None}).json()[
            "cost_covered_minor"
        ]
        is None
    )
    assert (
        _cpatch(client, auth_headers, k["id"], {"cost_covered_minor": 0}).json()[
            "cost_covered_minor"
        ]
        == 0
    )
    assert _cpatch(client, auth_headers, k["id"], {"cost_covered_minor": 10**12}).status_code == 200
    assert (
        _cpatch(client, auth_headers, k["id"], {"cost_covered_minor": 10**12 + 1}).status_code
        == 400
    )
    assert _cpatch(client, auth_headers, k["id"], {"cost_covered_minor": -1}).status_code == 400
    assert _cpatch(client, auth_headers, k["id"], {"cost_covered_minor": True}).status_code == 400
    assert _cpatch(client, auth_headers, k["id"], {"cost_covered_minor": 1.0}).status_code == 400
    assert _cpatch(client, auth_headers, k["id"], {"notes": None}).json()["notes"] is None
    assert _cpatch(client, auth_headers, k["id"], {"notes": "  "}).json()["notes"] is None


@pytest.mark.parametrize(
    "body",
    [
        {"coverage_id": new_id()},
        {"id": new_id()},
        {"created_at": "2026-01-01T00:00:00Z"},
        {"updated_at": "2026-01-01T00:00:00Z"},
        {"cost": 1},
        {"odometer": -1},
        {"odometer": 10_000_001},
        {"odometer": True},
        {"description": ""},
        {"description": "x" * 501},
        {"description": "a\x00"},
        {"notes": "x" * 5001},
        {"currency": "USD"},
        {"date": "1999-12-31"},
        {"date": "2026-02-30"},
        {"date": "2026-09-01T00:00:00"},
    ],
)
def test_ac60_patch_rejections(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any], body: dict[str, Any]
) -> None:
    k = mk_clm(client, auth_headers, cv["id"])
    r = quiet(client).patch(f"{CLM}/{k['id']}", json=body, headers=auth_headers)
    assert r.status_code == 400, body
    assert client.get(f"{CLM}/{k['id']}", headers=auth_headers).json() == k


def test_ac60_patch_coverage_id_even_to_same_value_is_400(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any]
) -> None:
    k = mk_clm(client, auth_headers, cv["id"])
    assert _cpatch(client, auth_headers, k["id"], {"coverage_id": cv["id"]}).status_code == 400


def test_ac60_patch_empty_unknown_and_validation_first(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any]
) -> None:
    k = mk_clm(client, auth_headers, cv["id"])
    r = _cpatch(client, auth_headers, k["id"], {})
    assert r.status_code == 200
    assert r.json() == k
    assert _cpatch(client, auth_headers, new_id(), {"notes": "x"}).status_code == 404
    assert _cpatch(client, auth_headers, new_id(), {"status": "bad"}).status_code == 400
    assert _cpatch(client, auth_headers, new_id(), {}).status_code == 404


def test_ac60_patch_updated_at_and_replay_conflict(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any]
) -> None:
    b = clm(cv["id"])
    first = client.post(CLM, json=b, headers=auth_headers).json()
    r = _cpatch(client, auth_headers, b["id"], {"status": "approved"}).json()
    assert r["created_at"] == first["created_at"]
    assert r["updated_at"] > first["updated_at"]
    assert client.post(CLM, json=b, headers=auth_headers).status_code == 409


def test_ac60_delete_claim_and_count(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any]
) -> None:
    k = mk_clm(client, auth_headers, cv["id"])
    mk_clm(client, auth_headers, cv["id"])
    assert client.get(f"{COV}/{cv['id']}", headers=auth_headers).json()["claim_count"] == 2
    r = client.delete(f"{CLM}/{k['id']}", headers=auth_headers)
    assert r.status_code == 204
    assert r.content == b""
    assert client.get(f"{CLM}/{k['id']}", headers=auth_headers).status_code == 404
    assert client.delete(f"{CLM}/{k['id']}", headers=auth_headers).status_code == 404
    assert client.get(f"{COV}/{cv['id']}", headers=auth_headers).json()["claim_count"] == 1
    assert client.get(COV, headers=auth_headers).json()["items"][0]["claim_count"] == 1


def test_ac60_claim_list_ordering_with_ties(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any]
) -> None:
    older = mk_clm(client, auth_headers, cv["id"], date="2026-01-01")
    t1 = mk_clm(client, auth_headers, cv["id"], date="2026-05-05")
    t2 = mk_clm(client, auth_headers, cv["id"], date="2026-05-05")
    newest = mk_clm(client, auth_headers, cv["id"], date="2026-09-09")
    items = client.get(CLM, headers=auth_headers).json()["items"]
    assert [i["id"] for i in items] == [newest["id"], t2["id"], t1["id"], older["id"]]
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(text("UPDATE warranty_claim SET created_at = '2026-05-05T00:00:00Z'"))
    items = client.get(CLM, headers=auth_headers).json()["items"]
    tied = sorted([t1["id"], t2["id"]], reverse=True)
    assert [i["id"] for i in items] == [newest["id"], *tied, older["id"]]


def test_ac60_claim_list_filter_forms(client: TestClient, auth_headers: dict[str, str]) -> None:
    a = mk_cov(client, auth_headers)
    b = mk_cov(client, auth_headers)
    ka = mk_clm(client, auth_headers, a["id"])
    kb = mk_clm(client, auth_headers, b["id"])
    got = lambda p: client.get(CLM, params=p, headers=auth_headers)  # noqa: E731
    assert [i["id"] for i in got({"coverage_id": a["id"]}).json()["items"]] == [ka["id"]]
    assert [i["id"] for i in got({"coverage_id": a["id"].upper()}).json()["items"]] == [ka["id"]]
    assert [i["id"] for i in got({"coverage_id": b["id"]}).json()["items"]] == [kb["id"]]
    assert got({"coverage_id": new_id()}).json() == {"items": []}
    assert len(got({}).json()["items"]) == 2
    for bad in ("nope", "123", "' OR 1=1 --", " " + a["id"], a["id"] + "x", "\x00"):
        r = quiet(client).get(CLM, params={"coverage_id": bad}, headers=auth_headers)
        assert r.status_code == 400, bad
        assert "coverage_id" in fields(r)


def test_ac60_claim_list_empty_coverage_id_param(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any]
) -> None:
    mk_clm(client, auth_headers, cv["id"])
    r = quiet(client).get(CLM, params={"coverage_id": ""}, headers=auth_headers)
    assert r.status_code in (200, 400)


def test_ac60_claim_cost_has_no_side_effects(
    client: TestClient, auth_headers: dict[str, str], cv: dict[str, Any]
) -> None:
    rec = _add_record(client, auth_headers)
    client.post(
        EXP,
        json={"id": new_id(), "date": "2026-09-01", "category": "other", "amount_minor": 777},
        headers=auth_headers,
    )
    exp_before = client.get(EXP, headers=auth_headers).json()
    sum_before = client.get(f"{EXP}/summary", headers=auth_headers).json()
    k = mk_clm(client, auth_headers, cv["id"], cost_covered_minor=123456)
    _cpatch(client, auth_headers, k["id"], {"cost_covered_minor": 999999, "status": "completed"})
    client.delete(f"{CLM}/{k['id']}", headers=auth_headers)
    mk_clm(client, auth_headers, cv["id"], cost_covered_minor=5)
    client.delete(f"{COV}/{cv['id']}", headers=auth_headers)
    assert client.get(EXP, headers=auth_headers).json() == exp_before
    assert client.get(f"{EXP}/summary", headers=auth_headers).json() == sum_before
    assert client.get(f"{SR}/{rec['id']}", headers=auth_headers).json() == rec
    assert count_rows(client, "expense") == 1
    assert count_rows(client, "service_record") == 1
    assert count_rows(client, "reminder") == 0


def test_ac67_no_reminder_created_by_coverage_end_date(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    mk_cov(client, auth_headers, end_date="2026-11-01")
    assert count_rows(client, "reminder") == 0


# --- AC-66: stored literally -------------------------------------------------------------------

_HOSTILE = [
    "<img src=x onerror=alert(1)>",
    "<script>alert(1)</script>",
    "'; DROP TABLE warranty_coverage; --",
    "{{7*7}} ${7*7} %s %(x)s",
    "\u202eRTL \U0001f697 e\u0301",
    "a\r\nb\tc",
]


@pytest.mark.parametrize("s", _HOSTILE)
def test_ac66_text_round_trips_literally(
    client: TestClient, auth_headers: dict[str, str], s: str
) -> None:
    c = mk_cov(client, auth_headers, name=s, notes=s, source_note=s)
    k = mk_clm(client, auth_headers, c["id"], description=s, notes=s)
    got = client.get(f"{COV}/{c['id']}", headers=auth_headers).json()
    assert (got["name"], got["notes"], got["source_note"]) == (s, s, s)
    gk = client.get(f"{CLM}/{k['id']}", headers=auth_headers).json()
    assert (gk["description"], gk["notes"]) == (s, s)
    r = client.get(COV, headers=auth_headers)
    assert r.headers["content-type"].startswith("application/json")
    assert r.headers["cache-control"] == "no-store"
    assert count_rows(client, "warranty_coverage") == 1


# --- OpenAPI vs contract ----------------------------------------------------------------------


@pytest.fixture(scope="module")
def schema() -> dict[str, Any]:
    return build_schema()


def test_openapi_warranty_routes_and_codes(schema: dict[str, Any]) -> None:
    c = "/api/v1/warranty-coverages"
    k = "/api/v1/warranty-claims"
    expected = {
        ("post", c): {"201", "200", "400", "401", "409", "500"},
        ("get", c): {"200", "400", "401", "500"},
        ("get", c + "/{coverage_id}"): {"200", "400", "401", "404", "500"},
        ("patch", c + "/{coverage_id}"): {"200", "400", "401", "404", "500"},
        ("delete", c + "/{coverage_id}"): {"204", "400", "401", "404", "500"},
        ("post", k): {"201", "200", "400", "401", "409", "500"},
        ("get", k): {"200", "400", "401", "500"},
        ("get", k + "/{claim_id}"): {"200", "400", "401", "404", "500"},
        ("patch", k + "/{claim_id}"): {"200", "400", "401", "404", "500"},
        ("delete", k + "/{claim_id}"): {"204", "400", "401", "404", "500"},
        ("get", "/api/v1/warranty-templates"): {"200", "401", "500"},
    }
    found = {(m, p) for p, item in schema["paths"].items() for m in item if "warranty" in p}
    assert found == set(expected)
    for (method, path), codes in expected.items():
        op = schema["paths"][path][method]
        assert codes <= set(op["responses"]), (method, path)
        assert op["security"] == [{"bearerAuth": []}]


def test_openapi_warranty_query_params(schema: dict[str, Any]) -> None:
    def names(path: str) -> set[str]:
        return {p["name"] for p in schema["paths"][path]["get"].get("parameters", [])}

    assert names("/api/v1/warranty-coverages") == {"today"}
    assert names("/api/v1/warranty-coverages/{coverage_id}") == {"today", "coverage_id"}
    assert names("/api/v1/warranty-claims") == {"coverage_id"}
    assert names("/api/v1/warranty-templates") == set()


def test_openapi_coverage_schemas_match_contract(schema: dict[str, Any]) -> None:
    s = schema["components"]["schemas"]
    create = s["WarrantyCoverageCreate"]
    assert set(create["required"]) == {"id", "name", "provider_type", "start_date"}
    assert create["additionalProperties"] is False
    assert set(create["properties"]) == {
        "id", "name", "provider_type", "start_date", "end_date", "km_limit", "notes",
        "source_kind", "verification_status", "source_note", "template_ref",
    }  # fmt: skip
    patch = s["WarrantyCoveragePatch"]
    assert patch["additionalProperties"] is False
    assert set(patch["properties"]) == {
        "name", "provider_type", "start_date", "end_date", "km_limit", "notes",
        "verification_status", "source_note",
    }  # fmt: skip
    assert not patch.get("required")
    assert set(s["WarrantyCoverageOut"]["required"]) == {
        "id", "name", "provider_type", "start_date", "end_date", "km_limit", "notes",
        "source_kind", "verification_status", "source_note", "template_ref", "status",
        "expired_by", "expiring_soon_by", "claim_count", "created_at", "updated_at",
    }  # fmt: skip
    assert set(s["WarrantyCoverageList"]["required"]) == {"items", "current_odometer"}


def test_openapi_claim_schemas_match_contract(schema: dict[str, Any]) -> None:
    s = schema["components"]["schemas"]
    create = s["WarrantyClaimCreate"]
    assert set(create["required"]) == {
        "id", "coverage_id", "date", "odometer", "description", "status",
    }  # fmt: skip
    assert create["additionalProperties"] is False
    patch = s["WarrantyClaimPatch"]
    assert patch["additionalProperties"] is False
    assert "coverage_id" not in patch["properties"]
    assert "id" not in patch["properties"]
    assert set(s["WarrantyClaimOut"]["required"]) == {
        "id", "coverage_id", "date", "odometer", "description", "status",
        "cost_covered_minor", "currency", "notes", "created_at", "updated_at",
    }  # fmt: skip


def test_openapi_enums_match_contract(schema: dict[str, Any]) -> None:
    s = schema["components"]["schemas"]
    cp = s["WarrantyCoverageCreate"]["properties"]
    assert cp["provider_type"]["enum"] == ["factory", "extended"]
    assert cp["source_kind"]["enum"] == ["owner_entered", "template"]
    assert cp["verification_status"]["enum"] == ["confirmed", "proposed", "unverified"]
    assert s["WarrantyClaimCreate"]["properties"]["status"]["enum"] == [
        "submitted", "approved", "rejected", "completed",
    ]  # fmt: skip
    assert s["WarrantyCoverageOut"]["properties"]["status"]["enum"] == [
        "not_started", "active", "expiring_soon", "expired",
    ]  # fmt: skip


def test_openapi_bounds_match_contract(schema: dict[str, Any]) -> None:
    s = schema["components"]["schemas"]
    km = s["WarrantyCoverageCreate"]["properties"]["km_limit"]["anyOf"][0]
    assert (km["minimum"], km["maximum"]) == (1, 10_000_000)
    od = s["WarrantyClaimCreate"]["properties"]["odometer"]
    assert (od["minimum"], od["maximum"]) == (0, 10_000_000)
    assert s["WarrantyCoverageCreate"]["properties"]["name"]["maxLength"] == 200
    assert s["WarrantyClaimCreate"]["properties"]["description"]["maxLength"] == 500


def test_ac67_openapi_advertises_no_provider_or_certificate_field(schema: dict[str, Any]) -> None:
    banned = ("provider", "certificate", "document", "attachment", "vin", "registration", "licence")
    for name, sch in schema["components"]["schemas"].items():
        if "arranty" not in name:
            continue
        for prop in sch.get("properties", {}):
            if prop == "provider_type":
                continue
            assert not any(b in prop.lower() for b in banned), (name, prop)


@pytest.mark.parametrize("model", ["WarrantyCoveragePatch", "WarrantyClaimPatch"])
@pytest.mark.xfail(
    strict=True,
    reason="QA-W1: OpenAPI patch schemas advertise null for fields the API rejects with 400 "
    "(same as expenses QA-E5)",
)
def test_openapi_patch_does_not_advertise_null_for_non_nullable_fields(
    schema: dict[str, Any], model: str
) -> None:
    non_nullable = {
        "WarrantyCoveragePatch": ("name", "provider_type", "start_date", "verification_status"),
        "WarrantyClaimPatch": ("date", "odometer", "description", "status", "currency"),
    }[model]
    props = schema["components"]["schemas"][model]["properties"]
    for name in non_nullable:
        assert {"type": "null"} not in props[name].get("anyOf", []), name


# --- DB defence in depth ----------------------------------------------------------------------

_INS = (
    "INSERT INTO warranty_coverage (id, name, provider_type, start_date, end_date, km_limit, "
    "source_kind, verification_status, template_ref) "
    "VALUES (:id, :name, :pt, :sd, :ed, :km, :sk, :vs, :tr)"
)


def _cov_params(**o: Any) -> dict[str, Any]:
    p: dict[str, Any] = {
        "id": uuid.uuid4(), "name": "n", "pt": "factory", "sd": dt.date(2026, 1, 1),
        "ed": dt.date(2027, 1, 1), "km": 1, "sk": "owner_entered", "vs": "unverified", "tr": None,
    }  # fmt: skip
    p.update(o)
    return p


@pytest.mark.parametrize(
    "o",
    [
        {"tr": "x"},
        {"sk": "template", "tr": "x" * 101},
        {"name": "n" * 201},
        {"sd": dt.date(2201, 1, 1), "ed": None},
        {"ed": dt.date(2201, 1, 1)},
        {"ed": dt.date(1999, 12, 31), "sd": dt.date(1999, 12, 30)},
        {"km": -5, "ed": None},
    ],
)
def test_db_more_coverage_constraints(client: TestClient, o: dict[str, Any]) -> None:
    engine = client.app.state.engine  # type: ignore[attr-defined]
    with pytest.raises((IntegrityError, DataError)), engine.begin() as conn:
        conn.execute(text(_INS), _cov_params(**o))


def test_db_valid_coverage_insert_works(client: TestClient) -> None:
    engine = client.app.state.engine  # type: ignore[attr-defined]
    with engine.begin() as conn:
        conn.execute(text(_INS), _cov_params(sk="template", tr="x" * 100))
        conn.execute(text(_INS), _cov_params(sd=dt.date(2000, 1, 1), ed=None, km=10_000_000))
    assert count_rows(client, "warranty_coverage") == 2


@pytest.mark.parametrize(
    "o",
    [
        {"status": "closed"},
        {"odometer": -1},
        {"odometer": 10_000_001},
        {"cost": -1},
        {"cost": 10**12 + 1},
        {"currency": "USD"},
        {"date": dt.date(1999, 12, 31)},
        {"description": ""},
        {"description": "d" * 501},
    ],
)
def test_db_claim_constraints(client: TestClient, o: dict[str, Any]) -> None:
    cid = uuid.uuid4()
    p: dict[str, Any] = {
        "id": uuid.uuid4(), "c": cid, "date": dt.date(2026, 1, 1), "odo": 1, "d": "d",
        "status": "submitted", "cost": None, "currency": "MYR",
    }  # fmt: skip
    for k, v in o.items():
        p["odo" if k == "odometer" else "d" if k == "description" else k] = v
    engine = client.app.state.engine  # type: ignore[attr-defined]
    with engine.begin() as conn:
        conn.execute(text(_INS), _cov_params(id=cid))
    with pytest.raises((IntegrityError, DataError)), engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO warranty_claim (id, coverage_id, date, odometer, description, status,"
                " cost_covered_minor, currency) VALUES (:id, :c, :date, :odo, :d, :status,"
                " :cost, :currency)"
            ),
            p,
        )


def test_db_cascade_at_sql_level(client: TestClient) -> None:
    engine = client.app.state.engine  # type: ignore[attr-defined]
    cid = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(text(_INS), _cov_params(id=cid))
        conn.execute(
            text(
                "INSERT INTO warranty_claim (id, coverage_id, date, odometer, description, status)"
                " SELECT gen_random_uuid(), :c, '2026-01-01', 1, 'd', 'submitted'"
                " FROM generate_series(1, 3)"
            ),
            {"c": cid},
        )
    assert count_rows(client, "warranty_claim") == 3
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM warranty_coverage WHERE id = :c"), {"c": cid})
    assert count_rows(client, "warranty_claim") == 0


def test_db_claim_fk_rejects_orphan_and_blocks_reparent(client: TestClient) -> None:
    engine = client.app.state.engine  # type: ignore[attr-defined]
    cid = uuid.uuid4()
    with engine.begin() as conn:
        conn.execute(text(_INS), _cov_params(id=cid))
        conn.execute(
            text(
                "INSERT INTO warranty_claim (id, coverage_id, date, odometer, description, status)"
                " VALUES (gen_random_uuid(), :c, '2026-01-01', 1, 'd', 'submitted')"
            ),
            {"c": cid},
        )
    with pytest.raises(IntegrityError, match="fk_warranty_claim"), engine.begin() as conn:
        conn.execute(text("UPDATE warranty_claim SET coverage_id = gen_random_uuid()"))


# --- concurrency and queries -----------------------------------------------------------------


def test_claim_create_racing_coverage_delete_leaves_no_orphan_and_no_500(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    tc = quiet(client)
    for _ in range(6):
        c = mk_cov(client, auth_headers)
        bodies = [clm(c["id"]) for _ in range(6)]
        codes: list[int] = []

        def create(b: dict[str, Any]) -> None:
            codes.append(tc.post(CLM, json=b, headers=auth_headers).status_code)  # noqa: B023

        def delete() -> None:
            codes.append(tc.delete(f"{COV}/{c['id']}", headers=auth_headers).status_code)  # noqa: B023

        ts = [threading.Thread(target=create, args=(b,)) for b in bodies]
        ts.append(threading.Thread(target=delete))
        [t.start() for t in ts]
        [t.join() for t in ts]
        assert set(codes) <= {201, 400, 204}, codes
        with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
            orphans = conn.execute(
                text(
                    "SELECT count(*) FROM warranty_claim k LEFT JOIN warranty_coverage c "
                    "ON c.id = k.coverage_id WHERE c.id IS NULL"
                )
            ).scalar_one()
        assert orphans == 0
        assert count_rows(client, "warranty_claim") == 0


def test_get_racing_with_delete_is_not_500(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    from app.repositories.warranty import WarrantyCoverageRepository

    c = mk_cov(client, auth_headers)
    original = WarrantyCoverageRepository.get

    def racing(self: Any, coverage_id: uuid.UUID) -> Any:
        row = original(self, coverage_id)
        with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
            conn.execute(text("DELETE FROM warranty_coverage WHERE id = :i"), {"i": c["id"]})
        return row

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(WarrantyCoverageRepository, "get", racing)
        r = quiet(client).get(f"{COV}/{c['id']}", headers=auth_headers)
    assert r.status_code in (200, 404), r.text


def test_claim_get_racing_with_delete_is_not_500(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    from app.repositories.warranty import WarrantyClaimRepository

    c = mk_cov(client, auth_headers)
    k = mk_clm(client, auth_headers, c["id"])
    original = WarrantyClaimRepository.get

    def racing(self: Any, claim_id: uuid.UUID) -> Any:
        row = original(self, claim_id)
        with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
            conn.execute(text("DELETE FROM warranty_claim WHERE id = :i"), {"i": k["id"]})
        return row

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(WarrantyClaimRepository, "get", racing)
        r = quiet(client).get(f"{CLM}/{k['id']}", headers=auth_headers)
    assert r.status_code in (200, 404), r.text


def test_concurrent_delete_and_reads_never_500(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    tc = quiet(client)
    for _ in range(5):
        c = mk_cov(client, auth_headers)
        k = mk_clm(client, auth_headers, c["id"])
        codes: list[int] = []
        calls = [
            lambda: tc.delete(f"{COV}/{c['id']}", headers=auth_headers),  # noqa: B023
            lambda: tc.get(f"{COV}/{c['id']}", headers=auth_headers),  # noqa: B023
            lambda: tc.get(COV, headers=auth_headers),
            lambda: tc.get(f"{CLM}/{k['id']}", headers=auth_headers),  # noqa: B023
            lambda: tc.get(CLM, headers=auth_headers),
        ]

        def run(f: Any) -> None:
            codes.append(f().status_code)  # noqa: B023

        ts = [threading.Thread(target=run, args=(f,)) for f in calls]
        [t.start() for t in ts]
        [t.join() for t in ts]
        assert all(code < 500 for code in codes), codes


def test_cap_holds_under_concurrency_for_claims_and_coverages(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    for n in range(48):
        mk_cov(client, auth_headers, name=f"c{n}")
    tc = quiet(client)
    codes: list[int] = []

    def go() -> None:
        codes.append(tc.post(COV, json=cov(), headers=auth_headers).status_code)

    ts = [threading.Thread(target=go) for _ in range(8)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert codes.count(201) == 2
    assert set(codes) <= {201, 400}
    assert count_rows(client, "warranty_coverage") == 50


def _count_statements(client: TestClient, fn: Any) -> int:
    statements: list[str] = []
    engine = client.app.state.engine  # type: ignore[attr-defined]

    def hook(*args: Any) -> None:
        statements.append(args[2])

    event.listen(engine, "before_cursor_execute", hook)
    try:
        fn()
    finally:
        event.remove(engine, "before_cursor_execute", hook)
    return len(statements)


def test_query_count_constant_for_coverage_list(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    def seed(n: int) -> None:
        for i in range(n):
            c = mk_cov(client, auth_headers, name=f"c{i}-{new_id()[:4]}")
            mk_clm(client, auth_headers, c["id"])
            mk_clm(client, auth_headers, c["id"])

    seed(2)
    small = _count_statements(client, lambda: client.get(COV, headers=auth_headers))
    seed(18)
    big = _count_statements(client, lambda: client.get(COV, headers=auth_headers))
    assert big == small, (small, big)
    assert big <= 8


def test_query_count_constant_for_claim_list(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    c = mk_cov(client, auth_headers)
    for _ in range(2):
        mk_clm(client, auth_headers, c["id"])
    small = _count_statements(client, lambda: client.get(CLM, headers=auth_headers))
    for _ in range(18):
        mk_clm(client, auth_headers, c["id"])
    big = _count_statements(client, lambda: client.get(CLM, headers=auth_headers))
    assert big == small, (small, big)


def test_every_response_kind_is_no_store(client: TestClient, auth_headers: dict[str, str]) -> None:
    c = mk_cov(client, auth_headers)
    calls = [
        client.get(COV, headers=auth_headers),
        client.get(f"{COV}/{new_id()}", headers=auth_headers),
        client.get(COV, params={"today": "x"}, headers=auth_headers),
        client.delete(f"{COV}/{c['id']}", headers=auth_headers),
        client.get(TPL, headers=auth_headers),
        client.get(TPL),
        client.post(COV, content=b"x" * 70_000, headers={**auth_headers, **JSON_CT}),
        client.put(COV, headers=auth_headers),
    ]
    for r in calls:
        assert r.headers.get("cache-control") == "no-store", r.status_code


def test_coverage_patch_racing_delete_is_not_500(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    from app.repositories.warranty import WarrantyCoverageRepository

    c = mk_cov(client, auth_headers)
    original = WarrantyCoverageRepository.apply

    def racing(self: Any, row: Any, changes: dict[str, Any]) -> Any:
        out = original(self, row, changes)
        with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
            conn.execute(text("DELETE FROM warranty_coverage WHERE id = :i"), {"i": c["id"]})
        return out

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(WarrantyCoverageRepository, "apply", racing)
        r = quiet(client).patch(f"{COV}/{c['id']}", json={"name": "z"}, headers=auth_headers)
    assert r.status_code in (200, 404), r.status_code


def test_claim_patch_racing_delete_is_not_500(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    from app.repositories.warranty import WarrantyClaimRepository

    c = mk_cov(client, auth_headers)
    k = mk_clm(client, auth_headers, c["id"])
    original = WarrantyClaimRepository.apply

    def racing(self: Any, row: Any, changes: dict[str, Any]) -> Any:
        out = original(self, row, changes)
        with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
            conn.execute(text("DELETE FROM warranty_claim WHERE id = :i"), {"i": k["id"]})
        return out

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(WarrantyClaimRepository, "apply", racing)
        r = quiet(client).patch(f"{CLM}/{k['id']}", json={"notes": "z"}, headers=auth_headers)
    assert r.status_code in (200, 404), r.status_code
