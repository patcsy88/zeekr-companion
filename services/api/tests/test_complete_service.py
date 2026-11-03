"""Complete service (approved 2026-11-03): record + completion + next reminder, all or nothing."""

from __future__ import annotations

import datetime as dt
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.adapters.zeekr_live import ZeekrLiveTelemetryProvider
from app.clock import add_months, today_kl
from tests.conftest import new_id, record_body

URL = "/api/v1/reminders"
SR = "/api/v1/service-records"
REF = "awd-performance-service:2:1"


def reminder(**kw: Any) -> dict[str, Any]:
    b: dict[str, Any] = {
        "id": new_id(),
        "kind": "service",
        "title": "Service 1 (40,000 km)",
        "due_date": "2027-10-07",
        "due_odometer": 40000,
        "notes": None,
        "template_ref": REF,
    }
    b.update(kw)
    return b


def make(client: TestClient, headers: dict[str, str], **kw: Any) -> dict[str, Any]:
    r = client.post(URL, json=reminder(**kw), headers=headers)
    assert r.status_code == 201, r.text
    out: dict[str, Any] = r.json()
    return out


def complete_body(**kw: Any) -> dict[str, Any]:
    b: dict[str, Any] = {
        "record_id": new_id(),
        "next_id": new_id(),
        "date": "2026-11-01",
        "odometer": 38500,
        "provider": "Zeekr Service Centre",
        "cost_minor": 0,
    }
    b.update(kw)
    return b


def counts(client: TestClient) -> tuple[int, int]:
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        r = conn.execute(text("SELECT count(*) FROM reminder")).scalar_one()
        s = conn.execute(text("SELECT count(*) FROM service_record")).scalar_one()
    return int(r), int(s)


def test_creates_record_completes_and_makes_next(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    rem = make(client, auth_headers)
    b = complete_body()
    r = client.post(f"{URL}/{rem['id']}/complete-service", json=b, headers=auth_headers)
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["service_record"]["id"] == b["record_id"]
    assert out["service_record"]["odometer"] == 38500
    assert out["service_record"]["provider"] == "Zeekr Service Centre"
    assert out["service_record"]["cost_minor"] == 0
    assert out["service_record"]["description"] == "Service 1 (40,000 km)"
    assert out["reminder"]["status"] == "completed"
    assert out["reminder"]["completed_on"] == "2026-11-01"
    nxt = out["next_reminder"]
    assert nxt["id"] == b["next_id"]
    assert nxt["due_odometer"] == 78500
    assert nxt["due_date"] == "2028-11-01"
    assert nxt["title"] == "Next service (78,500 km)"
    assert nxt["template_ref"] == REF and nxt["kind"] == "service"
    assert nxt["completed_on"] is None
    assert counts(client) == (2, 1)
    page = client.get(SR, headers=auth_headers).json()["items"]
    assert [i["id"] for i in page] == [b["record_id"]]


def test_month_end_is_clamped() -> None:
    assert add_months(dt.date(2026, 2, 28), 24) == dt.date(2028, 2, 28)
    assert add_months(dt.date(2024, 2, 29), 24) == dt.date(2026, 2, 28)
    assert add_months(dt.date(2026, 1, 31), 1) == dt.date(2026, 2, 28)


def test_replay_changes_nothing(client: TestClient, auth_headers: dict[str, str]) -> None:
    rem = make(client, auth_headers)
    b = complete_body()
    first = client.post(f"{URL}/{rem['id']}/complete-service", json=b, headers=auth_headers)
    again = client.post(f"{URL}/{rem['id']}/complete-service", json=b, headers=auth_headers)
    assert first.status_code == 201 and again.status_code == 200
    assert again.json()["next_reminder"]["id"] == first.json()["next_reminder"]["id"]
    assert counts(client) == (2, 1)


def test_same_ids_different_content_is_409(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    rem = make(client, auth_headers)
    b = complete_body()
    client.post(f"{URL}/{rem['id']}/complete-service", json=b, headers=auth_headers)
    changed = {**b, "odometer": 39000}
    r = client.post(f"{URL}/{rem['id']}/complete-service", json=changed, headers=auth_headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    assert counts(client) == (2, 1)


def test_no_template_ref_makes_no_next(client: TestClient, auth_headers: dict[str, str]) -> None:
    rem = make(client, auth_headers, template_ref=None)
    r = client.post(
        f"{URL}/{rem['id']}/complete-service", json=complete_body(), headers=auth_headers
    )
    assert r.status_code == 201
    assert r.json()["next_reminder"] is None
    assert r.json()["reminder"]["status"] == "completed"
    assert counts(client) == (1, 1)


def test_old_version_ref_still_makes_next(client: TestClient, auth_headers: dict[str, str]) -> None:
    rem = make(client, auth_headers, template_ref="awd-performance-service:1:1")
    r = client.post(
        f"{URL}/{rem['id']}/complete-service", json=complete_body(), headers=auth_headers
    )
    assert r.status_code == 201 and r.json()["next_reminder"]["due_odometer"] == 78500


@pytest.mark.parametrize(
    "change",
    [
        {"cost_minor": -1},
        {"date": (today_kl() + dt.timedelta(days=1)).isoformat()},
        {"odometer": -1},
        {"odometer": 10_000_001},
        {"odometer": 9_990_000},
        {"extra": 1},
        {"description": ""},
    ],
)
def test_bad_body_is_400_and_writes_nothing(
    client: TestClient, auth_headers: dict[str, str], change: dict[str, Any]
) -> None:
    rem = make(client, auth_headers)
    r = client.post(
        f"{URL}/{rem['id']}/complete-service", json=complete_body(**change), headers=auth_headers
    )
    assert r.status_code == 400 and r.json()["error"]["code"] == "validation_error"
    assert counts(client) == (1, 0)
    assert client.get(f"{URL}/{rem['id']}", headers=auth_headers).json()["completed_on"] is None


def test_not_a_service_reminder_is_400(client: TestClient, auth_headers: dict[str, str]) -> None:
    rem = make(client, auth_headers, kind="insurance_renewal", due_odometer=None, template_ref=None)
    r = client.post(
        f"{URL}/{rem['id']}/complete-service", json=complete_body(), headers=auth_headers
    )
    assert r.status_code == 400
    assert counts(client) == (1, 0)


def test_already_completed_is_400(client: TestClient, auth_headers: dict[str, str]) -> None:
    rem = make(client, auth_headers)
    client.patch(f"{URL}/{rem['id']}", json={"completed_on": "2026-11-01"}, headers=auth_headers)
    r = client.post(
        f"{URL}/{rem['id']}/complete-service", json=complete_body(), headers=auth_headers
    )
    assert r.status_code == 400
    assert counts(client) == (1, 0)


def test_unknown_reminder_is_404(client: TestClient, auth_headers: dict[str, str]) -> None:
    r = client.post(
        f"{URL}/{new_id()}/complete-service", json=complete_body(), headers=auth_headers
    )
    assert r.status_code == 404


def test_existing_record_id_rolls_back_everything(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    rem = make(client, auth_headers)
    taken = new_id()
    client.post(SR, json=record_body(id=taken), headers=auth_headers)
    r = client.post(
        f"{URL}/{rem['id']}/complete-service",
        json=complete_body(record_id=taken),
        headers=auth_headers,
    )
    assert r.status_code == 409
    assert counts(client) == (1, 1)
    assert client.get(f"{URL}/{rem['id']}", headers=auth_headers).json()["completed_on"] is None


def test_existing_next_id_is_409_and_writes_nothing(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    rem = make(client, auth_headers)
    other = make(client, auth_headers, title="Other")
    r = client.post(
        f"{URL}/{rem['id']}/complete-service",
        json=complete_body(next_id=other["id"]),
        headers=auth_headers,
    )
    assert r.status_code == 409
    assert counts(client) == (2, 0)


def test_cap_blocks_and_writes_nothing(client: TestClient, auth_headers: dict[str, str]) -> None:
    rem = make(client, auth_headers)
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(
            text(
                "INSERT INTO reminder (id, kind, title, due_date) "
                "SELECT gen_random_uuid(), 'insurance_renewal', 'x', '2027-01-01' "
                "FROM generate_series(1, 499)"
            )
        )
    r = client.post(
        f"{URL}/{rem['id']}/complete-service", json=complete_body(), headers=auth_headers
    )
    assert r.status_code == 400
    assert counts(client) == (500, 0)


def test_requires_a_token(client: TestClient) -> None:
    r = client.post(f"{URL}/{new_id()}/complete-service", json=complete_body())
    assert r.status_code == 401


def test_new_record_becomes_the_current_odometer(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    rem = make(client, auth_headers)
    client.post(f"{URL}/{rem['id']}/complete-service", json=complete_body(), headers=auth_headers)
    cur = client.get(URL, headers=auth_headers).json()["current_odometer"]
    assert cur["km"] == 38500 and cur["source"] == "latest_service_record"


# --- the odometer reminders use ---------------------------------------------------------------


def _live_row(client: TestClient, km: int, when: dt.datetime) -> None:
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(
            text(
                "INSERT INTO live_reading (id, observed_at, received_at, odometer_km) "
                "VALUES (gen_random_uuid(), :t, :t, :km)"
            ),
            {"t": when, "km": km},
        )


def _turn_live_on(client: TestClient) -> None:
    client.app.state.live_telemetry = ZeekrLiveTelemetryProvider(  # type: ignore[attr-defined]
        lambda: {}, clock=lambda: 0.0, min_interval_s=300
    )


def test_live_reading_is_used_when_larger(client: TestClient, auth_headers: dict[str, str]) -> None:
    client.post(SR, json=record_body(odometer=12000), headers=auth_headers)
    make(client, auth_headers, due_odometer=14000, due_date=None)
    _live_row(client, 15000, dt.datetime.now(dt.UTC))
    _turn_live_on(client)
    data = client.get(URL, headers=auth_headers).json()
    assert data["current_odometer"]["km"] == 15000
    assert data["current_odometer"]["source"] == "live_reading"
    assert data["current_odometer"]["service_record_id"] is None
    assert data["items"][0]["status"] == "overdue"
    assert data["items"][0]["overdue_by"] == ["odometer"]


def test_service_record_wins_when_larger_or_equal(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    client.post(SR, json=record_body(odometer=20000), headers=auth_headers)
    _live_row(client, 20000, dt.datetime.now(dt.UTC))
    _turn_live_on(client)
    cur = client.get(URL, headers=auth_headers).json()["current_odometer"]
    assert cur["km"] == 20000 and cur["source"] == "latest_service_record"


def test_live_reading_is_ignored_when_live_is_off(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    client.post(SR, json=record_body(odometer=12000), headers=auth_headers)
    _live_row(client, 15000, dt.datetime.now(dt.UTC))
    cur = client.get(URL, headers=auth_headers).json()["current_odometer"]
    assert cur["km"] == 12000 and cur["source"] == "latest_service_record"


def test_live_reading_alone_is_the_odometer(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    _live_row(client, 15000, dt.datetime.now(dt.UTC))
    _turn_live_on(client)
    cur = client.get(URL, headers=auth_headers).json()["current_odometer"]
    assert cur["km"] == 15000 and cur["source"] == "live_reading"


def test_warranty_ignores_the_live_reading(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    client.post(SR, json=record_body(odometer=12000), headers=auth_headers)
    _live_row(client, 99000, dt.datetime.now(dt.UTC))
    _turn_live_on(client)
    cur = client.get("/api/v1/warranty-coverages", headers=auth_headers).json()["current_odometer"]
    assert cur["km"] == 12000 and cur["source"] == "latest_service_record"


def test_patch_and_complete_still_work_with_live_readings_on(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    rem = make(client, auth_headers)
    _live_row(client, 15000, dt.datetime.now(dt.UTC))
    _turn_live_on(client)
    r = client.patch(f"{URL}/{rem['id']}", json={"notes": "n"}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["notes"] == "n"
    done = client.post(
        f"{URL}/{rem['id']}/complete-service", json=complete_body(), headers=auth_headers
    )
    assert done.status_code == 201 and done.json()["next_reminder"]["due_odometer"] == 78500
    assert client.get(f"{URL}/{rem['id']}", headers=auth_headers).status_code == 200
    assert client.post(URL, json=reminder(), headers=auth_headers).status_code == 201


# --- review follow-ups (2026-11-03) -----------------------------------------------------------


def _post(client: TestClient, headers: dict[str, str], rid: str, body: dict[str, Any]) -> Any:
    return client.post(f"{URL}/{rid}/complete-service", json=body, headers=headers)


def test_odometer_below_the_latest_service_record_is_rejected(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    client.post(SR, json=record_body(odometer=50000), headers=auth_headers)
    rem = make(client, auth_headers)
    r = _post(client, auth_headers, rem["id"], complete_body(odometer=5000))
    assert r.status_code == 400 and r.json()["error"]["code"] == "validation_error"
    assert r.json()["error"]["details"][0]["field"] == "odometer"
    assert counts(client) == (1, 1)


def test_odometer_equal_to_the_latest_is_accepted(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    client.post(SR, json=record_body(odometer=38500), headers=auth_headers)
    rem = make(client, auth_headers)
    assert _post(client, auth_headers, rem["id"], complete_body()).status_code == 201


def test_odometer_below_a_live_reading_is_rejected(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    _turn_live_on(client)
    _live_row(client, 60000, dt.datetime.now(dt.UTC) - dt.timedelta(minutes=5))
    rem = make(client, auth_headers)
    r = _post(client, auth_headers, rem["id"], complete_body(odometer=38500))
    assert r.status_code == 400
    assert counts(client) == (1, 0)


def test_overflow_edge_9_960_000_is_allowed(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    rem = make(client, auth_headers)
    r = _post(client, auth_headers, rem["id"], complete_body(odometer=9_960_000))
    assert r.status_code == 201 and r.json()["next_reminder"]["due_odometer"] == 10_000_000


def test_overflow_is_ignored_without_a_template_ref(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    rem = make(client, auth_headers, template_ref=None)
    r = _post(client, auth_headers, rem["id"], complete_body(odometer=9_990_000))
    assert r.status_code == 201 and r.json()["next_reminder"] is None


def test_overflow_error_releases_the_lock(client: TestClient, auth_headers: dict[str, str]) -> None:
    rem = make(client, auth_headers)
    assert (
        _post(client, auth_headers, rem["id"], complete_body(odometer=9_990_000)).status_code == 400
    )
    assert _post(client, auth_headers, rem["id"], complete_body()).status_code == 201


def test_replay_without_a_template_ref_returns_200(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    rem = make(client, auth_headers, template_ref=None)
    b = complete_body()
    assert _post(client, auth_headers, rem["id"], b).status_code == 201
    again = _post(client, auth_headers, rem["id"], b)
    assert again.status_code == 200 and again.json()["next_reminder"] is None
    assert counts(client) == (1, 1)


@pytest.mark.parametrize(
    ("day", "expected"),
    [("2026-08-31", "2028-08-31"), ("2024-02-29", "2026-02-28"), ("2025-02-28", "2027-02-28")],
)
def test_next_due_date_through_the_endpoint(
    client: TestClient, auth_headers: dict[str, str], day: str, expected: str
) -> None:
    rem = make(client, auth_headers)
    r = _post(client, auth_headers, rem["id"], complete_body(date=day))
    assert r.status_code == 201 and r.json()["next_reminder"]["due_date"] == expected


def test_a_positive_cost_round_trips(client: TestClient, auth_headers: dict[str, str]) -> None:
    rem = make(client, auth_headers)
    r = _post(client, auth_headers, rem["id"], complete_body(cost_minor=12345))
    assert r.status_code == 201 and r.json()["service_record"]["cost_minor"] == 12345


def test_malformed_template_ref_makes_no_next(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    for ref in ("x:1", "awd-performance-service:2"):
        rem = make(client, auth_headers, template_ref=ref)
        r = _post(client, auth_headers, rem["id"], complete_body())
        assert r.status_code == 201 and r.json()["next_reminder"] is None


def _race(client: TestClient, headers: dict[str, str], jobs: list[tuple[str, dict[str, Any]]]):
    import threading

    barrier = threading.Barrier(len(jobs))
    out: list[Any] = [None] * len(jobs)

    def run(i: int) -> None:
        barrier.wait()
        out[i] = _post(client, headers, *jobs[i])

    threads = [threading.Thread(target=run, args=(i,)) for i in range(len(jobs))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return out


def test_two_submits_with_the_same_ids_make_one_record(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    rem = make(client, auth_headers)
    b = complete_body()
    codes = sorted(r.status_code for r in _race(client, auth_headers, [(rem["id"], b)] * 2))
    assert codes == [200, 201]
    assert counts(client) == (2, 1)


def test_two_submits_with_different_ids_complete_once(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    rem = make(client, auth_headers)
    jobs = [(rem["id"], complete_body()), (rem["id"], complete_body())]
    codes = sorted(r.status_code for r in _race(client, auth_headers, jobs))
    assert codes == [201, 400]
    assert counts(client) == (2, 1)


def test_the_record_keeps_the_reminder_it_completed(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    rem = make(client, auth_headers)
    b = complete_body()
    assert _post(client, auth_headers, rem["id"], b).status_code == 201
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        got = conn.execute(
            text("SELECT reminder_id FROM service_record WHERE id = :i"), {"i": b["record_id"]}
        ).scalar_one()
    assert str(got) == rem["id"]


def test_the_same_ids_sent_to_a_different_reminder_are_a_conflict(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    first = make(client, auth_headers, template_ref=None)
    other = make(client, auth_headers, template_ref=None)
    b = complete_body()
    assert _post(client, auth_headers, first["id"], b).status_code == 201
    client.patch(f"{URL}/{other['id']}", json={"completed_on": "2026-11-01"}, headers=auth_headers)
    r = _post(client, auth_headers, other["id"], b)
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"


def test_a_record_not_made_by_complete_service_is_never_a_replay(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    rem = make(client, auth_headers, template_ref=None)
    b = complete_body()
    made = client.post(
        SR,
        json=record_body(id=b["record_id"], odometer=38500, date="2026-11-01"),
        headers=auth_headers,
    )
    assert made.status_code in (200, 201)
    r = _post(client, auth_headers, rem["id"], b)
    assert r.status_code in (400, 409)
