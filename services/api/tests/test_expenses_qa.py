"""Independent QA probes for the Expenses backend (FR-5; AC-30 to AC-47).

Written by QA, separate from tests/test_expenses.py. Disposable data only. Tests marked
xfail(strict=True) document a defect (QA-E<n>, see
docs/testing/qa-report-2026-10-22-expenses-backend.md);
when the defect is fixed the strict xfail fails and the marker must be removed.
"""

from __future__ import annotations

import base64
import datetime as dt
import json
import pathlib
import threading
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, text

from app import schemas
from app.cli.export_openapi import build_schema
from app.clock import today_kl
from app.repositories.expenses import ExpenseRepository
from tests.conftest import new_id

URL = "/api/v1/expenses"
SUMMARY = f"{URL}/summary"
JSON_CT = {"content-type": "application/json"}
VECTORS = (
    pathlib.Path(__file__).resolve().parents[3]
    / "packages/shared-types/test-vectors/expense-totals.json"
)
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
        "amount_minor": 1000,
    }
    b.update(overrides)
    return b


def post(client: TestClient, headers: dict[str, str], **overrides: Any) -> dict[str, Any]:
    r = client.post(URL, json=body(**overrides), headers=headers)
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def fields(r: Any) -> list[str]:
    return [d["field"] for d in r.json()["error"]["details"]]


def raw_body(amount: str) -> str:
    return f'{{"id":"{new_id()}","date":"2026-09-01","category":"other","amount_minor":{amount}}}'


def utc(*a: int) -> dt.datetime:
    return dt.datetime(*a, tzinfo=dt.UTC)


def freeze(monkeypatch: pytest.MonkeyPatch, instant: dt.datetime) -> None:
    monkeypatch.setattr(schemas, "today_kl", lambda: today_kl(instant))


def enc(obj: Any) -> str:
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")


def rows_in_db(client: TestClient) -> int:
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        return int(conn.execute(text("SELECT count(*) FROM expense")).scalar_one())


# --- date edges -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("now", "ok", "bad"),
    [
        (utc(2026, 10, 21, 15, 59, 59), "2026-10-21", "2026-10-22"),
        (utc(2026, 10, 21, 16, 0, 0), "2026-10-22", "2026-10-23"),
        (utc(2026, 12, 31, 16, 0, 0), "2027-01-01", "2027-01-02"),
        (utc(2028, 2, 28, 16, 0, 0), "2028-02-29", "2028-03-01"),
    ],
)
def test_today_boundary_in_kuala_lumpur(
    client: TestClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    now: dt.datetime,
    ok: str,
    bad: str,
) -> None:
    freeze(monkeypatch, now)
    assert client.post(URL, json=body(date=ok), headers=auth_headers).status_code == 201
    r = client.post(URL, json=body(date=bad), headers=auth_headers)
    assert r.status_code == 400
    assert fields(r) == ["date"]


def test_patch_future_date_uses_kl_today(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    e = post(client, auth_headers)
    freeze(monkeypatch, utc(2026, 10, 21, 16, 0, 0))
    assert (
        client.patch(
            f"{URL}/{e['id']}", json={"date": "2026-10-22"}, headers=auth_headers
        ).status_code
        == 200
    )
    assert (
        client.patch(
            f"{URL}/{e['id']}", json={"date": "2026-10-23"}, headers=auth_headers
        ).status_code
        == 400
    )


@pytest.mark.parametrize("d", ["1999-12-31", "0001-01-01", "0000-01-01", "2026-1-5", "2026/09/01"])
def test_dates_rejected(client: TestClient, auth_headers: dict[str, str], d: str) -> None:
    r = client.post(URL, json=body(date=d), headers=auth_headers)
    assert r.status_code == 400
    assert "date" in fields(r)


@pytest.mark.parametrize("d", ["2026-09-01T00:00:00", "2026-09-01T00:00:00Z", " 2026-09-01"])
def test_datetime_strings_are_not_dates(
    client: TestClient, auth_headers: dict[str, str], d: str
) -> None:
    r = client.post(URL, json=body(date=d), headers=auth_headers)
    assert r.status_code in (201, 400)
    if r.status_code == 201:
        assert r.json()["date"] == "2026-09-01"


# --- amounts --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw",
    ["1e3", "1000.0", "true", '"1"', "[1]", "{}", "null", "-0", "1000000000001", "NaN", "Infinity"],
)
def test_amount_raw_json_forms_rejected(
    client: TestClient, auth_headers: dict[str, str], raw: str
) -> None:
    content = raw_body(raw)
    r = client.post(URL, content=content.encode(), headers={**auth_headers, **JSON_CT})
    assert r.status_code == 400, (raw, r.text)
    assert r.json()["error"]["code"] == "validation_error"
    assert rows_in_db(client) == 0


def test_amount_extremes_round_trip(client: TestClient, auth_headers: dict[str, str]) -> None:
    for amount in (1, 10**12):
        e = post(client, auth_headers, amount_minor=amount)
        assert client.get(f"{URL}/{e['id']}", headers=auth_headers).json()["amount_minor"] == amount
    assert client.get(SUMMARY, headers=auth_headers).json()["total_minor"] == 10**12 + 1


def test_amount_giant_integer_is_400_not_500(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    tc = TestClient(client.app, raise_server_exceptions=False)
    content = raw_body("9" * 300)
    r = tc.post(URL, content=content.encode(), headers={**auth_headers, **JSON_CT})
    assert r.status_code == 400


# --- notes: trim / null / unicode / length --------------------------------------------------


def test_notes_unicode_and_emoji_round_trip(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    for notes in (
        "Cha\u0301rge \u2014 RM12",
        "\U0001f697\u26a1 charge",
        "\u202eRTL",
        "\u0e17\u0e14\u0e2a\u0e2d\u0e1a",
    ):
        e = post(client, auth_headers, notes=notes)
        assert client.get(f"{URL}/{e['id']}", headers=auth_headers).json()["notes"] == notes


def test_notes_5000_emoji_accepted_5001_rejected(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    for n, code in ((5000, 201), (5001, 400)):
        payload = json.dumps(body(notes="\U0001f697" * n), ensure_ascii=False).encode()
        r = client.post(URL, content=payload, headers={**auth_headers, **JSON_CT})
        assert r.status_code == code, (n, r.text[:200])


def test_notes_surrounding_whitespace_trimmed_and_replay_equal(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body(notes="  hi \n")
    assert client.post(URL, json=b, headers=auth_headers).json()["notes"] == "hi"
    assert client.post(URL, json=b, headers=auth_headers).status_code == 200
    assert client.post(URL, json={**b, "notes": "hi"}, headers=auth_headers).status_code == 200


def test_notes_interior_whitespace_and_newlines_kept(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    e = post(client, auth_headers, notes="a  b\n\nc\t d")
    assert e["notes"] == "a  b\n\nc\t d"


def test_whitespace_only_notes_normalise_to_null(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    e = post(client, auth_headers, notes="   ")
    assert e["notes"] is None


def test_empty_string_notes_is_stored_as_null(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body(notes="")
    assert client.post(URL, json=b, headers=auth_headers).json()["notes"] is None
    assert client.post(URL, json={**b, "notes": None}, headers=auth_headers).status_code == 200


def test_patch_notes_empty_string_and_null(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    e = post(client, auth_headers, notes="x")
    assert (
        client.patch(f"{URL}/{e['id']}", json={"notes": ""}, headers=auth_headers).json()["notes"]
        is None
    )
    assert (
        client.patch(f"{URL}/{e['id']}", json={"notes": None}, headers=auth_headers).json()["notes"]
        is None
    )
    assert (
        client.patch(f"{URL}/{e['id']}", json={"notes": "  y "}, headers=auth_headers).json()[
            "notes"
        ]
        == "y"
    )


@pytest.mark.parametrize("notes", ["a\x00", "\x00", "a\u0000b"])
def test_nul_in_notes_rejected_on_create_and_patch(
    client: TestClient, auth_headers: dict[str, str], notes: str
) -> None:
    assert client.post(URL, json=body(notes=notes), headers=auth_headers).status_code == 400
    e = post(client, auth_headers)
    assert (
        client.patch(f"{URL}/{e['id']}", json={"notes": notes}, headers=auth_headers).status_code
        == 400
    )


def test_lone_surrogate_in_notes_is_400(client: TestClient, auth_headers: dict[str, str]) -> None:
    raw = raw_body("1").replace("}", ',"notes":"\\ud800"}')
    tc = TestClient(client.app, raise_server_exceptions=False)
    assert (
        tc.post(URL, content=raw.encode(), headers={**auth_headers, **JSON_CT}).status_code == 400
    )


# --- unknown / immutable / null fields ------------------------------------------------------


@pytest.mark.parametrize(
    "extra",
    [
        {"id": None},
        {"created_at": "2026-01-01T00:00:00Z"},
        {"updated_at": "x"},
        {"Date": "2026-01-01"},
    ],
)
def test_patch_unknown_and_immutable_fields_rejected(
    client: TestClient, auth_headers: dict[str, str], extra: dict[str, Any]
) -> None:
    e = post(client, auth_headers)
    r = client.patch(f"{URL}/{e['id']}", json=extra, headers=auth_headers)
    assert r.status_code == 400
    assert client.get(f"{URL}/{e['id']}", headers=auth_headers).json() == e


@pytest.mark.parametrize("raw", [b"null", b"[]", b'"x"', b"5"])
def test_patch_non_object_body_is_400(
    client: TestClient, auth_headers: dict[str, str], raw: bytes
) -> None:
    e = post(client, auth_headers)
    for target in (e["id"], new_id()):
        r = client.patch(f"{URL}/{target}", content=raw, headers={**auth_headers, **JSON_CT})
        assert r.status_code == 400
        assert r.json()["error"]["code"] == "validation_error"


def test_patch_updates_updated_at_not_created_at(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    e = post(client, auth_headers)
    out = client.patch(f"{URL}/{e['id']}", json={"amount_minor": 2}, headers=auth_headers).json()
    assert out["created_at"] == e["created_at"]
    assert out["updated_at"] > e["updated_at"]
    assert out["id"] == e["id"]


def test_patch_then_replay_original_create_is_conflict(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body()
    client.post(URL, json=b, headers=auth_headers)
    client.patch(f"{URL}/{b['id']}", json={"amount_minor": 2}, headers=auth_headers)
    assert client.post(URL, json=b, headers=auth_headers).status_code == 409


def test_patch_with_identical_values_is_ok(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    e = post(client, auth_headers, notes="n")
    r = client.patch(
        f"{URL}/{e['id']}",
        json={k: e[k] for k in ("date", "category", "amount_minor", "currency", "notes")},
        headers=auth_headers,
    )
    assert r.status_code == 200


def test_patch_validation_beats_404(client: TestClient, auth_headers: dict[str, str]) -> None:
    r = client.patch(f"{URL}/{new_id()}", json={"amount_minor": 0}, headers=auth_headers)
    assert r.status_code == 400


# --- id handling ----------------------------------------------------------------------------


def test_id_forms_normalise_and_replay(client: TestClient, auth_headers: dict[str, str]) -> None:
    u = uuid.uuid4()
    b = body(id=str(u).upper())
    first = client.post(URL, json=b, headers=auth_headers)
    assert first.status_code == 201
    assert first.json()["id"] == str(u)
    assert client.post(URL, json={**b, "id": str(u)}, headers=auth_headers).status_code == 200
    assert client.get(f"{URL}/{str(u).upper()}", headers=auth_headers).status_code == 200
    assert rows_in_db(client) == 1


@pytest.mark.parametrize(
    "bad", ["", "0", "x" * 40, " " + str(uuid.uuid4()), None, 5, str(uuid.uuid4()) + "0"]
)
def test_bad_ids_rejected(client: TestClient, auth_headers: dict[str, str], bad: Any) -> None:
    r = client.post(URL, json=body(id=bad), headers=auth_headers)
    assert r.status_code == 400
    assert "id" in fields(r)


# --- list: paging, cursor, filters ----------------------------------------------------------


def test_identical_dates_and_amounts_page_without_loss_or_dup(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    ids = [post(client, auth_headers, date="2026-09-01", amount_minor=7)["id"] for _ in range(23)]
    seen: list[str] = []
    cursor: str | None = None
    for _ in range(30):
        params: dict[str, Any] = {"limit": 5}
        if cursor:
            params["cursor"] = cursor
        page = client.get(URL, params=params, headers=auth_headers).json()
        seen += [i["id"] for i in page["items"]]
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert sorted(seen) == sorted(ids)
    assert len(seen) == len(set(seen))
    assert seen == list(reversed(ids))


def test_ordering_matches_date_created_at_id_desc_on_equal_created_at(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    ids = sorted(new_id() for _ in range(6))
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        for i in ids:
            conn.execute(
                text(
                    "INSERT INTO expense (id, date, category, amount_minor, created_at) "
                    "VALUES (:i, DATE '2026-05-05', 'other', 1, "
                    "TIMESTAMPTZ '2026-05-05 00:00:00+00')"
                ),
                {"i": i},
            )
    got = [i["id"] for i in client.get(URL, headers=auth_headers).json()["items"]]
    assert got == list(reversed(ids))
    page1 = client.get(URL, params={"limit": 2}, headers=auth_headers).json()
    page2 = client.get(
        URL, params={"limit": 4, "cursor": page1["next_cursor"]}, headers=auth_headers
    ).json()
    assert [i["id"] for i in page1["items"] + page2["items"]] == list(reversed(ids))


def test_cursor_survives_deletion_of_the_cursor_row(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    ids = [post(client, auth_headers, date=f"2026-08-{d:02d}")["id"] for d in range(1, 7)]
    page1 = client.get(URL, params={"limit": 3}, headers=auth_headers).json()
    client.delete(f"{URL}/{page1['items'][-1]['id']}", headers=auth_headers)
    page2 = client.get(URL, params={"cursor": page1["next_cursor"]}, headers=auth_headers).json()
    assert [i["id"] for i in page2["items"]] == list(reversed(ids[:3]))


def test_cursor_from_one_filter_used_with_another_is_still_well_defined(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    for d in range(1, 5):
        post(client, auth_headers, date=f"2026-08-0{d}", category="tolls")
    cur = client.get(URL, params={"limit": 1}, headers=auth_headers).json()["next_cursor"]
    r = client.get(
        URL, params={"cursor": cur, "category": "tolls", "from": "2026-08-02"}, headers=auth_headers
    )
    assert r.status_code == 200
    assert [i["date"] for i in r.json()["items"]] == ["2026-08-03", "2026-08-02"]


@pytest.mark.parametrize(
    "cursor",
    [
        enc({"d": "2026-01-01", "c": "2026-01-01T00:00:00", "i": str(uuid.uuid4())}),
        enc({"d": "2026-01-01", "c": "2026-01-01T00:00:00+00:00"}),
        enc({"d": "2026-01-01", "c": "2026-01-01T00:00:00+00:00", "i": None}),
        enc({"d": "2026-01-01", "c": "2026-01-01T00:00:00+00:00", "i": "nope"}),
        enc([1, 2]),
        enc("x"),
        enc(None),
        "\u00e9",
        "%00",
        "====",
        "e30=",
    ],
)
def test_tampered_cursor_is_400(
    client: TestClient, auth_headers: dict[str, str], cursor: str
) -> None:
    r = client.get(URL, params={"cursor": cursor}, headers=auth_headers)
    assert r.status_code == 400
    assert fields(r) == ["cursor"]


@pytest.mark.parametrize("bad_i", [5, [], {}, 1.5, True])
def test_cursor_with_non_string_id_is_400(
    client: TestClient, auth_headers: dict[str, str], bad_i: Any
) -> None:
    tc = TestClient(client.app, raise_server_exceptions=False)
    cur = enc({"d": "2026-01-01", "c": "2026-01-01T00:00:00+00:00", "i": bad_i})
    r = tc.get(URL, params={"cursor": cur}, headers=auth_headers)
    assert r.status_code == 400


def test_cursor_is_opaque_and_has_no_padding_issue(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    for d in range(1, 4):
        post(client, auth_headers, date=f"2026-08-0{d}")
    cur = client.get(URL, params={"limit": 1}, headers=auth_headers).json()["next_cursor"]
    assert "=" not in cur
    assert client.get(URL, params={"cursor": cur + "="}, headers=auth_headers).status_code in (
        200,
        400,
    )


def test_empty_cursor_param_means_first_page(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    post(client, auth_headers)
    r = client.get(URL, params={"cursor": ""}, headers=auth_headers)
    assert r.status_code == 200
    assert len(r.json()["items"]) == 1


@pytest.mark.parametrize("limit", ["0", "101", "-1", "abc", "", "1e1", "2.5", "\u0665"])
def test_limit_rejected(client: TestClient, auth_headers: dict[str, str], limit: str) -> None:
    r = client.get(URL, params={"limit": limit}, headers=auth_headers)
    assert r.status_code == 400
    assert fields(r) == ["limit"]


def test_limit_float_string_rejected(client: TestClient, auth_headers: dict[str, str]) -> None:
    for value in ("1.0", " 5"):
        assert client.get(URL, params={"limit": value}, headers=auth_headers).status_code == 400, (
            value
        )


@pytest.mark.parametrize(
    "value",
    [
        "",
        " ",
        "Charging",
        "road-tax",
        "tolls ",
        "' OR 1=1 --",
        "tolls;DROP TABLE expense",
        "%",
        "\x00",
    ],
)
def test_category_filter_invalid_values(
    client: TestClient, auth_headers: dict[str, str], value: str
) -> None:
    post(client, auth_headers)
    for path in (URL, SUMMARY):
        r = client.get(path, params={"category": value}, headers=auth_headers)
        assert r.status_code == 400
        assert fields(r) == ["category"]
    assert rows_in_db(client) == 1


def test_repeated_category_param_is_not_silently_or(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    post(client, auth_headers, category="tolls")
    post(client, auth_headers, category="parking")
    r = client.get(f"{URL}?category=tolls&category=parking", headers=auth_headers)
    assert r.status_code in (200, 400)
    if r.status_code == 200:
        assert len(r.json()["items"]) == 1


@pytest.mark.parametrize("key", ["from", "to"])
@pytest.mark.parametrize(
    "value",
    [
        "",
        "2026-13-01",
        "2026-02-30",
        "20260101",
        "2026-1-1",
        "01-01-2026",
        "2026-01-01T00:00:00",
        " 2026-01-01",
        "\u0662\u0660\u0662\u0666-01-01",
        "' OR 1=1 --",
        "1e3",
        "0",
    ],
)
def test_bad_date_filters(
    client: TestClient, auth_headers: dict[str, str], key: str, value: str
) -> None:
    for path in (URL, SUMMARY):
        r = client.get(path, params={key: value}, headers=auth_headers)
        assert r.status_code == 400, (path, key, value, r.text)
        assert fields(r) == [key]


def test_filter_error_precedence_reports_every_bad_param(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    r = client.get(URL, params={"category": "x", "from": "y", "limit": "z"}, headers=auth_headers)
    assert r.status_code == 400
    assert set(fields(r)) == {"category", "from", "limit"}


def test_from_after_to_and_equal(client: TestClient, auth_headers: dict[str, str]) -> None:
    post(client, auth_headers, date="2026-03-03")
    for path in (URL, SUMMARY):
        assert (
            client.get(
                path, params={"from": "2026-03-04", "to": "2026-03-03"}, headers=auth_headers
            ).status_code
            == 400
        )
        eq = client.get(
            path, params={"from": "2026-03-03", "to": "2026-03-03"}, headers=auth_headers
        )
        assert eq.status_code == 200


def test_filters_outside_the_valid_date_range_are_accepted_and_empty(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    post(client, auth_headers, date="2000-01-01")
    r = client.get(URL, params={"from": "1900-01-01", "to": "1999-12-31"}, headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["items"] == []
    r = client.get(URL, params={"from": "2000-01-01", "to": "9999-12-31"}, headers=auth_headers)
    assert len(r.json()["items"]) == 1


def test_summary_ignores_paging_params(client: TestClient, auth_headers: dict[str, str]) -> None:
    post(client, auth_headers)
    assert (
        client.get(SUMMARY, params={"limit": 1, "cursor": "zzz"}, headers=auth_headers).json()[
            "count"
        ]
        == 1
    )


# --- summary --------------------------------------------------------------------------------


def _vector_cases() -> list[dict[str, Any]]:
    return json.loads(VECTORS.read_text())["cases"]  # type: ignore[no-any-return]


@pytest.mark.parametrize("case", _vector_cases(), ids=lambda c: c["name"])
def test_ac41_shared_vectors_match_server(
    client: TestClient, auth_headers: dict[str, str], case: dict[str, Any]
) -> None:
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        for e in case["expenses"]:
            conn.execute(
                text(
                    "INSERT INTO expense (id, date, category, amount_minor) "
                    "VALUES (gen_random_uuid(), :date, :category, :amount_minor)"
                ),
                {**e, "date": dt.date.fromisoformat(e["date"])},
            )
    flt = case["filter"]
    params = {
        k: v
        for k, v in (
            ("category", flt.get("category")),
            ("from", flt.get("from")),
            ("to", flt.get("to")),
        )
        if v
    }
    r = client.get(SUMMARY, params=params, headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == {"currency": "MYR", **case["expected"]}


def test_summary_shape_is_exact(client: TestClient, auth_headers: dict[str, str]) -> None:
    post(client, auth_headers)
    s = client.get(SUMMARY, headers=auth_headers).json()
    assert set(s) == {"currency", "total_minor", "count", "by_category", "by_month"}
    assert set(s["by_category"][0]) == {"category", "total_minor", "count"}
    assert set(s["by_month"][0]) == {"month", "total_minor", "count"}


def test_summary_months_across_years_and_2000_boundary(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    for d in ("2000-01-01", "2000-12-31", "2001-01-01", "2026-01-31", "2026-02-01"):
        post(client, auth_headers, date=d, amount_minor=1)
    months = [m["month"] for m in client.get(SUMMARY, headers=auth_headers).json()["by_month"]]
    assert months == ["2026-02", "2026-01", "2001-01", "2000-12", "2000-01"]


def test_summary_every_category_listed_in_total_then_name_order(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    for c in CATEGORIES:
        post(client, auth_headers, category=c, amount_minor=5)
    cats = [c["category"] for c in client.get(SUMMARY, headers=auth_headers).json()["by_category"]]
    assert cats == sorted(CATEGORIES)


def test_summary_filters_combine_and_match_list(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    for i, c in enumerate(CATEGORIES):
        post(client, auth_headers, category=c, date=f"2026-0{1 + i % 9}-15", amount_minor=100 + i)
    params = {"category": "tolls", "from": "2026-01-01", "to": "2026-12-31"}
    items = client.get(URL, params={**params, "limit": 100}, headers=auth_headers).json()["items"]
    s = client.get(SUMMARY, params=params, headers=auth_headers).json()
    assert s["count"] == len(items)
    assert s["total_minor"] == sum(i["amount_minor"] for i in items)


def test_summary_after_patch_and_delete(client: TestClient, auth_headers: dict[str, str]) -> None:
    a = post(client, auth_headers, amount_minor=10)
    b = post(client, auth_headers, amount_minor=20, category="tolls")
    client.patch(
        f"{URL}/{a['id']}", json={"category": "tolls", "date": "2026-01-02"}, headers=auth_headers
    )
    client.delete(f"{URL}/{b['id']}", headers=auth_headers)
    s = client.get(SUMMARY, headers=auth_headers).json()
    assert s["by_category"] == [{"category": "tolls", "total_minor": 10, "count": 1}]
    assert s["by_month"] == [{"month": "2026-01", "total_minor": 10, "count": 1}]


# --- idempotency, concurrency, delete -------------------------------------------------------


def test_concurrent_conflicting_creates_one_winner(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    i = new_id()
    codes: list[int] = []

    def go(n: int) -> None:
        codes.append(
            client.post(URL, json=body(id=i, amount_minor=n + 1), headers=auth_headers).status_code
        )

    threads = [threading.Thread(target=go, args=(n,)) for n in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert codes.count(201) == 1
    assert set(codes) <= {201, 409}
    assert rows_in_db(client) == 1


def test_concurrent_patch_and_delete_never_500(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    tc = TestClient(client.app, raise_server_exceptions=False)
    for _ in range(5):
        e = post(client, auth_headers)
        codes: list[int] = []
        calls = [
            lambda c=codes, i=e["id"]: c.append(
                tc.patch(f"{URL}/{i}", json={"amount_minor": 3}, headers=auth_headers).status_code
            ),
            lambda c=codes, i=e["id"]: c.append(
                tc.delete(f"{URL}/{i}", headers=auth_headers).status_code
            ),
        ]
        ts = [threading.Thread(target=f) for f in calls]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        assert set(codes) <= {200, 204, 404}, codes


def test_delete_twice_then_recreate_same_id(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body()
    client.post(URL, json=b, headers=auth_headers)
    assert client.delete(f"{URL}/{b['id']}", headers=auth_headers).status_code == 204
    assert client.delete(f"{URL}/{b['id']}", headers=auth_headers).status_code == 404
    assert client.post(URL, json={**b, "amount_minor": 9}, headers=auth_headers).status_code == 201


def test_delete_204_has_empty_body(client: TestClient, auth_headers: dict[str, str]) -> None:
    e = post(client, auth_headers)
    r = client.delete(f"{URL}/{e['id']}", headers=auth_headers)
    assert r.status_code == 204
    assert r.content == b""
    assert r.headers["cache-control"] == "no-store"


def test_cap_replay_and_patch_delete_at_cap(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(
            text(
                "INSERT INTO expense (id, date, category, amount_minor) "
                "SELECT gen_random_uuid(), DATE '2026-01-01', 'other', 1 "
                "FROM generate_series(1, 4999)"
            )
        )
    b = body()
    assert client.post(URL, json=b, headers=auth_headers).status_code == 201
    over = client.post(URL, json=body(), headers=auth_headers)
    assert over.status_code == 400
    assert fields(over) == ["body"]
    assert client.post(URL, json=b, headers=auth_headers).status_code == 200
    assert (
        client.patch(f"{URL}/{b['id']}", json={"amount_minor": 2}, headers=auth_headers).status_code
        == 200
    )
    assert client.post(URL, json={**b, "amount_minor": 5}, headers=auth_headers).status_code == 409
    assert client.delete(f"{URL}/{b['id']}", headers=auth_headers).status_code == 204
    assert client.post(URL, json=body(), headers=auth_headers).status_code == 201
    assert rows_in_db(client) == 5000


def test_cap_invalid_body_at_cap_reports_field_errors_not_body(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(
            text(
                "INSERT INTO expense (id, date, category, amount_minor) "
                "SELECT gen_random_uuid(), DATE '2026-01-01', 'other', 1 "
                "FROM generate_series(1, 5000)"
            )
        )
    r = client.post(URL, json=body(amount_minor=0), headers=auth_headers)
    assert fields(r) == ["amount_minor"]


# --- robustness under races (500s) ----------------------------------------------------------


@pytest.mark.xfail(
    strict=True,
    reason="QA-E2: ExpenseRepository.get/list_page roll back after loading, which expires the "
    "ORM objects; they are then lazily reloaded one by one while serialising (N+1 queries) and a "
    "row deleted in between raises ObjectDeletedError: 500 instead of a clean 200/404",
)
def test_get_racing_with_delete_is_not_500(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    e = post(client, auth_headers)
    original = ExpenseRepository.get

    def racing(self: ExpenseRepository, expense_id: uuid.UUID) -> Any:
        row = original(self, expense_id)
        with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
            conn.execute(text("DELETE FROM expense WHERE id = :i"), {"i": e["id"]})
        return row

    monkeypatch.setattr(ExpenseRepository, "get", racing)
    tc = TestClient(client.app, raise_server_exceptions=False)
    assert tc.get(f"{URL}/{e['id']}", headers=auth_headers).status_code in (200, 404)


@pytest.mark.xfail(
    strict=True,
    reason="QA-E2: list issues one extra SELECT per returned row (rows expired by rollback)",
)
def test_list_of_20_uses_a_constant_number_of_queries(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    for d in range(1, 21):
        post(client, auth_headers, date=f"2026-08-{d:02d}")
    statements: list[str] = []
    engine = client.app.state.engine  # type: ignore[attr-defined]

    def count(*args: Any) -> None:
        statements.append(args[2])

    event.listen(engine, "before_cursor_execute", count)
    try:
        assert client.get(URL, params={"limit": 20}, headers=auth_headers).status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", count)
    assert len(statements) <= 3, len(statements)


# --- auth, headers, routing -----------------------------------------------------------------


@pytest.mark.parametrize(
    "auth",
    ["", "Bearer", "Bearer ", "bearer", "Bearer a.b", "Token x", "Bearer x y", "Basic dTpw"],
)
def test_401_variants_run_before_validation_and_404(client: TestClient, auth: str) -> None:
    headers = {"Authorization": auth} if auth else {}
    cases = [
        ("get", f"{URL}/not-a-uuid", None),
        ("get", f"{URL}?limit=0&category=zzz", None),
        ("post", URL, {"nonsense": 1}),
        ("patch", f"{URL}/{new_id()}", {"amount_minor": 0}),
        ("delete", f"{URL}/{new_id()}", None),
        ("get", f"{SUMMARY}?from=bad", None),
    ]
    for method, path, payload in cases:
        kwargs: dict[str, Any] = {"json": payload} if payload is not None else {}
        r = client.request(method, path, headers=headers, **kwargs)
        assert r.status_code == 401, (method, path, r.text)
        assert r.json()["error"]["code"] == "unauthenticated"
        assert r.headers["cache-control"] == "no-store"
        assert r.headers["www-authenticate"] == "Bearer"


def test_expired_and_tampered_tokens_are_401(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    token = auth_headers["Authorization"].removeprefix("Bearer ")
    payload, sig = token.split(".")
    for bad in (f"{payload}.{sig[:-2]}AA", f"{payload}x.{sig}", f"{sig}.{payload}", token + ".x"):
        assert client.get(URL, headers={"Authorization": f"Bearer {bad}"}).status_code == 401


def test_lowercase_bearer_scheme_is_accepted(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    token = auth_headers["Authorization"].removeprefix("Bearer ")
    assert client.get(URL, headers={"Authorization": f"bearer {token}"}).status_code == 200


def test_every_response_kind_is_no_store(client: TestClient, auth_headers: dict[str, str]) -> None:
    e = post(client, auth_headers)
    responses = [
        client.post(URL, json=body(), headers=auth_headers),
        client.post(URL, json=e, headers=auth_headers),
        client.post(URL, json={"x": 1}, headers=auth_headers),
        client.post(URL, json={**e, "amount_minor": 99}, headers=auth_headers),
        client.get(URL, headers=auth_headers),
        client.get(SUMMARY, headers=auth_headers),
        client.get(f"{URL}/{e['id']}", headers=auth_headers),
        client.patch(f"{URL}/{e['id']}", json={"notes": "x"}, headers=auth_headers),
        client.patch(f"{URL}/{new_id()}", json={"notes": "x"}, headers=auth_headers),
        client.delete(f"{URL}/{new_id()}", headers=auth_headers),
        client.put(URL, json={}, headers=auth_headers),
        client.post(URL, content=b"x" * 70000, headers={**auth_headers, **JSON_CT}),
        client.get(URL),
    ]
    for r in responses:
        assert r.headers["cache-control"] == "no-store", (
            r.request.method,
            r.request.url,
            r.status_code,
        )


def test_error_bodies_have_the_contract_shape(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    e = post(client, auth_headers)
    errors = [
        client.post(URL, json={"x": 1}, headers=auth_headers),
        client.post(URL, json={**body(id=e["id"]), "amount_minor": 99}, headers=auth_headers),
        client.get(f"{URL}/{new_id()}", headers=auth_headers),
        client.get(f"{URL}/nope", headers=auth_headers),
        client.put(URL, json={}, headers=auth_headers),
        client.get(URL),
    ]
    for r in errors:
        err = r.json()
        assert set(err) == {"error"}
        assert set(err["error"]) == {"code", "message", "details"}
        assert all(set(d) == {"field", "issue"} for d in err["error"]["details"])
    assert [r.status_code for r in errors] == [400, 409, 404, 400, 405, 401]


def test_summary_path_wrong_methods(client: TestClient, auth_headers: dict[str, str]) -> None:
    for method in ("post", "patch", "delete", "put"):
        r = client.request(method, SUMMARY, headers=auth_headers, json={})
        assert r.status_code in (400, 405)
        assert r.status_code != 500


def test_status_codes_on_post(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = body()
    r1 = client.post(URL, json=b, headers=auth_headers)
    r2 = client.post(URL, json=b, headers=auth_headers)
    assert (r1.status_code, r2.status_code) == (201, 200)
    assert r1.json() == r2.json()
    assert "location" not in r1.headers


def test_response_object_shape_and_timestamps(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    e = post(client, auth_headers, notes=None)
    assert set(e) == {
        "id",
        "date",
        "category",
        "amount_minor",
        "currency",
        "notes",
        "energy_wh",
        "created_at",
        "updated_at",
    }
    assert e["notes"] is None
    assert e["energy_wh"] is None
    assert e["created_at"].endswith("Z")
    assert e["updated_at"].endswith("Z")
    assert type(e["amount_minor"]) is int


# --- OpenAPI vs contract --------------------------------------------------------------------


@pytest.fixture(scope="module")
def schema() -> dict[str, Any]:
    return build_schema()


def test_openapi_expense_routes_and_codes(schema: dict[str, Any]) -> None:
    expected = {
        ("post", "/api/v1/expenses"): {"201", "200", "400", "401", "409", "500"},
        ("get", "/api/v1/expenses"): {"200", "400", "401", "500"},
        ("get", "/api/v1/expenses/summary"): {"200", "400", "401", "500"},
        ("get", "/api/v1/expenses/{expense_id}"): {"200", "400", "401", "404", "500"},
        ("patch", "/api/v1/expenses/{expense_id}"): {"200", "400", "401", "404", "500"},
        ("delete", "/api/v1/expenses/{expense_id}"): {"204", "400", "401", "404", "500"},
    }
    found = {(m, p) for p, item in schema["paths"].items() for m in item if "expenses" in p}
    assert found == set(expected)
    for (method, path), codes in expected.items():
        op = schema["paths"][path][method]
        assert codes <= set(op["responses"]), (method, path)
        assert op["security"] == [{"bearerAuth": []}]


def test_openapi_expense_schemas_match_contract(schema: dict[str, Any]) -> None:
    s = schema["components"]["schemas"]
    create = s["ExpenseCreate"]
    assert set(create["required"]) == {"id", "date", "category", "amount_minor"}
    assert create["additionalProperties"] is False
    assert create["properties"]["amount_minor"]["minimum"] == 1
    assert create["properties"]["amount_minor"]["maximum"] == 10**12
    assert create["properties"]["notes"]["anyOf"][0]["maxLength"] == 5000
    assert set(s["ExpenseOut"]["required"]) == {
        "id",
        "date",
        "category",
        "amount_minor",
        "currency",
        "notes",
        "energy_wh",
        "created_at",
        "updated_at",
    }
    assert set(s["ExpenseSummary"]["required"]) == {
        "currency",
        "total_minor",
        "count",
        "by_category",
        "by_month",
    }
    assert s["ExpensePatch"]["additionalProperties"] is False
    enum = create["properties"]["category"]["enum"]
    assert enum == CATEGORIES


@pytest.mark.xfail(
    strict=True,
    reason="QA-E5: OpenAPI ExpensePatch advertises null for date, category, amount_minor and "
    "currency, which the API rejects (contract: only notes may be null)",
)
def test_openapi_patch_does_not_advertise_null_for_non_nullable_fields(
    schema: dict[str, Any],
) -> None:
    props = schema["components"]["schemas"]["ExpensePatch"]["properties"]
    for name in ("date", "category", "amount_minor", "currency"):
        assert {"type": "null"} not in props[name].get("anyOf", []), name


def test_openapi_list_query_params(schema: dict[str, Any]) -> None:
    params = {p["name"]: p for p in schema["paths"]["/api/v1/expenses"]["get"]["parameters"]}
    assert set(params) == {"limit", "cursor", "category", "from", "to"}
    assert params["limit"]["schema"]["minimum"] == 1
    assert params["limit"]["schema"]["maximum"] == 100
    assert params["limit"]["schema"]["default"] == 50
    summary = {p["name"] for p in schema["paths"]["/api/v1/expenses/summary"]["get"]["parameters"]}
    assert summary == {"category", "from", "to"}


# --- DB-level defence in depth --------------------------------------------------------------


@pytest.mark.parametrize(
    ("date", "amount", "currency"),
    [
        ("1999-12-31", 1, "MYR"),
        ("2026-01-01", 0, "MYR"),
        ("2026-01-01", 10**12 + 1, "MYR"),
        ("2026-01-01", 1, "USD"),
    ],
)
def test_db_constraints_hold_without_the_api(
    client: TestClient, date: str, amount: int, currency: str
) -> None:
    from sqlalchemy.exc import IntegrityError

    sql = text(
        "INSERT INTO expense (id, date, category, amount_minor, currency) "
        "VALUES (gen_random_uuid(), :d, 'other', :a, :c)"
    )
    engine = client.app.state.engine  # type: ignore[attr-defined]
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(sql, {"d": dt.date.fromisoformat(date), "a": amount, "c": currency})


# --- injection-like content is data ---------------------------------------------------------


@pytest.mark.parametrize(
    "notes",
    [
        "'; DROP TABLE expense; --",
        '" OR "1"="1',
        "<script>alert(1)</script>",
        "${jndi:ldap://x}",
        "{{7*7}}",
        "%s %d {0}",
        "\\u0000",
        "a\\x00b",
    ],
)
def test_hostile_looking_notes_are_stored_verbatim(
    client: TestClient, auth_headers: dict[str, str], notes: str
) -> None:
    e = post(client, auth_headers, notes=notes)
    assert client.get(f"{URL}/{e['id']}", headers=auth_headers).json()["notes"] == notes
    assert client.get(SUMMARY, headers=auth_headers).json()["count"] == 1


@pytest.mark.parametrize("bad_i", [5, [], {}, 1.5, True])
def test_service_record_cursor_with_non_string_id_is_400(
    client: TestClient, auth_headers: dict[str, str], bad_i: object
) -> None:
    """The cursor decoder is shared with service records; QA-E1 was fixed there."""
    import base64
    import json

    raw = json.dumps({"d": "2026-01-01", "c": "2026-01-01T00:00:00+00:00", "i": bad_i})
    cursor = base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")
    r = client.get("/api/v1/service-records", params={"cursor": cursor}, headers=auth_headers)
    assert r.status_code == 400
