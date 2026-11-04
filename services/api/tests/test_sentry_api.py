"""ADR-010: POST /vehicle/sentry and its log. A fake vehicle only; the real client is blocked."""

from __future__ import annotations

import datetime as dt
import threading
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.adapters.zeekr_live import ZeekrLiveTelemetryProvider
from app.services import sentry_command as svc

URL = "/api/v1/vehicle/sentry"
LOG = "/api/v1/vehicle/sentry/log"
CANARY = "CANARY-VALUE-9f3a"


class FakeVehicle:
    def __init__(self, states: list[Any], accept: Any = True) -> None:
        self.states = list(states)
        self.accept = accept
        self.sent: list[tuple[str, str, dict[str, Any]]] = []
        self.reads = 0

    def get_remote_control_state(self) -> dict[str, Any]:
        value = self.states[min(self.reads, len(self.states) - 1)]
        self.reads += 1
        if isinstance(value, Exception):
            raise value
        return {"vstdModeState": value, "gpsstate": CANARY}

    def do_remote_control(self, cmd: str, service_id: str, setting: dict[str, Any]) -> Any:
        self.sent.append((cmd, service_id, setting))
        if isinstance(self.accept, Exception):
            raise self.accept
        return self.accept


class FakeSource:
    def __init__(self, vehicle: FakeVehicle | None, error: Exception | None = None) -> None:
        self._vehicle = vehicle
        self._error = error
        self.vehicle_calls = 0

    def __call__(self) -> Any:  # the status read; the command path never uses it
        raise AssertionError("the command must not trigger a status read")

    def vehicle(self) -> Any:
        self.vehicle_calls += 1
        if self._error is not None:
            raise self._error
        return self._vehicle


@pytest.fixture
def install(client: TestClient) -> Any:
    sleeps: list[float] = []
    client.app.state.sentry_sleep = sleeps.append  # type: ignore[attr-defined]

    def go(vehicle: FakeVehicle | None, error: Exception | None = None) -> FakeSource:
        source = FakeSource(vehicle, error)
        client.app.state.live_telemetry = ZeekrLiveTelemetryProvider(source)  # type: ignore[attr-defined]
        return source

    go.sleeps = sleeps  # type: ignore[attr-defined]
    return go


def rows(client: TestClient) -> list[Any]:
    with client.app.state.engine.connect() as conn:  # type: ignore[attr-defined]
        return list(
            conn.execute(
                text(
                    "SELECT desired, source, result, state_after FROM car_command_log"
                    " ORDER BY created_at"
                )
            )
        )


@pytest.mark.parametrize(("method", "url"), [("post", URL), ("get", LOG)])
def test_both_need_a_token(client: TestClient, method: str, url: str) -> None:
    response = getattr(client, method)(
        url, **({"json": {"desired": "on"}} if method == "post" else {})
    )
    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"


def test_live_off_is_404_and_sends_nothing(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    assert client.app.state.live_telemetry is None  # type: ignore[attr-defined]
    response = client.post(URL, json={"desired": "on"}, headers=auth_headers)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
    assert rows(client) == []


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"desired": "toggle"},
        {"desired": "ON"},
        {"desired": True},
        {"desired": "on", "x": 1},
        [],
    ],
)
def test_a_bad_body_is_400_and_sends_nothing(
    client: TestClient, auth_headers: dict[str, str], install: Any, body: Any
) -> None:
    vehicle = FakeVehicle(["0"])
    install(vehicle)
    response = client.post(URL, json=body, headers=auth_headers)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"
    assert vehicle.sent == [] and vehicle.reads == 0


def test_on_sends_one_command_waits_and_reads_back(
    client: TestClient, auth_headers: dict[str, str], install: Any
) -> None:
    vehicle = FakeVehicle(["0", "1"])
    install(vehicle)
    response = client.post(URL, json={"desired": "on"}, headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == {
        "desired": "on",
        "sent": True,
        "state_after": "on",
        "confirmed": True,
    }
    assert vehicle.sent == [("start", "RSM", {"serviceParameters": [{"key": "rsm", "value": "6"}]})]
    assert install.sleeps == [15.0]
    assert rows(client) == [("on", "manual", "sent", "on")]
    assert response.headers["cache-control"] == "no-store"
    assert CANARY not in response.text


def test_off_sends_stop(client: TestClient, auth_headers: dict[str, str], install: Any) -> None:
    vehicle = FakeVehicle(["1", "0"])
    install(vehicle)
    body = client.post(URL, json={"desired": "off"}, headers=auth_headers).json()
    assert body["confirmed"] is True and vehicle.sent[0][0] == "stop"


def test_already_in_the_wanted_state_sends_nothing_and_logs_nothing(
    client: TestClient, auth_headers: dict[str, str], install: Any
) -> None:
    vehicle = FakeVehicle(["1"])
    install(vehicle)
    body = client.post(URL, json={"desired": "on"}, headers=auth_headers).json()
    assert body == {"desired": "on", "sent": False, "state_after": "on", "confirmed": True}
    assert vehicle.sent == [] and install.sleeps == [] and rows(client) == []


def test_accepted_but_not_yet_reported_is_not_confirmed(
    client: TestClient, auth_headers: dict[str, str], install: Any
) -> None:
    install(FakeVehicle(["0", "0"]))
    body = client.post(URL, json={"desired": "on"}, headers=auth_headers).json()
    assert body["sent"] is True and body["state_after"] == "off" and body["confirmed"] is False
    assert rows(client) == [("on", "manual", "sent", "off")]


def test_an_unreadable_state_after_is_null_not_a_guess(
    client: TestClient, auth_headers: dict[str, str], install: Any
) -> None:
    install(FakeVehicle(["0", RuntimeError(CANARY)]))
    body = client.post(URL, json={"desired": "on"}, headers=auth_headers).json()
    assert body["state_after"] is None and body["confirmed"] is False
    assert rows(client) == [("on", "manual", "sent", None)]


@pytest.mark.parametrize("accept", [False, None, RuntimeError(f"secret {CANARY}")])
def test_a_refusal_is_502_with_a_fixed_message_and_no_retry(
    client: TestClient, auth_headers: dict[str, str], install: Any, accept: Any
) -> None:
    vehicle = FakeVehicle(["0", "0"], accept)
    install(vehicle)
    response = client.post(URL, json={"desired": "on"}, headers=auth_headers)
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "upstream_error"
    assert response.json()["error"]["message"] == svc._REFUSED
    assert CANARY not in response.text
    assert len(vehicle.sent) == 1
    assert rows(client) == [("on", "manual", "refused", "off")]


def test_a_login_or_read_failure_is_502_and_sends_nothing(
    client: TestClient, auth_headers: dict[str, str], install: Any
) -> None:
    install(None, RuntimeError(f"token {CANARY}"))
    response = client.post(URL, json={"desired": "on"}, headers=auth_headers)
    assert response.status_code == 502 and CANARY not in response.text
    assert response.json()["error"]["message"] == svc._FAILED
    assert rows(client) == [("on", "manual", "failed", None)]

    vehicle = FakeVehicle([RuntimeError(CANARY)])
    install(vehicle)
    # the spacing rule applies, so move the logged time back first
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(text("UPDATE car_command_log SET created_at = created_at - interval '1 hour'"))
    response = client.post(URL, json={"desired": "on"}, headers=auth_headers)
    assert response.status_code == 502 and vehicle.sent == []


def test_a_second_send_too_soon_is_409(
    client: TestClient, auth_headers: dict[str, str], install: Any
) -> None:
    vehicle = FakeVehicle(["0", "1", "1", "0"])
    install(vehicle)
    assert client.post(URL, json={"desired": "on"}, headers=auth_headers).status_code == 200
    response = client.post(URL, json={"desired": "off"}, headers=auth_headers)
    assert response.status_code == 409
    assert response.json()["error"]["message"] == svc._SOON
    assert len(vehicle.sent) == 1


def test_a_send_after_the_spacing_is_allowed(
    client: TestClient, auth_headers: dict[str, str], install: Any
) -> None:
    vehicle = FakeVehicle(["0", "1", "1", "0"])
    install(vehicle)
    client.post(URL, json={"desired": "on"}, headers=auth_headers)
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(text("UPDATE car_command_log SET created_at = created_at - interval '2 min'"))
    assert client.post(URL, json={"desired": "off"}, headers=auth_headers).status_code == 200
    assert [s[0] for s in vehicle.sent] == ["start", "stop"]


def test_one_in_flight_at_a_time_is_409(
    client: TestClient, auth_headers: dict[str, str], install: Any
) -> None:
    vehicle = FakeVehicle(["0", "1"])
    install(vehicle)
    lock: threading.Lock = client.app.state.sentry_send_lock  # type: ignore[attr-defined]
    assert lock.acquire(blocking=False)
    try:
        response = client.post(URL, json={"desired": "on"}, headers=auth_headers)
    finally:
        lock.release()
    assert response.status_code == 409 and response.json()["error"]["message"] == svc._BUSY
    assert vehicle.sent == [] and vehicle.reads == 0


def test_a_status_read_in_progress_makes_the_send_wait_then_409(
    client: TestClient,
    auth_headers: dict[str, str],
    install: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(svc, "LIVE_LOCK_WAIT_S", 0.05)
    vehicle = FakeVehicle(["0", "1"])
    install(vehicle)
    live: threading.Lock = client.app.state.live_lock  # type: ignore[attr-defined]
    assert live.acquire(blocking=False)
    try:
        response = client.post(URL, json={"desired": "on"}, headers=auth_headers)
    finally:
        live.release()
    assert response.status_code == 409 and vehicle.sent == []


def test_the_send_lock_is_released_after_a_failure(
    client: TestClient, auth_headers: dict[str, str], install: Any
) -> None:
    install(None, RuntimeError("x"))
    client.post(URL, json={"desired": "on"}, headers=auth_headers)
    lock: threading.Lock = client.app.state.sentry_send_lock  # type: ignore[attr-defined]
    assert lock.acquire(blocking=False)
    lock.release()


def test_the_log_lists_newest_first_with_no_payload(
    client: TestClient, auth_headers: dict[str, str], install: Any
) -> None:
    install(FakeVehicle(["0", "1", "1", "0"]))
    client.post(URL, json={"desired": "on"}, headers=auth_headers)
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(text("UPDATE car_command_log SET created_at = created_at - interval '2 min'"))
    client.post(URL, json={"desired": "off"}, headers=auth_headers)
    body = client.get(LOG, headers=auth_headers).json()
    assert body["retention_months"] == 12
    assert [i["desired"] for i in body["items"]] == ["off", "on"]
    assert set(body["items"][0]) == {
        "id",
        "created_at",
        "desired",
        "source",
        "result",
        "state_after",
    }
    assert client.get(LOG + "?limit=1", headers=auth_headers).json()["items"][0]["desired"] == "off"
    for bad in ("0", "101", "x", "1.0", "-1"):
        assert client.get(f"{LOG}?limit={bad}", headers=auth_headers).status_code == 400


def test_the_log_works_with_live_off_and_old_rows_are_dropped(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    old = dt.datetime.now(dt.UTC) - dt.timedelta(days=400)
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(
            text(
                "INSERT INTO car_command_log (id, created_at, desired, source, result)"
                " VALUES (gen_random_uuid(), :t, 'on', 'manual', 'sent')"
            ),
            {"t": old},
        )
    assert client.get(LOG, headers=auth_headers).json()["items"] == []


def test_the_table_refuses_a_payload_shaped_value(client: TestClient) -> None:
    from sqlalchemy.exc import IntegrityError

    engine = client.app.state.engine  # type: ignore[attr-defined]
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO car_command_log (id, created_at, desired, source, result)"
                " VALUES (gen_random_uuid(), now(), 'RSM', 'manual', 'sent')"
            )
        )


def test_the_wait_setting_defaults_to_15_and_refuses_values_outside_5_to_30(
    database_url: str,
) -> None:
    from pydantic import ValidationError

    from tests.conftest import make_settings

    assert make_settings(database_url).sentry_confirm_wait_seconds == 15
    for good in (5, 30):
        assert make_settings(database_url, sentry_confirm_wait_seconds=good)
    for bad in (4, 31, 0, -1):
        with pytest.raises(ValidationError):
            make_settings(database_url, sentry_confirm_wait_seconds=bad)


def test_a_configured_wait_is_what_the_server_sleeps(
    client: TestClient, auth_headers: dict[str, str], install: Any
) -> None:
    app = client.app
    app.state.settings = app.state.settings.model_copy(  # type: ignore[attr-defined]
        update={"sentry_confirm_wait_seconds": 22}
    )
    install(FakeVehicle(["0", "1"]))
    assert client.post(URL, json={"desired": "on"}, headers=auth_headers).status_code == 200
    assert install.sleeps == [22.0]
