"""Notification rules, build step 1 (ADR-015): the endpoints, the pure checks and the migration.
Every value is made up."""

from __future__ import annotations

import datetime as dt
import logging
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import text

from app.services.notification_rules import (
    RuleReading,
    central_lock_text,
    decide_send,
    evaluate_rule,
    explain,
)

URL = "/api/v1/notification-rules"
NOW = dt.datetime(2026, 11, 21, 12, 0, tzinfo=dt.UTC)

VS = {"field": "vehicle_status", "codes": ["0", "1"]}
ENG = {"field": "engine_status", "codes": ["engine-off"]}
GEAR = {"field": "gear", "codes": ["0"]}
LOC = {"field": "location", "where": "outside", "radius_km": 5}


def rule(**over: Any) -> dict[str, Any]:
    out: dict[str, Any] = {"name": "Parked and off", "conditions": [VS, ENG]}
    out.update(over)
    return out


def make(client: TestClient, headers: dict[str, str], **over: Any) -> dict[str, Any]:
    r = client.post(URL, json=rule(**over), headers=headers)
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


# ---- the pure checks -------------------------------------------------------------------------

GOOD = RuleReading(vehicle_status="1", engine_status="engine-off", gear="0", nearest_km=9.0)


@pytest.mark.parametrize(
    ("match", "conds", "reading", "want"),
    [
        ("all", [VS, ENG], GOOD, True),
        ("all", [VS, ENG], RuleReading(vehicle_status="2", engine_status="engine-off"), False),
        ("all", [VS, ENG], RuleReading(vehicle_status="1"), None),
        ("all", [VS, ENG], RuleReading(vehicle_status="2"), False),  # a false settles it
        ("any", [VS, ENG], RuleReading(vehicle_status="2", engine_status="engine-off"), True),
        ("any", [VS, ENG], RuleReading(vehicle_status="2", engine_status="ready"), False),
        ("any", [VS, ENG], RuleReading(vehicle_status="2"), None),
        ("any", [VS, ENG], RuleReading(vehicle_status="1"), True),  # a true settles it
        ("all", [GEAR], GOOD, True),
        ("all", [GEAR], RuleReading(gear="3"), False),
        ("all", [LOC], GOOD, True),  # 9 km away, outside a 5 km radius
        ("all", [LOC], RuleReading(nearest_km=5.0), False),  # exactly on the radius is inside
        ("all", [{**LOC, "where": "inside"}], RuleReading(nearest_km=5.0), True),
        ("all", [LOC], RuleReading(nearest_km=None), None),
        ("all", [LOC], RuleReading(nearest_km=9.0, home_set=False), None),
        (
            "all",
            [VS, ENG],
            RuleReading(stale=True, vehicle_status="1", engine_status="engine-off"),
            None,
        ),
        ("any", [VS], RuleReading(stale=True, vehicle_status="1"), None),
    ],
)
def test_evaluate_rule(
    match: str, conds: list[dict[str, Any]], reading: RuleReading, want: Any
) -> None:
    assert evaluate_rule(match, conds, reading) is want


def test_explain_gives_fixed_phrases() -> None:
    assert explain("all", [VS], RuleReading(stale=True)) == "reading too old"
    assert explain("all", [LOC], RuleReading(home_set=False)) == "home not set"
    assert explain("all", [VS], RuleReading()) == "no reading"


def test_reading_is_hidden_from_repr() -> None:
    assert "9.0" not in repr(GOOD) and "engine-off" not in repr(GOOD)


T0 = NOW - dt.timedelta(minutes=30)


@pytest.mark.parametrize(
    ("result", "last", "sent", "cool", "action", "kept"),
    [
        (None, None, None, 10, "none", None),
        (None, True, None, 10, "none", True),  # not evaluated: state unchanged
        (False, True, None, 10, "none", False),
        (True, None, None, 10, "send", True),  # a new rule that already holds sends once
        (True, False, None, 10, "send", True),
        (True, True, None, 10, "none", True),  # still matched: nothing more
        (True, False, NOW - dt.timedelta(minutes=5), 10, "hold", False),  # held, not marked
        (True, None, NOW - dt.timedelta(minutes=10), 10, "send", True),  # cooldown just over
        (True, False, NOW - dt.timedelta(minutes=1), 0, "send", True),  # 0 means none
        (True, False, T0, 10, "send", True),
    ],
)
def test_decide_send(result: Any, last: Any, sent: Any, cool: int, action: str, kept: Any) -> None:
    d = decide_send(result, last, sent, cool, NOW)
    assert (d.action, d.last_matched) == (action, kept)


def test_a_held_send_goes_out_after_the_cooldown() -> None:
    sent = NOW - dt.timedelta(minutes=5)
    assert decide_send(True, False, sent, 10, NOW).action == "hold"
    assert decide_send(True, False, sent, 10, NOW + dt.timedelta(minutes=5)).action == "send"


def test_after_a_restart_a_stored_match_does_not_repeat() -> None:
    assert decide_send(True, True, NOW, 10, NOW + dt.timedelta(days=1)).action == "none"


@pytest.mark.parametrize(
    ("locked", "want"),
    [
        (True, "Central locking: Locked."),
        (False, "Central locking: Unlocked."),
        (None, "Central locking: no reading."),
    ],
)
def test_lock_text_is_fixed(locked: bool | None, want: str) -> None:
    assert central_lock_text(locked) == want


# ---- the endpoints ----------------------------------------------------------------------------


def test_requires_a_token(client: TestClient) -> None:
    rid = uuid.uuid4()
    assert client.get(URL).status_code == 401
    assert client.get(f"{URL}/options").status_code == 401
    assert client.post(URL, json=rule()).status_code == 401
    assert client.put(f"{URL}/{rid}", json=rule()).status_code == 401
    assert client.delete(f"{URL}/{rid}").status_code == 401


def test_options_are_exact(client: TestClient, auth_headers: dict[str, str]) -> None:
    r = client.get(f"{URL}/options", headers=auth_headers)
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    j = r.json()
    fields = {f["field"]: [o["code"] for o in f["options"]] for f in j["fields"]}
    assert fields == {
        "vehicle_status": ["0", "1", "2", "3", "4", "13"],
        "engine_status": ["engine-off", "engine-running", "ready", "charging"],
        "gear": ["0", "1", "2", "3"],
        "location": ["outside", "inside"],
    }
    assert all(o["verified"] is False for f in j["fields"] for o in f["options"])
    assert [m["code"] for m in j["match"]] == ["all", "any"]
    assert j["limits"] == {
        "max_rules": 5,
        "max_conditions": 4,
        "cooldown_minutes_min": 0,
        "cooldown_minutes_max": 1440,
        "cooldown_minutes_default": 10,
        "radius_km_max": 100.0,
    }
    assert j["push_ready"] is False


def test_options_say_when_push_is_set_up(client: TestClient, auth_headers: dict[str, str]) -> None:
    s = client.app.state  # type: ignore[attr-defined]
    s.settings = s.settings.model_copy(
        update={
            "vapid_private_key": SecretStr("private-made-up"),
            "vapid_public_key": "public-made-up",
            "vapid_subject": SecretStr("mailto:owner@example.test"),
        }
    )
    assert client.get(f"{URL}/options", headers=auth_headers).json()["push_ready"] is True


def test_create_list_replace_delete(client: TestClient, auth_headers: dict[str, str]) -> None:
    assert client.get(URL, headers=auth_headers).json() == []
    made = make(client, auth_headers, conditions=[VS, ENG, GEAR, LOC])
    assert made["match"] == "all" and made["enabled"] is True and made["cooldown_minutes"] == 10
    assert made["last_matched"] is None and made["last_sent_at"] is None
    assert made["last_result"] == "not checked yet"
    listed = client.get(URL, headers=auth_headers)
    assert listed.headers["cache-control"] == "no-store" and listed.json() == [made]

    put = client.put(
        f"{URL}/{made['id']}",
        json=rule(name="Renamed", match="any", cooldown_minutes=0, enabled=False),
        headers=auth_headers,
    )
    assert put.status_code == 200
    assert put.json()["name"] == "Renamed" and put.json()["match"] == "any"
    assert put.json()["cooldown_minutes"] == 0 and put.json()["enabled"] is False

    assert client.delete(f"{URL}/{made['id']}", headers=auth_headers).status_code == 204
    assert client.get(URL, headers=auth_headers).json() == []


def test_the_sixth_rule_is_409(client: TestClient, auth_headers: dict[str, str]) -> None:
    for n in range(5):
        make(client, auth_headers, name=f"Rule {n}")
    r = client.post(URL, json=rule(name="Six"), headers=auth_headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    assert len(client.get(URL, headers=auth_headers).json()) == 5


@pytest.mark.parametrize(
    "bad",
    [
        {"name": ""},
        {"name": "x" * 61},
        {"name": 5},
        {"enabled": "yes"},
        {"match": "some"},
        {"cooldown_minutes": -1},
        {"cooldown_minutes": 1441},
        {"cooldown_minutes": 1.5},
        {"conditions": []},
        {"conditions": [VS, ENG, GEAR, LOC, {"field": "gear", "codes": ["1"]}]},
        {"conditions": [VS, VS]},  # a field twice
        {"conditions": [{"field": "tyre", "codes": ["1"]}]},  # unknown field
        {"conditions": [{"field": "vehicle_status", "codes": ["7"]}]},  # unknown code
        {"conditions": [{"field": "vehicle_status", "codes": []}]},
        {"conditions": [{"field": "vehicle_status", "codes": ["1", "1"]}]},
        {"conditions": [{"field": "engine_status", "codes": ["engine_off"]}]},
        {"conditions": [{"field": "gear", "codes": ["4"]}]},
        {"conditions": [{"field": "vehicle_status", "codes": ["1"], "extra": 1}]},
        {"conditions": [{"field": "location", "where": "near", "radius_km": 5}]},
        {"conditions": [{"field": "location", "where": "outside", "radius_km": 0}]},
        {"conditions": [{"field": "location", "where": "outside", "radius_km": 100.1}]},
        {"conditions": [{"field": "location", "where": "outside", "radius_km": "5"}]},
        {"conditions": [{"field": "location", "where": "outside"}]},
        {"extra": 1},
        {"name": "a\x00b"},
    ],
)
def test_bad_rules_are_400(
    client: TestClient, auth_headers: dict[str, str], bad: dict[str, Any]
) -> None:
    r = client.post(URL, json=rule(**bad), headers=auth_headers)
    assert r.status_code == 400 and r.json()["error"]["code"] == "validation_error"
    assert client.get(URL, headers=auth_headers).json() == []


def test_unknown_ids_are_404(client: TestClient, auth_headers: dict[str, str]) -> None:
    rid = uuid.uuid4()
    assert client.put(f"{URL}/{rid}", json=rule(), headers=auth_headers).status_code == 404
    assert client.delete(f"{URL}/{rid}", headers=auth_headers).status_code == 404
    assert client.delete(f"{URL}/not-a-uuid", headers=auth_headers).status_code == 400


def _set_state(client: TestClient, rid: str) -> None:
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(
            text(
                "UPDATE notification_rules SET last_matched = true, "
                "last_result = 'matched, sent', last_sent_at = :t WHERE id = :id"
            ),
            {"t": NOW, "id": rid},
        )


def test_editing_conditions_or_match_resets_the_state_but_keeps_last_sent(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    rid = make(client, auth_headers)["id"]
    _set_state(client, rid)
    for change in ({"conditions": [VS]}, {"match": "any"}):
        _set_state(client, rid)
        j = client.put(f"{URL}/{rid}", json=rule(**change), headers=auth_headers).json()
        assert j["last_matched"] is None and j["last_result"] == "not checked yet"
        assert j["last_sent_at"] is not None
        client.put(f"{URL}/{rid}", json=rule(), headers=auth_headers)


def test_editing_name_enabled_or_cooldown_keeps_the_state(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    rid = make(client, auth_headers)["id"]
    _set_state(client, rid)
    j = client.put(
        f"{URL}/{rid}",
        json=rule(name="New", enabled=False, cooldown_minutes=30),
        headers=auth_headers,
    ).json()
    assert j["last_matched"] is True and j["last_result"] == "matched, sent"
    assert j["last_sent_at"] is not None


def test_the_database_refuses_an_unlisted_result(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    rid = make(client, auth_headers)["id"]
    with pytest.raises(Exception, match="result_valid"), client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(
            text("UPDATE notification_rules SET last_result = 'at the office' WHERE id = :id"),
            {"id": rid},
        )


def test_no_reading_or_place_in_responses_or_logs(
    client: TestClient, auth_headers: dict[str, str], caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    rid = make(client, auth_headers, conditions=[VS, LOC])["id"]
    texts = [
        client.get(URL, headers=auth_headers).text,
        client.get(f"{URL}/options", headers=auth_headers).text,
        client.put(f"{URL}/{rid}", json=rule(), headers=auth_headers).text,
        caplog.text,
    ]
    for t in texts:
        for word in ("latitude", "longitude", "distance", "home_lat", "central_lock"):
            assert word not in t.lower()
