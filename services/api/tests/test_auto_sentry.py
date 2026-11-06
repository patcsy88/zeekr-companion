"""ADR-011 (approved 2026-11-06): automatic Sentry on. A fake car and made-up positions only.

The real Zeekr client is blocked for every test (conftest), so nothing here can reach the car.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.adapters.zeekr_live import ZeekrLiveTelemetryProvider
from app.services.auto_sentry import AutoSentrySender
from app.services.geofence import GeofenceCheck
from tests.test_geofence_check import NOW, OUTSIDE, Rig, configure, replies_for
from tests.test_sentry_api import FakeVehicle

AUTO = "/api/v1/vehicle/sentry/auto"
LOG = "/api/v1/vehicle/sentry/log"
CANARY = "CANARY-VALUE-9f3a"


class CarSource:
    """The status source for the geofence reading, and the vehicle for the one command."""

    def __init__(self, vehicle: FakeVehicle, *replies: Any) -> None:
        self._vehicle = vehicle
        self.replies = list(replies)
        self.calls = 0

    def __call__(self) -> Any:
        self.calls += 1
        reply = self.replies[min(self.calls, len(self.replies)) - 1]
        if isinstance(reply, Exception):
            raise reply
        return reply

    def vehicle(self) -> Any:
        return self._vehicle


def host(client: TestClient, tmp_path: Path, *, allowed: bool = True, **kw: Any) -> None:
    configure(client, tmp_path, geofence_auto_sentry_allowed=allowed, **kw)


def toggle(
    client: TestClient, headers: dict[str, str], enabled: bool = True, quiet: int = 60
) -> Any:
    return client.put(AUTO, json={"enabled": enabled, "quiet_minutes": quiet}, headers=headers)


def car(
    client: TestClient, vehicle: FakeVehicle, *specs: dict[str, Any]
) -> tuple[Rig, CarSource, list[float]]:
    sleeps: list[float] = []
    client.app.state.sentry_sleep = sleeps.append  # type: ignore[attr-defined]
    source = CarSource(vehicle, *replies_for(NOW, *specs))
    rig = Rig(client)
    rig.source = source  # type: ignore[assignment]
    client.app.state.live_telemetry = ZeekrLiveTelemetryProvider(  # type: ignore[attr-defined]
        source, clock=rig.clock, min_interval_s=300
    )
    return rig, source, sleeps


def log_rows(client: TestClient) -> list[tuple[Any, ...]]:
    with client.app.state.engine.connect() as conn:  # type: ignore[attr-defined]
        return [
            tuple(r)
            for r in conn.execute(
                text(
                    "SELECT desired, source, result, state_after, skip_reason FROM car_command_log"
                    " ORDER BY created_at, id"
                )
            )
        ]


def put_log_row(client: TestClient, when: dt.datetime, result: str = "sent", **kw: Any) -> None:
    values: dict[str, Any] = {"s": "manual", "r": result, "a": "on", "k": None}
    values.update(kw)
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(
            text(
                "INSERT INTO car_command_log (id, created_at, desired, source, result, "
                "state_after, skip_reason) VALUES (gen_random_uuid(), :t, 'on', :s, :r, :a, :k)"
            ),
            {"t": when, **values},
        )


# --- the settings endpoints (acceptance 26, 27, 36, 37) -------------------------------------


@pytest.mark.parametrize("method", ["get", "put"])
def test_both_need_a_token(client: TestClient, method: str) -> None:
    body = {"json": {"enabled": False, "quiet_minutes": 60}} if method == "put" else {}
    response = getattr(client, method)(AUTO, **body)
    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"


def test_it_is_off_at_60_minutes_by_default(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    response = client.get(AUTO, headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == {
        "enabled": False,
        "quiet_minutes": 60,
        "host_allowed": False,
        "can_enable": False,
        "limits": {"quiet_minutes": {"min": 5, "max": 1440}},
    }
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize(
    "missing",
    [
        {"geofence_auto_sentry_allowed": False},
        {"geofence_enabled": False},
    ],
)
def test_turning_it_on_needs_the_host_switch_and_the_geofence(
    client: TestClient,
    auth_headers: dict[str, str],
    tmp_path: Path,
    missing: dict[str, Any],
) -> None:
    host(client, tmp_path)
    client.app.state.settings = client.app.state.settings.model_copy(  # type: ignore[attr-defined]
        update=missing | {"zeekr_live_enabled": True}
    )
    response = toggle(client, auth_headers)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"
    assert client.get(AUTO, headers=auth_headers).json()["enabled"] is False


def test_turning_it_on_needs_live_readings(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    host(client, tmp_path)  # the test settings leave live readings off
    assert toggle(client, auth_headers).status_code == 409


def test_it_saves_when_every_lock_is_open_and_turning_off_always_works(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    on = toggle(client, auth_headers, True, 90)
    assert on.status_code == 200
    assert on.json()["enabled"] is True and on.json()["quiet_minutes"] == 90
    assert on.json()["can_enable"] is True and on.json()["host_allowed"] is True
    assert client.get(AUTO, headers=auth_headers).json() == on.json()
    client.app.state.settings = client.app.state.settings.model_copy(  # type: ignore[attr-defined]
        update={"geofence_auto_sentry_allowed": False}
    )
    off = toggle(client, auth_headers, False, 30)
    assert off.status_code == 200
    assert off.json()["enabled"] is False and off.json()["quiet_minutes"] == 30


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"enabled": True},
        {"quiet_minutes": 60},
        {"enabled": "yes", "quiet_minutes": 60},
        {"enabled": 1, "quiet_minutes": 60},
        {"enabled": False, "quiet_minutes": 4},
        {"enabled": False, "quiet_minutes": 1441},
        {"enabled": False, "quiet_minutes": 0},
        {"enabled": False, "quiet_minutes": -5},
        {"enabled": False, "quiet_minutes": 60.5},
        {"enabled": False, "quiet_minutes": "60"},
        {"enabled": False, "quiet_minutes": True},
        {"enabled": False, "quiet_minutes": 60, "extra": 1},
    ],
)
def test_a_bad_body_is_400_never_422(
    client: TestClient, auth_headers: dict[str, str], body: dict[str, Any]
) -> None:
    response = client.put(AUTO, json=body, headers=auth_headers)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"


@pytest.mark.parametrize("quiet", [5, 1440])
def test_the_limits_themselves_are_accepted(
    client: TestClient, auth_headers: dict[str, str], quiet: int
) -> None:
    assert toggle(client, auth_headers, False, quiet).status_code == 200


def test_saving_the_settings_sends_nothing_and_logs_nothing(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    vehicle = FakeVehicle(["0"])
    car(client, vehicle)
    assert toggle(client, auth_headers).status_code == 200
    assert vehicle.sent == [] and vehicle.reads == 0 and log_rows(client) == []


def test_use_the_host_values_leaves_the_toggle_alone(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    assert toggle(client, auth_headers, True, 45).status_code == 200
    saved = client.get("/api/v1/geofence/settings", headers=auth_headers).json()["settings"]
    assert (
        client.put("/api/v1/geofence/settings", json=saved, headers=auth_headers).status_code == 200
    )
    assert client.delete("/api/v1/geofence/settings", headers=auth_headers).status_code == 200
    again = client.get(AUTO, headers=auth_headers).json()
    assert again["enabled"] is True and again["quiet_minutes"] == 45


# --- the automatic send (acceptance 28 to 35) -----------------------------------------------


def test_a_new_alert_with_the_toggle_on_sends_on_once_and_logs_one_auto_row(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    toggle(client, auth_headers)
    vehicle = FakeVehicle(["0", "1"])  # off before, on after
    rig, _, sleeps = car(client, vehicle, {}, {}, {})
    assert rig.run() == "alert opened; automatic send: sent"
    assert vehicle.sent == [("start", "RSM", {"serviceParameters": [{"key": "rsm", "value": "6"}]})]
    assert sleeps == [15.0]
    assert log_rows(client) == [("on", "auto", "sent", "on", None)]
    assert rig.run() == "alert open"  # the same alert never sends twice
    assert rig.run() == "alert open"
    assert len(vehicle.sent) == 1 and len(log_rows(client)) == 1


def test_the_state_after_is_what_the_car_reports(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    toggle(client, auth_headers)
    vehicle = FakeVehicle(["0", "0"])  # the car did not take it
    rig, _, _ = car(client, vehicle, {})
    assert rig.run() == "alert opened; automatic send: not confirmed"
    assert log_rows(client) == [("on", "auto", "sent", "off", None)]


def test_with_the_toggle_off_nothing_is_sent_and_nothing_is_logged(
    client: TestClient, tmp_path: Path
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    vehicle = FakeVehicle(["0", "1"])
    rig, _, _ = car(client, vehicle, {})
    assert rig.run() == "alert opened"
    assert vehicle.sent == [] and vehicle.reads == 0 and log_rows(client) == []


@pytest.mark.parametrize(
    "spec",
    [
        {"sentry": "1"},  # Sentry already on: no alert
        {"where": (10.0, 20.0)},  # inside the area
        {"gear": "3"},
        {"usage": "13"},
    ],
)
def test_no_alert_means_no_send(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path, spec: dict[str, Any]
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    toggle(client, auth_headers)
    vehicle = FakeVehicle(["0", "1"])
    rig, _, _ = car(client, vehicle, spec)
    assert rig.run() == "clear"
    assert vehicle.sent == [] and log_rows(client) == []


def test_a_stale_reading_sends_nothing(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    toggle(client, auth_headers)
    vehicle = FakeVehicle(["0", "1"])
    rig, _, _ = car(client, vehicle, {"age_minutes": 45})
    assert rig.run() == "stale"
    assert vehicle.sent == [] and log_rows(client) == []


def test_an_incomplete_reading_sends_nothing(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    toggle(client, auth_headers)
    vehicle = FakeVehicle(["0", "1"])
    rig, _, _ = car(client, vehicle, {"usage": None})
    assert rig.run() == "incomplete"
    assert vehicle.sent == [] and log_rows(client) == []


def test_an_alert_that_is_already_open_does_not_send_when_the_toggle_comes_on_later(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    vehicle = FakeVehicle(["0", "1"])
    rig, _, _ = car(client, vehicle, {}, {})
    assert rig.run() == "alert opened"
    toggle(client, auth_headers)
    assert rig.run() == "alert open"
    assert vehicle.sent == [] and log_rows(client) == []


def test_a_new_episode_sends_again_but_a_restart_in_the_same_one_does_not(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    toggle(client, auth_headers, True, 5)
    vehicle = FakeVehicle(["0", "1", "0", "1"])
    rig, _, _ = car(client, vehicle, {}, {}, {"where": (10.0, 20.0)}, {})
    assert rig.run() == "alert opened; automatic send: sent"
    # A new GeofenceCheck object stands in for an API restart: the alert is still open.
    assert rig.run(GeofenceCheck(client.app)) == "alert open"  # type: ignore[arg-type]
    assert len(vehicle.sent) == 1
    assert rig.run() == "alert closed"
    # The quiet period (5 minutes) has passed by the time the next episode opens.
    assert rig.run() == "alert opened; automatic send: sent"
    assert len(vehicle.sent) == 2


def test_only_on_is_ever_sent_even_if_the_car_reads_on_already(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    toggle(client, auth_headers)
    vehicle = FakeVehicle(["1"])  # the status reading said off, the command read says on
    rig, _, _ = car(client, vehicle, {})
    assert rig.run() == "alert opened; automatic send: already on"
    assert vehicle.sent == [] and log_rows(client) == []


# --- skipped sends (acceptance 30, 31) ------------------------------------------------------


def test_a_recent_command_skips_the_send_and_logs_a_skip_without_calling_the_car(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    toggle(client, auth_headers)
    put_log_row(client, NOW, "sent")  # the first check runs at NOW + 5 minutes
    vehicle = FakeVehicle(["0", "1"])
    rig, _, _ = car(client, vehicle, {})
    assert rig.run() == "alert opened; automatic send: skipped (quiet_period)"
    assert vehicle.sent == [] and vehicle.reads == 0
    assert log_rows(client)[-1] == ("on", "auto", "skipped", None, "quiet_period")


def test_a_command_just_outside_the_quiet_period_does_not_skip(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    toggle(client, auth_headers, True, 30)
    put_log_row(client, NOW + dt.timedelta(minutes=5) - dt.timedelta(minutes=31), "sent")
    vehicle = FakeVehicle(["0", "1"])
    rig, _, _ = car(client, vehicle, {})
    assert rig.run() == "alert opened; automatic send: sent"
    assert len(vehicle.sent) == 1


def test_the_quiet_period_follows_the_setting(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    toggle(client, auth_headers, True, 1440)
    put_log_row(client, NOW - dt.timedelta(hours=20), "sent")
    vehicle = FakeVehicle(["0", "1"])
    rig, _, _ = car(client, vehicle, {})
    assert rig.run() == "alert opened; automatic send: skipped (quiet_period)"


def test_a_failed_manual_command_also_starts_the_quiet_period(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    toggle(client, auth_headers)
    put_log_row(client, NOW + dt.timedelta(minutes=1), "failed", a=None)
    rig, _, _ = car(client, FakeVehicle(["0", "1"]), {})
    assert rig.run() == "alert opened; automatic send: skipped (quiet_period)"


def test_a_skipped_row_does_not_start_the_quiet_period_or_the_spacing(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    toggle(client, auth_headers)
    put_log_row(client, NOW + dt.timedelta(minutes=4), "skipped", s="auto", a=None, k="busy")
    vehicle = FakeVehicle(["0", "1"])
    rig, _, _ = car(client, vehicle, {})
    assert rig.run() == "alert opened; automatic send: sent"
    assert len(vehicle.sent) == 1


def test_the_host_switch_turned_off_after_the_toggle_logs_a_host_off_skip(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    toggle(client, auth_headers)
    client.app.state.settings = client.app.state.settings.model_copy(  # type: ignore[attr-defined]
        update={"geofence_auto_sentry_allowed": False}
    )
    vehicle = FakeVehicle(["0", "1"])
    rig, _, _ = car(client, vehicle, {})
    assert rig.run() == "alert opened; automatic send: skipped (host_off)"
    assert vehicle.sent == [] and vehicle.reads == 0
    assert log_rows(client) == [("on", "auto", "skipped", None, "host_off")]


def test_a_send_in_progress_logs_a_busy_skip(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    toggle(client, auth_headers)
    vehicle = FakeVehicle(["0", "1"])
    rig, _, _ = car(client, vehicle, {})
    client.app.state.sentry_send_lock.acquire()  # type: ignore[attr-defined]
    try:
        assert rig.run() == "alert opened; automatic send: skipped (busy)"
    finally:
        client.app.state.sentry_send_lock.release()  # type: ignore[attr-defined]
    assert vehicle.sent == []
    assert log_rows(client) == [("on", "auto", "skipped", None, "busy")]


# --- failures are not retried and do not turn the toggle off (acceptance 32) -----------------


@pytest.mark.parametrize(
    ("vehicle", "row"),
    [
        (FakeVehicle(["0", "1"], accept=False), ("on", "auto", "refused", "on", None)),
        (
            FakeVehicle(["0", "1"], accept=RuntimeError(CANARY)),
            ("on", "auto", "failed", None, None),
        ),
    ],
)
def test_a_refusal_or_failure_is_logged_once_and_not_retried(
    client: TestClient,
    auth_headers: dict[str, str],
    tmp_path: Path,
    vehicle: FakeVehicle,
    row: tuple[Any, ...],
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    toggle(client, auth_headers)
    rig, _, _ = car(client, vehicle, {}, {}, {})
    outcome = rig.run()
    assert outcome == "alert opened; automatic send: failed or refused"
    assert rig.run() == "alert open" and rig.run() == "alert open"
    assert len(vehicle.sent) == 1
    assert len(log_rows(client)) == 1
    assert client.get(AUTO, headers=auth_headers).json()["enabled"] is True


def test_an_unreadable_car_logs_a_failed_row_and_the_check_goes_on(
    client: TestClient,
    auth_headers: dict[str, str],
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    toggle(client, auth_headers)
    vehicle = FakeVehicle([RuntimeError(CANARY)])
    rig, _, _ = car(client, vehicle, {})
    with caplog.at_level("DEBUG"):
        assert rig.run() == "alert opened; automatic send: failed or refused"
    assert log_rows(client) == [("on", "auto", "failed", None, None)]
    assert CANARY not in caplog.text


def test_an_unexpected_error_in_the_sender_does_not_stop_the_check(
    client: TestClient,
    auth_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    toggle(client, auth_headers)

    def boom(*_: object, **__: object) -> None:
        raise ValueError("boom")

    monkeypatch.setattr(AutoSentrySender, "_run", boom)
    rig, _, _ = car(client, FakeVehicle(["0", "1"]), {})
    assert rig.run() == "alert opened; automatic send: error"
    assert len(rig.rows()) == 1  # the alert is still there


# --- the log, and what must never be in it (acceptance 34) -----------------------------------


def test_the_log_shows_auto_and_skipped_rows_with_the_reason(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    toggle(client, auth_headers)
    put_log_row(client, NOW - dt.timedelta(hours=3), "sent")
    rig, _, _ = car(client, FakeVehicle(["0", "1"]), {})
    rig.run()
    items = client.get(LOG, headers=auth_headers).json()["items"]
    assert [(i["source"], i["result"], i["skip_reason"]) for i in items] == [
        ("auto", "sent", None),
        ("manual", "sent", None),
    ]
    assert {"id", "created_at", "desired", "source", "result", "state_after", "skip_reason"} == set(
        items[0]
    )


def test_nothing_sensitive_reaches_the_log_the_outcome_or_the_logs(
    client: TestClient,
    auth_headers: dict[str, str],
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    toggle(client, auth_headers)
    rig, _, _ = car(client, FakeVehicle(["0", "1"]), {})
    with caplog.at_level("DEBUG"):
        outcome = rig.run()
    body = client.get(LOG, headers=auth_headers).text
    with client.app.state.engine.connect() as conn:  # type: ignore[attr-defined]
        dump = str(list(conn.execute(text("SELECT * FROM car_command_log"))))
    for seen in (outcome, body, dump, caplog.text):
        assert CANARY not in seen
        for number in (str(OUTSIDE[0]), str(OUTSIDE[1]), "10.06", "20.0"):
            assert number not in seen


def test_the_manual_send_is_unchanged_and_logged_as_manual(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    client.app.state.sentry_sleep = lambda _: None  # type: ignore[attr-defined]
    vehicle = FakeVehicle(["0", "1"])
    car(client, vehicle)
    assert (
        client.post(
            "/api/v1/vehicle/sentry", json={"desired": "on"}, headers=auth_headers
        ).status_code
        == 200
    )
    assert log_rows(client) == [("on", "manual", "sent", "on", None)]
