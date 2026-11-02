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
