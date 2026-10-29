"""ADR-008 step 3: proposals, decisions and the endpoints, with the model off. Disposable data."""

from __future__ import annotations

import datetime as dt
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.clock import today_kl
from tests.conftest import new_id, record_body

API = "/api/v1/advisory"
CHECKS = f"{API}/checks"
PROPOSALS = f"{API}/proposals"


def days(n: int) -> str:
    return (today_kl() + dt.timedelta(days=n)).isoformat()


def seed_pace(client: TestClient, headers: dict[str, str]) -> None:
    """100 km/day over 60 days, ending today at 10,000 km."""
    for offset, km in ((-60, 4000), (0, 10000)):
        r = client.post(
            "/api/v1/service-records",
            json=record_body(date=days(offset), odometer=km),
            headers=headers,
        )
        assert r.status_code == 201


def seed_warranty(client: TestClient, headers: dict[str, str], **over: Any) -> dict[str, Any]:
    b: dict[str, Any] = {
        "id": new_id(),
        "name": "Private warranty name",
        "provider_type": "factory",
        "start_date": "2026-01-01",
        "end_date": days(200),
        "km_limit": 11000,
        "notes": "private note",
    }
    b.update(over)
    r = client.post("/api/v1/warranty-coverages", json=b, headers=headers)
    assert r.status_code == 201, r.text
    return b


def seed_charges(client: TestClient, headers: dict[str, str], latest: int = 6000) -> str:
    last = ""
    for n in range(6):
        last = new_id()
        r = client.post(
            "/api/v1/expenses",
            json={
                "id": last,
                "date": days(-30 + n),
                "category": "charging",
                "amount_minor": 5000,
                "currency": "MYR",
                "energy_wh": 10000,
            },
            headers=headers,
        )
        assert r.status_code == 201
    last = new_id()
    r = client.post(
        "/api/v1/expenses",
        json={
            "id": last,
            "date": days(-1),
            "category": "charging",
            "amount_minor": latest,
            "currency": "MYR",
            "energy_wh": 10000,
        },
        headers=headers,
    )
    assert r.status_code == 201
    return last


def run(client: TestClient, headers: dict[str, str]) -> dict[str, Any]:
    r = client.post(CHECKS, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()  # type: ignore[no-any-return]


# --- auth and shape -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", CHECKS),
        ("get", PROPOSALS),
        ("get", f"{PROPOSALS}/{new_id()}"),
        ("patch", f"{PROPOSALS}/{new_id()}"),
        ("get", f"{API}/model-calls"),
        ("get", f"{API}/status"),
    ],
)
def test_every_endpoint_needs_a_token(client: TestClient, method: str, path: str) -> None:
    r = client.request(method, path)
    assert r.status_code == 401


def test_status_with_model_off(client: TestClient, auth_headers: dict[str, str]) -> None:
    r = client.get(f"{API}/status", headers=auth_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["model_enabled"] is False
    assert body["model_id"] is None
    assert body["calls_this_month"] == 0
    assert body["monthly_limit"] == 60
    assert body["month"] == today_kl().strftime("%Y-%m")
    assert set(body) == {"model_enabled", "model_id", "calls_this_month", "monthly_limit", "month"}


def test_empty_run_reports_why_nothing_was_found(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    out = run(client, auth_headers)
    assert out["created"] == [] and out["unchanged"] == 0
    assert out["skipped"] == [{"condition": "charging_cost_drift", "reason": "not_enough_data"}]
    assert out["model"] == {"status": "disabled", "calls_this_month": 0, "monthly_limit": 60}


# --- the checks create proposals ------------------------------------------------------------


def test_warranty_finding_is_stored_with_the_model_off(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    seed_pace(client, auth_headers)
    w = seed_warranty(client, auth_headers)
    out = run(client, auth_headers)
    assert len(out["created"]) == 1
    p = out["created"][0]
    assert p["condition"] == "date_vs_km_warranty"
    assert p["status"] == "proposed"
    assert p["inputs"] == {
        "km_to_limit": 1000,
        "days_to_expiry": 200,
        "projected_limit_date": days(10),
    }
    assert p["source_refs"] == [{"kind": "warranty_coverage", "id": w["id"]}]
    assert p["explanation"] is None
    assert p["explanation_status"] == "disabled"
    assert p["urgency"] is None
    assert p["suggestion"]["kind"] == "review_reminder"
    assert p["suggestion"]["due_date"] == days(10)
    assert p["provenance"] == {"rule_version": 1, "prompt_version": None, "model_id": None}
    assert p["decided_at"] is None
    assert p["created_at"].endswith("Z")


def test_service_reminder_finding(client: TestClient, auth_headers: dict[str, str]) -> None:
    seed_pace(client, auth_headers)
    r = client.post(
        "/api/v1/reminders",
        json={
            "id": new_id(),
            "kind": "service",
            "title": "Service at 11,000 km",
            "due_date": days(200),
            "due_odometer": 11000,
        },
        headers=auth_headers,
    )
    assert r.status_code == 201
    p = run(client, auth_headers)["created"][0]
    assert p["condition"] == "date_vs_km_service"
    assert p["source_refs"][0]["kind"] == "reminder"


def test_completed_reminders_are_not_checked(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    seed_pace(client, auth_headers)
    rid = new_id()
    r = client.post(
        "/api/v1/reminders",
        json={
            "id": rid,
            "kind": "service",
            "title": "Done",
            "due_date": days(200),
            "due_odometer": 11000,
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    done = client.patch(
        f"/api/v1/reminders/{rid}", json={"completed_on": days(0)}, headers=auth_headers
    )
    assert done.status_code == 200, done.text
    assert run(client, auth_headers)["created"] == []


def test_charging_drift_finding(client: TestClient, auth_headers: dict[str, str]) -> None:
    expense_id = seed_charges(client, auth_headers)
    out = run(client, auth_headers)
    assert [s["condition"] for s in out["skipped"]] == []
    p = out["created"][0]
    assert p["condition"] == "charging_cost_drift"
    assert p["suggestion"] is None
    assert p["source_refs"] == [{"kind": "expense", "id": expense_id}]
    assert set(p["inputs"]) == {
        "latest_cost_per_kwh_sen",
        "average_cost_per_kwh_sen",
        "latest_date",
    }


def test_no_owner_text_is_stored_in_a_proposal(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    seed_pace(client, auth_headers)
    seed_warranty(client, auth_headers)
    seed_charges(client, auth_headers)
    run(client, auth_headers)
    engine = client.app.state.engine  # type: ignore[attr-defined]
    with engine.connect() as conn:
        dump = " ".join(
            str(v) for row in conn.execute(text("SELECT * FROM advisory_proposal")) for v in row
        )
    for private in ("Private warranty name", "private note", "Zeekr Service Centre"):
        assert private not in dump


# --- idempotence, dismissal and the unique key ----------------------------------------------


def test_repeating_a_run_does_not_duplicate(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    seed_pace(client, auth_headers)
    seed_warranty(client, auth_headers)
    assert len(run(client, auth_headers)["created"]) == 1
    again = run(client, auth_headers)
    assert again["created"] == [] and again["unchanged"] == 1
    assert len(client.get(f"{PROPOSALS}?status=all", headers=auth_headers).json()["items"]) == 1


def test_a_dismissed_finding_is_not_raised_again(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    seed_pace(client, auth_headers)
    w = seed_warranty(client, auth_headers)
    pid = run(client, auth_headers)["created"][0]["id"]
    client.patch(f"{PROPOSALS}/{pid}", json={"status": "dismissed"}, headers=auth_headers)
    # Editing the warranty keeps the same key, so the finding stays dismissed.
    client.patch(
        f"/api/v1/warranty-coverages/{w['id']}", json={"notes": "edited"}, headers=auth_headers
    )
    again = run(client, auth_headers)
    assert again["created"] == [] and again["unchanged"] == 1


def test_unique_key_is_enforced_by_the_database(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    seed_pace(client, auth_headers)
    seed_warranty(client, auth_headers)
    run(client, auth_headers)
    engine = client.app.state.engine  # type: ignore[attr-defined]
    sql = text(
        "INSERT INTO advisory_proposal (id, condition, dedupe_key, status, inputs, source_refs, "
        "explanation_status, rule_version) SELECT gen_random_uuid(), condition, dedupe_key, "
        "'proposed', '{}', '[]', 'disabled', 1 FROM advisory_proposal"
    )
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(sql)


def test_the_proposal_cap(
    client: TestClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.services import advisory

    monkeypatch.setattr(advisory, "MAX_PROPOSALS", 1)
    seed_pace(client, auth_headers)
    seed_warranty(client, auth_headers)
    seed_warranty(client, auth_headers, name="Second")
    r = client.post(CHECKS, headers=auth_headers)
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "validation_error"
    # The failed run stored nothing: it is all or nothing.
    assert client.get(f"{PROPOSALS}?status=all", headers=auth_headers).json()["items"] == []


# --- list and get ---------------------------------------------------------------------------


def test_list_filters_and_orders(client: TestClient, auth_headers: dict[str, str]) -> None:
    seed_pace(client, auth_headers)
    seed_warranty(client, auth_headers)
    seed_warranty(client, auth_headers, name="Second")
    created = run(client, auth_headers)["created"]
    assert len(created) == 2
    first = client.get(PROPOSALS, headers=auth_headers).json()["items"]
    assert len(first) == 2
    keys = [(i["created_at"], i["id"]) for i in first]
    assert keys == sorted(keys, reverse=True)
    client.patch(f"{PROPOSALS}/{first[0]['id']}", json={"status": "accepted"}, headers=auth_headers)
    assert len(client.get(PROPOSALS, headers=auth_headers).json()["items"]) == 1
    accepted = client.get(f"{PROPOSALS}?status=accepted", headers=auth_headers).json()["items"]
    assert [i["id"] for i in accepted] == [first[0]["id"]]
    assert (
        len(client.get(f"{PROPOSALS}?status=all&limit=1", headers=auth_headers).json()["items"])
        == 1
    )


@pytest.mark.parametrize(
    "q", ["limit=0", "limit=201", "limit=1.0", "limit=-1", "limit=abc", "status=x"]
)
def test_list_rejects_bad_query(client: TestClient, auth_headers: dict[str, str], q: str) -> None:
    r = client.get(f"{PROPOSALS}?{q}", headers=auth_headers)
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "validation_error"


def test_get_one_and_missing(client: TestClient, auth_headers: dict[str, str]) -> None:
    seed_pace(client, auth_headers)
    seed_warranty(client, auth_headers)
    p = run(client, auth_headers)["created"][0]
    assert client.get(f"{PROPOSALS}/{p['id']}", headers=auth_headers).json() == p
    r = client.get(f"{PROPOSALS}/{new_id()}", headers=auth_headers)
    assert r.status_code == 404
    assert client.get(f"{PROPOSALS}/not-a-uuid", headers=auth_headers).status_code == 400


# --- deciding -------------------------------------------------------------------------------


def test_decide_rules(client: TestClient, auth_headers: dict[str, str]) -> None:
    seed_pace(client, auth_headers)
    seed_warranty(client, auth_headers)
    pid = run(client, auth_headers)["created"][0]["id"]
    url = f"{PROPOSALS}/{pid}"
    r = client.patch(url, json={"status": "accepted"}, headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "accepted"
    assert r.json()["decided_at"] is not None
    # Same decision again: 200, unchanged.
    again = client.patch(url, json={"status": "accepted"}, headers=auth_headers)
    assert again.status_code == 200
    assert again.json() == r.json()
    # A different decision: 409.
    other = client.patch(url, json={"status": "dismissed"}, headers=auth_headers)
    assert other.status_code == 409
    assert other.json()["error"]["code"] == "conflict"
    assert client.get(url, headers=auth_headers).json()["status"] == "accepted"


@pytest.mark.parametrize(
    "bad",
    [
        {},
        {"status": "proposed"},
        {"status": "deleted"},
        {"status": None},
        {"status": 1},
        {"status": "accepted", "explanation": "x"},
        {"status": "accepted", "inputs": {}},
        {"urgency": "high"},
    ],
)
def test_decide_rejects_anything_else(
    client: TestClient, auth_headers: dict[str, str], bad: dict[str, Any]
) -> None:
    seed_pace(client, auth_headers)
    seed_warranty(client, auth_headers)
    pid = run(client, auth_headers)["created"][0]["id"]
    r = client.patch(f"{PROPOSALS}/{pid}", json=bad, headers=auth_headers)
    assert r.status_code == 400
    assert client.get(f"{PROPOSALS}/{pid}", headers=auth_headers).json()["status"] == "proposed"


def test_decide_unknown_id(client: TestClient, auth_headers: dict[str, str]) -> None:
    r = client.patch(f"{PROPOSALS}/{new_id()}", json={"status": "accepted"}, headers=auth_headers)
    assert r.status_code == 404


def test_deciding_changes_nothing_else(client: TestClient, auth_headers: dict[str, str]) -> None:
    seed_pace(client, auth_headers)
    seed_warranty(client, auth_headers)
    pid = run(client, auth_headers)["created"][0]["id"]
    before = client.get("/api/v1/reminders", headers=auth_headers).json()
    client.patch(f"{PROPOSALS}/{pid}", json={"status": "accepted"}, headers=auth_headers)
    assert client.get("/api/v1/reminders", headers=auth_headers).json() == before


def test_database_ties_decided_at_to_status(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    seed_pace(client, auth_headers)
    seed_warranty(client, auth_headers)
    run(client, auth_headers)
    engine = client.app.state.engine  # type: ignore[attr-defined]
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(text("UPDATE advisory_proposal SET status = 'accepted'"))


# --- model calls and settings ---------------------------------------------------------------


def test_model_calls_view_is_empty_and_bounded(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    assert client.get(f"{API}/model-calls", headers=auth_headers).json() == {"items": []}
    for q in ("limit=0", "limit=101", "limit=x"):
        assert client.get(f"{API}/model-calls?{q}", headers=auth_headers).status_code == 400


def test_model_calls_view_and_monthly_count(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    engine = client.app.state.engine  # type: ignore[attr-defined]
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO advisory_model_call (id, called_at, model_id, request_text, outcome) "
                "SELECT gen_random_uuid(), t, 'm', 'req', 'ok' "
                "FROM unnest(ARRAY[now(), now() - interval '3 years']) AS t"
            )
        )
    items = client.get(f"{API}/model-calls", headers=auth_headers).json()["items"]
    assert len(items) == 2
    assert set(items[0]) == {
        "id",
        "proposal_id",
        "called_at",
        "model_id",
        "request_text",
        "response_text",
        "input_tokens",
        "output_tokens",
        "outcome",
    }
    assert client.get(f"{API}/status", headers=auth_headers).json()["calls_this_month"] <= 1
    run(client, auth_headers)  # the run deletes calls older than about 13 months
    left = client.get(f"{API}/model-calls", headers=auth_headers).json()["items"]
    assert len(left) == 1


def test_enabled_switch_without_a_model_reports_unavailable(
    database_url: str, password_hash: str
) -> None:
    from app.main import create_app
    from tests.conftest import PASSWORD, USERNAME, make_settings, seed_owner

    seed_owner(database_url, password_hash)
    app = create_app(make_settings(database_url, advisory_model_enabled=True))
    with TestClient(app) as c:
        token = c.post(
            "/api/v1/auth/token", json={"username": USERNAME, "password": PASSWORD}
        ).json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        assert c.get(f"{API}/status", headers=headers).json()["model_enabled"] is True
        assert c.post(CHECKS, headers=headers).json()["model"]["status"] == "unavailable"
    app.state.engine.dispose()


def test_model_call_count_uses_the_kuala_lumpur_month() -> None:
    from app.services.advisory import month_start_kl

    # 1 Oct 00:00 in Kuala Lumpur is 30 Sep 16:00 UTC.
    assert month_start_kl(dt.date(2026, 10, 15)) == dt.datetime(2026, 9, 30, 16, tzinfo=dt.UTC)


def test_the_advisory_api_has_exactly_the_contract_routes() -> None:
    from app.cli.export_openapi import build_schema

    paths = build_schema()["paths"]
    found = {
        (method.upper(), path)
        for path, item in paths.items()
        if path.startswith("/api/v1/advisory")
        for method in item
    }
    assert found == {
        ("POST", "/api/v1/advisory/checks"),
        ("GET", "/api/v1/advisory/proposals"),
        ("GET", "/api/v1/advisory/proposals/{proposal_id}"),
        ("PATCH", "/api/v1/advisory/proposals/{proposal_id}"),
        ("GET", "/api/v1/advisory/model-calls"),
        ("GET", "/api/v1/advisory/status"),
    }
