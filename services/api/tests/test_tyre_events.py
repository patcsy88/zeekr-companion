"""Tyres slice, backend: AC-75 to AC-79, AC-82, AC-85 (FR-9). Disposable data only."""

from __future__ import annotations

import datetime as dt
import threading
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app import schemas
from app.adapters.zeekr_live import ZeekrLiveTelemetryProvider
from app.clock import today_kl
from app.models import TYRE_KINDS, TYRE_WHEELS
from tests.conftest import new_id, record_body

URL = "/api/v1/tyre-events"
SR = "/api/v1/service-records"
ALL_WHEELS = ["driver_front", "passenger_front", "driver_rear", "passenger_rear"]


def body(**overrides: Any) -> dict[str, Any]:
    b: dict[str, Any] = {
        "id": new_id(),
        "date": "2026-09-01",
        "kind": "replace",
        "wheels": list(ALL_WHEELS),
        "odometer": 12000,
        "brand": "Brand A",
        "model": "Model B",
        "size": "255/45 R20",
        "cost_minor": 400000,
        "currency": "MYR",
        "shop": "Tyre shop",
        "notes": "n",
    }
    b.update(overrides)
    return b


def rotate(**overrides: Any) -> dict[str, Any]:
    return body(kind="rotate", brand=None, model=None, size=None, **overrides)


def post(client: TestClient, headers: dict[str, str], **overrides: Any) -> dict[str, Any]:
    r = client.post(URL, json=body(**overrides), headers=headers)
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def fields(response: Any) -> list[str]:
    return [d["field"] for d in response.json()["error"]["details"]]


def top_fields(response: Any) -> set[str]:
    """`wheels.0` (a bad list item) counts as `wheels`."""
    return {f.split(".")[0] for f in fields(response)}


_COUNTS = {
    "tyre_event": text("SELECT count(*) FROM tyre_event"),
    "expense": text("SELECT count(*) FROM expense"),
}


def _count(client: TestClient, table: str = "tyre_event") -> int:
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        return int(conn.execute(_COUNTS[table]).scalar_one())


def _bulk_insert(client: TestClient, n: int) -> None:
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(
            text(
                "INSERT INTO tyre_event (id, date, kind, wheels, odometer) "
                "SELECT gen_random_uuid(), DATE '2026-01-01', 'rotate', "
                "ARRAY['driver_front']::varchar(20)[], 1 FROM generate_series(1, :n)"
            ),
            {"n": n},
        )


def _live_row(client: TestClient, km: int) -> None:
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(
            text(
                "INSERT INTO live_reading (id, observed_at, received_at, odometer_km) "
                "VALUES (gen_random_uuid(), :t, :t, :km)"
            ),
            {"t": dt.datetime.now(dt.UTC), "km": km},
        )


def _turn_live_on(client: TestClient) -> None:
    client.app.state.live_telemetry = ZeekrLiveTelemetryProvider(  # type: ignore[attr-defined]
        lambda: {}, clock=lambda: 0.0, min_interval_s=300
    )


def test_kinds_and_wheels_match_the_schema() -> None:
    assert set(TYRE_KINDS) == {"replace", "rotate", "repair", "alignment", "balancing"}
    assert list(TYRE_WHEELS) == ALL_WHEELS == list(schemas.WHEEL_ORDER)


# --- AC-85: auth ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", URL),
        ("get", URL),
        ("get", f"{URL}/{uuid.uuid4()}"),
        ("patch", f"{URL}/{uuid.uuid4()}"),
        ("delete", f"{URL}/{uuid.uuid4()}"),
    ],
)
@pytest.mark.parametrize("auth", [None, "Bearer wrong", "Basic abc"])
def test_ac85_every_route_needs_a_token(
    client: TestClient, method: str, path: str, auth: str | None
) -> None:
    headers = {"Authorization": auth} if auth else {}
    kwargs: dict[str, Any] = {"json": body()} if method in ("post", "patch") else {}
    r = client.request(method, path, headers=headers, **kwargs)
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthenticated"
    assert _count(client) == 0


# --- AC-75, AC-77: create, read, replay -----------------------------------------------------


def test_ac75_create_then_read_back(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = body()
    r = client.post(URL, json=b, headers=auth_headers)
    assert r.status_code == 201
    out = r.json()
    for k, v in b.items():
        assert out[k] == v, k
    assert out["created_at"].endswith("Z") or out["created_at"].endswith("+00:00")
    got = client.get(f"{URL}/{b['id']}", headers=auth_headers)
    assert got.status_code == 200
    assert got.json() == out


def test_ac75_minimal_rotate_defaults(client: TestClient, auth_headers: dict[str, str]) -> None:
    b = {"id": new_id(), "date": "2026-09-01", "kind": "rotate", "wheels": ALL_WHEELS}
    b["odometer"] = 0
    out = client.post(URL, json=b, headers=auth_headers).json()
    assert out["currency"] == "MYR"
    for f in ("brand", "model", "size", "cost_minor", "shop", "notes"):
        assert out[f] is None


@pytest.mark.parametrize("kind", ["replace", "rotate", "repair", "alignment", "balancing"])
def test_ac75_every_kind_is_accepted(
    client: TestClient, auth_headers: dict[str, str], kind: str
) -> None:
    extra = {} if kind == "replace" else {"brand": None, "model": None, "size": None}
    assert post(client, auth_headers, kind=kind, **extra)["kind"] == kind


def test_ac76_wheels_are_returned_in_fixed_order(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body(wheels=["passenger_rear", "driver_front", "driver_rear"])
    out = client.post(URL, json=b, headers=auth_headers).json()
    assert out["wheels"] == ["driver_front", "driver_rear", "passenger_rear"]
    # A replay in yet another order compares equal.
    again = client.post(
        URL,
        json={**b, "wheels": ["driver_rear", "passenger_rear", "driver_front"]},
        headers=auth_headers,
    )
    assert again.status_code == 200


def test_ac76_blank_strings_become_null(client: TestClient, auth_headers: dict[str, str]) -> None:
    out = post(client, auth_headers, brand="  ", model="", size=" ", shop="   ", notes="")
    for f in ("brand", "model", "size", "shop", "notes"):
        assert out[f] is None


def test_ac76_blank_tyre_fields_are_fine_on_a_rotate(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    r = client.post(URL, json=rotate() | {"brand": " ", "size": ""}, headers=auth_headers)
    assert r.status_code == 201


def test_ac77_replay_returns_200_and_conflict_409(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    b = body()
    first = client.post(URL, json=b, headers=auth_headers)
    assert first.status_code == 201
    replay = client.post(URL, json=b, headers=auth_headers)
    assert replay.status_code == 200
    assert replay.json() == first.json()
    for change in (
        {"odometer": 1},
        {"notes": "other"},
        {"wheels": ["driver_front"]},
        {"cost_minor": None},
        {"size": None},
    ):
        r = client.post(URL, json={**b, **change}, headers=auth_headers)
        assert r.status_code == 409, change
        assert r.json()["error"]["code"] == "conflict"
    assert _count(client) == 1


def test_ac77_concurrent_same_id_creates_exactly_one_row(
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
    assert codes.count(201) == 1
    assert set(codes) <= {200, 201}
    assert _count(client) == 1


# --- AC-76: validation ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"date": "2026-13-01"}, "date"),
        ({"date": "2026-02-30"}, "date"),
        ({"date": "20260901"}, "date"),
        ({"date": 20260901}, "date"),
        ({"date": None}, "date"),
        ({"date": "1999-12-31"}, "date"),
        ({"date": "2999-01-01"}, "date"),
        ({"odometer": -1}, "odometer"),
        ({"odometer": 10_000_001}, "odometer"),
        ({"odometer": 1.5}, "odometer"),
        ({"odometer": "100"}, "odometer"),
        ({"odometer": True}, "odometer"),
        ({"odometer": None}, "odometer"),
        ({"kind": "swap"}, "kind"),
        ({"kind": None}, "kind"),
        ({"wheels": []}, "wheels"),
        ({"wheels": ["driver_front"] * 2}, "wheels"),
        ({"wheels": [*ALL_WHEELS, "driver_front"]}, "wheels"),
        ({"wheels": ["spare"]}, "wheels"),
        ({"wheels": "driver_front"}, "wheels"),
        ({"wheels": None}, "wheels"),
        ({"brand": "x" * 101}, "brand"),
        ({"model": "x" * 101}, "model"),
        ({"size": "x" * 51}, "size"),
        ({"shop": "x" * 201}, "shop"),
        ({"notes": "x" * 5001}, "notes"),
        ({"cost_minor": -1}, "cost_minor"),
        ({"cost_minor": 10**12 + 1}, "cost_minor"),
        ({"cost_minor": 1.0}, "cost_minor"),
        ({"cost_minor": "100"}, "cost_minor"),
        ({"currency": "USD"}, "currency"),
        ({"currency": None}, "currency"),
        ({"notes": "a\x00b"}, "notes"),
        ({"surprise": 1}, "surprise"),
        ({"created_at": "2026-01-01T00:00:00Z"}, "created_at"),
    ],
)
def test_ac76_create_validation(
    client: TestClient, auth_headers: dict[str, str], overrides: dict[str, Any], field: str
) -> None:
    r = client.post(URL, json=body(**overrides), headers=auth_headers)
    assert r.status_code == 400, r.text
    assert r.json()["error"]["code"] == "validation_error"
    assert field in top_fields(r)
    assert _count(client) == 0


@pytest.mark.parametrize("field", ["id", "date", "kind", "wheels", "odometer"])
def test_ac76_required_fields(client: TestClient, auth_headers: dict[str, str], field: str) -> None:
    b = body()
    del b[field]
    r = client.post(URL, json=b, headers=auth_headers)
    assert r.status_code == 400
    assert field in fields(r)


def test_ac76_limits_are_inclusive(client: TestClient, auth_headers: dict[str, str]) -> None:
    out = post(
        client,
        auth_headers,
        odometer=10_000_000,
        cost_minor=10**12,
        brand="b" * 100,
        model="m" * 100,
        size="s" * 50,
        shop="x" * 200,
        notes="y" * 5000,
        date="2000-01-01",
    )
    assert out["odometer"] == 10_000_000
    assert post(client, auth_headers, cost_minor=0, odometer=0)["cost_minor"] == 0


@pytest.mark.parametrize("kind", ["rotate", "repair", "alignment", "balancing"])
@pytest.mark.parametrize("field", ["brand", "model", "size"])
def test_ac76_tyre_fields_only_on_replace(
    client: TestClient, auth_headers: dict[str, str], kind: str, field: str
) -> None:
    b = body(kind=kind, brand=None, model=None, size=None)
    b[field] = "x"
    r = client.post(URL, json=b, headers=auth_headers)
    assert r.status_code == 400
    assert fields(r) == [field]
    assert _count(client) == 0


def test_ac76_future_date_uses_kuala_lumpur_not_utc(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    # 2026-10-11 20:00 UTC is 2026-10-12 04:00 in Kuala Lumpur.
    fixed = dt.datetime(2026, 10, 11, 20, 0, tzinfo=dt.UTC)
    monkeypatch.setattr(schemas, "today_kl", lambda: today_kl(fixed))
    assert client.post(URL, json=body(date="2026-10-12"), headers=auth_headers).status_code == 201
    r = client.post(URL, json=body(date="2026-10-13"), headers=auth_headers)
    assert r.status_code == 400
    assert "date" in fields(r)
    e = post(client, auth_headers, date="2026-10-01")
    p = client.patch(f"{URL}/{e['id']}", json={"date": "2026-10-13"}, headers=auth_headers)
    assert p.status_code == 400
    assert "date" in fields(p)


def test_ac76_bad_ids_are_400(client: TestClient, auth_headers: dict[str, str]) -> None:
    for method in ("get", "patch", "delete"):
        kwargs: dict[str, Any] = {"json": {}} if method == "patch" else {}
        r = client.request(method, f"{URL}/not-a-uuid", headers=auth_headers, **kwargs)
        assert r.status_code == 400


# --- AC-78: edit and delete -----------------------------------------------------------------


def test_ac78_patch_is_partial(client: TestClient, auth_headers: dict[str, str]) -> None:
    e = post(client, auth_headers)
    r = client.patch(
        f"{URL}/{e['id']}",
        json={"notes": None, "wheels": ["driver_rear", "driver_front"], "cost_minor": None},
        headers=auth_headers,
    )
    assert r.status_code == 200
    out = r.json()
    assert out["notes"] is None
    assert out["cost_minor"] is None
    assert out["wheels"] == ["driver_front", "driver_rear"]
    assert out["brand"] == e["brand"]
    assert out["odometer"] == e["odometer"]
    assert out["updated_at"] >= e["updated_at"]
    assert client.get(f"{URL}/{e['id']}", headers=auth_headers).json() == out


def test_ac78_empty_patch_returns_the_event(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    e = post(client, auth_headers)
    r = client.patch(f"{URL}/{e['id']}", json={}, headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == e


@pytest.mark.parametrize("field", ["date", "kind", "wheels", "odometer", "currency"])
def test_ac78_patch_may_not_null_required_fields(
    client: TestClient, auth_headers: dict[str, str], field: str
) -> None:
    e = post(client, auth_headers)
    r = client.patch(f"{URL}/{e['id']}", json={field: None}, headers=auth_headers)
    assert r.status_code == 400
    assert field in fields(r)
    assert client.get(f"{URL}/{e['id']}", headers=auth_headers).json() == e


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"wheels": []}, "wheels"),
        ({"kind": "swap"}, "kind"),
        ({"odometer": -1}, "odometer"),
        ({"size": "x" * 51}, "size"),
        ({"id": new_id()}, "id"),
        ({"surprise": 1}, "surprise"),
    ],
)
def test_ac78_patch_validation(
    client: TestClient, auth_headers: dict[str, str], overrides: dict[str, Any], field: str
) -> None:
    e = post(client, auth_headers)
    r = client.patch(f"{URL}/{e['id']}", json=overrides, headers=auth_headers)
    assert r.status_code == 400
    assert field in fields(r)


def test_ac78_patch_kind_away_from_replace_needs_tyre_fields_cleared(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    e = post(client, auth_headers)
    r = client.patch(f"{URL}/{e['id']}", json={"kind": "rotate"}, headers=auth_headers)
    assert r.status_code == 400
    assert fields(r) == ["brand", "model", "size"]
    assert client.get(f"{URL}/{e['id']}", headers=auth_headers).json() == e
    ok = client.patch(
        f"{URL}/{e['id']}",
        json={"kind": "rotate", "brand": None, "model": None, "size": None},
        headers=auth_headers,
    )
    assert ok.status_code == 200
    assert ok.json()["kind"] == "rotate"


def test_ac78_patch_tyre_field_onto_a_rotate_is_refused(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    e = client.post(URL, json=rotate(), headers=auth_headers).json()
    r = client.patch(f"{URL}/{e['id']}", json={"size": "x"}, headers=auth_headers)
    assert r.status_code == 400
    assert fields(r) == ["size"]
    to_replace = client.patch(
        f"{URL}/{e['id']}", json={"kind": "replace", "size": "x"}, headers=auth_headers
    )
    assert to_replace.status_code == 200
    assert to_replace.json()["size"] == "x"


def test_ac78_unknown_id_is_404(client: TestClient, auth_headers: dict[str, str]) -> None:
    known = post(client, auth_headers)
    assert client.get(f"{URL}/{known['id']}", headers=auth_headers).status_code == 200
    missing = f"{URL}/{uuid.uuid4()}"
    assert client.get(missing, headers=auth_headers).status_code == 404
    assert client.patch(missing, json={"notes": "x"}, headers=auth_headers).status_code == 404
    assert client.patch(missing, json={}, headers=auth_headers).status_code == 404
    r = client.delete(missing, headers=auth_headers)
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"


def test_ac78_delete_then_404(client: TestClient, auth_headers: dict[str, str]) -> None:
    e = post(client, auth_headers)
    r = client.delete(f"{URL}/{e['id']}", headers=auth_headers)
    assert r.status_code == 204
    assert r.content == b""
    assert client.get(f"{URL}/{e['id']}", headers=auth_headers).status_code == 404
    assert client.delete(f"{URL}/{e['id']}", headers=auth_headers).status_code == 404


# --- AC-79: list, cursor, current odometer --------------------------------------------------


def test_ac79_empty_list(client: TestClient, auth_headers: dict[str, str]) -> None:
    r = client.get(URL, headers=auth_headers)
    assert r.status_code == 200
    assert r.json() == {"items": [], "next_cursor": None, "current_odometer": None}
    assert r.headers["cache-control"] == "no-store"


def test_ac79_newest_first(client: TestClient, auth_headers: dict[str, str]) -> None:
    a = post(client, auth_headers, date="2026-01-01")
    b = post(client, auth_headers, date="2026-03-01")
    c = post(client, auth_headers, date="2026-03-01")
    ids = [i["id"] for i in client.get(URL, headers=auth_headers).json()["items"]]
    assert ids == [c["id"], b["id"], a["id"]]


def test_ac79_cursor_paging_visits_every_row_once(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    made = {post(client, auth_headers, date=f"2026-0{1 + i % 3}-01")["id"] for i in range(7)}
    seen: list[str] = []
    cursor: str | None = None
    while True:
        params: dict[str, Any] = {"limit": 3}
        if cursor:
            params["cursor"] = cursor
        page = client.get(URL, params=params, headers=auth_headers).json()
        assert len(page["items"]) <= 3
        seen += [i["id"] for i in page["items"]]
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert len(seen) == 7
    assert set(seen) == made


@pytest.mark.parametrize(
    "params",
    [{"limit": 0}, {"limit": 101}, {"limit": "1.0"}, {"limit": "-1"}, {"cursor": "garbage"}],
)
def test_ac79_bad_limit_or_cursor_is_400(
    client: TestClient, auth_headers: dict[str, str], params: dict[str, Any]
) -> None:
    assert client.get(URL, params=params, headers=auth_headers).status_code == 400


def test_ac79_current_odometer_from_service_record(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    rec = record_body(odometer=15000)
    client.post(SR, json=rec, headers=auth_headers)
    cur = client.get(URL, headers=auth_headers).json()["current_odometer"]
    assert cur == {
        "km": 15000,
        "source": "latest_service_record",
        "service_record_id": rec["id"],
        "date": rec["date"],
    }


def test_ac79_current_odometer_uses_a_larger_live_reading(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    client.post(SR, json=record_body(odometer=12000), headers=auth_headers)
    _live_row(client, 15000)
    _turn_live_on(client)
    cur = client.get(URL, headers=auth_headers).json()["current_odometer"]
    assert cur["km"] == 15000
    assert cur["source"] == "live_reading"
    assert cur["service_record_id"] is None


def test_ac79_live_reading_ignored_when_provider_off(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    client.post(SR, json=record_body(odometer=12000), headers=auth_headers)
    _live_row(client, 15000)
    cur = client.get(URL, headers=auth_headers).json()["current_odometer"]
    assert cur["km"] == 12000
    assert cur["source"] == "latest_service_record"


# --- AC-82: never touches expenses ----------------------------------------------------------


def test_ac82_tyre_events_never_create_or_change_expenses(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    e = post(client, auth_headers, cost_minor=99900)
    client.patch(f"{URL}/{e['id']}", json={"cost_minor": 1}, headers=auth_headers)
    post(client, auth_headers)
    client.delete(f"{URL}/{e['id']}", headers=auth_headers)
    assert _count(client, "expense") == 0
    assert client.get("/api/v1/expenses", headers=auth_headers).json()["items"] == []


# --- AC-85: cap -----------------------------------------------------------------------------


def test_ac85_cap_1000_exact_and_replay_at_cap(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    _bulk_insert(client, 999)
    last = body()
    assert client.post(URL, json=last, headers=auth_headers).status_code == 201
    assert _count(client) == 1000
    rejected = client.post(URL, json=body(), headers=auth_headers)
    assert rejected.status_code == 400
    assert rejected.json()["error"]["code"] == "validation_error"
    assert fields(rejected) == ["body"]
    assert client.post(URL, json=last, headers=auth_headers).status_code == 200
    assert client.post(URL, json={**last, "odometer": 1}, headers=auth_headers).status_code == 409
    assert _count(client) == 1000


def test_ac85_delete_frees_a_slot(client: TestClient, auth_headers: dict[str, str]) -> None:
    _bulk_insert(client, 999)
    first = post(client, auth_headers)
    assert client.post(URL, json=body(), headers=auth_headers).status_code == 400
    client.delete(f"{URL}/{first['id']}", headers=auth_headers)
    assert client.post(URL, json=body(), headers=auth_headers).status_code == 201


def test_ac85_cap_is_not_exceeded_by_concurrent_creates(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    _bulk_insert(client, 990)
    codes: list[int] = []

    def go() -> None:
        codes.append(client.post(URL, json=body(), headers=auth_headers).status_code)

    threads = [threading.Thread(target=go) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert codes.count(201) == 10
    assert codes.count(400) == 10
    assert _count(client) == 1000


def test_ac85_text_is_stored_verbatim(client: TestClient, auth_headers: dict[str, str]) -> None:
    html = '<script>alert(1)</script> & "quotes"'
    out = post(client, auth_headers, notes=html, shop=html, brand="<b>x</b>")
    assert out["notes"] == html
    assert out["shop"] == html
    assert out["brand"] == "<b>x</b>"
