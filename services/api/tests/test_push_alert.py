"""Push notifications, build step 2 (ADR-014): the alert hook and the real sender.
Fake sender and made-up addresses and keys only; `webpush` is patched, so nothing leaves."""

from __future__ import annotations

import datetime as dt
import json
import logging
import uuid
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import Settings
from app.repositories.push_subscriptions import SavedSubscription
from app.services import push as push_module
from app.services.push import (
    ALERT_TEXT_FAILED,
    ALERT_TEXT_OFF,
    ALERT_TEXT_ON,
    NoSender,
    SendResult,
    WebPushSender,
    alert_text,
    build_push_sender,
    notify_alert,
)
from tests.test_auto_sentry import car, host, toggle
from tests.test_push import SUBS, body, turn_on
from tests.test_sentry_api import FakeVehicle

NOW = dt.datetime(2026, 11, 20, 12, 0, tzinfo=dt.UTC)


def phones(client: TestClient, headers: dict[str, str], n: int = 1) -> None:
    for i in range(1, n + 1):
        assert client.post(SUBS, json=body(i), headers=headers).status_code == 201


@pytest.mark.parametrize(
    ("result", "text"),
    [
        (None, ALERT_TEXT_OFF),
        ("skipped (quiet period)", ALERT_TEXT_OFF),
        ("sent", ALERT_TEXT_ON),
        ("already on", ALERT_TEXT_ON),
        ("not confirmed", ALERT_TEXT_FAILED),
        ("failed or refused", ALERT_TEXT_FAILED),
        ("error", ALERT_TEXT_FAILED),
    ],
)
def test_the_text_follows_the_automatic_send_result(result: str | None, text: str) -> None:
    assert alert_text(result) == text


def test_the_texts_hold_no_position() -> None:
    for t in (ALERT_TEXT_OFF, ALERT_TEXT_ON, ALERT_TEXT_FAILED):
        assert t.startswith("Car is away from home") and not any(c.isdigit() for c in t)


def test_a_new_alert_notifies_once_with_the_toggle_off(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    fake = turn_on(client)
    phones(client, auth_headers, 2)
    rig, _, _ = car(client, FakeVehicle(["0", "1"]), {}, {})
    assert rig.run() == "alert opened"
    assert sorted(t for _, t in fake.sent) == [ALERT_TEXT_OFF] * 2
    assert rig.run() == "alert open"  # the same alert never notifies twice
    assert len(fake.sent) == 2


def test_a_new_alert_with_the_automatic_send_says_so(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    toggle(client, auth_headers)
    fake = turn_on(client)
    phones(client, auth_headers)
    rig, _, _ = car(client, FakeVehicle(["0", "1"]), {}, {}, {})
    assert rig.run() == "alert opened; automatic send: sent"
    assert [t for _, t in fake.sent] == [ALERT_TEXT_ON]


def test_a_send_that_is_not_confirmed_says_it_could_not(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    toggle(client, auth_headers)
    fake = turn_on(client)
    phones(client, auth_headers)
    rig, _, _ = car(client, FakeVehicle(["0", "0"]), {})
    assert rig.run() == "alert opened; automatic send: not confirmed"
    assert [t for _, t in fake.sent] == [ALERT_TEXT_FAILED]


@pytest.mark.parametrize(
    "spec",
    [{"sentry": "1"}, {"where": (10.0, 20.0)}, {"gear": "3"}, {"age_minutes": 45}],
)
def test_no_alert_means_no_notification(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path, spec: dict[str, Any]
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    fake = turn_on(client)
    phones(client, auth_headers)
    rig, _, _ = car(client, FakeVehicle(["0", "1"]), spec)
    rig.run()
    assert fake.sent == []


def test_with_push_off_nothing_is_sent(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    host(client, tmp_path, zeekr_live_enabled=True)
    fake = turn_on(client)
    phones(client, auth_headers)
    s = client.app.state  # type: ignore[attr-defined]
    s.settings = s.settings.model_copy(update={"vapid_subject": None})
    rig, _, _ = car(client, FakeVehicle(["0", "1"]), {})
    assert rig.run() == "alert opened"
    assert fake.sent == []


def test_a_failing_phone_never_breaks_the_check_or_the_automatic_send(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    class Boom:
        def send(self, sub: SavedSubscription, text: str) -> str:
            raise RuntimeError(sub.endpoint)

    host(client, tmp_path, zeekr_live_enabled=True)
    toggle(client, auth_headers)
    turn_on(client, Boom())
    phones(client, auth_headers)
    vehicle = FakeVehicle(["0", "1"])
    rig, _, _ = car(client, vehicle, {})
    assert rig.run() == "alert opened; automatic send: sent"
    assert len(vehicle.sent) == 1


def test_a_broken_notify_step_is_swallowed_and_logged_without_secrets(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    turn_on(client)

    def broken() -> Any:
        raise RuntimeError("https://push.example.test/secret-endpoint")

    client.app.state.session_factory = broken  # type: ignore[attr-defined]
    with caplog.at_level(logging.DEBUG):
        notify_alert(client.app, None, NOW)  # type: ignore[arg-type]
    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert "Push: alert notification failed" in logged and "push.example.test" not in logged


# --- the real sender, with webpush patched ----------------------------------------------------


def settings(client: TestClient) -> Settings:
    turn_on(client)
    return client.app.state.settings  # type: ignore[attr-defined,no-any-return]


def sub() -> SavedSubscription:
    return SavedSubscription(uuid.uuid4(), "https://push.example.test/a", "key-1", "auth-1")


def test_the_real_sender_passes_the_vapid_values_and_a_short_timeout(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen: dict[str, Any] = {}
    monkeypatch.setattr("pywebpush.webpush", lambda **kw: seen.update(kw) or "ok")
    assert WebPushSender(settings(client)).send(sub(), "Hello") == SendResult.OK
    assert seen["subscription_info"] == {
        "endpoint": "https://push.example.test/a",
        "keys": {"p256dh": "key-1", "auth": "auth-1"},
    }
    assert seen["vapid_private_key"] == "private-made-up"
    assert seen["vapid_claims"] == {"sub": "mailto:owner@example.test"}
    assert seen["timeout"] == push_module.SEND_TIMEOUT_S <= 10
    assert json.loads(seen["data"]) == {"body": "Hello", "url": "/?tab=sentry"}


class FakeResponse:
    def __init__(self, code: int) -> None:
        self.status_code = code
        self.text = "https://push.example.test/leak"


@pytest.mark.parametrize(
    ("code", "expected"),
    [
        (404, SendResult.GONE),
        (410, SendResult.GONE),
        (400, SendResult.FAILED),
        (413, SendResult.FAILED),
        (429, SendResult.FAILED),
        (500, SendResult.FAILED),
    ],
)
def test_the_real_sender_maps_status_codes(
    code: int, expected: str, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from pywebpush import WebPushException

    def refuse(**kw: Any) -> None:
        raise WebPushException("refused", response=FakeResponse(code))

    monkeypatch.setattr("pywebpush.webpush", refuse)
    assert WebPushSender(settings(client)).send(sub(), "x") == expected


def test_the_real_sender_treats_any_other_error_as_a_failure(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(**kw: Any) -> None:
        raise TimeoutError("slow")

    monkeypatch.setattr("pywebpush.webpush", boom)
    assert WebPushSender(settings(client)).send(sub(), "x") == SendResult.FAILED


def test_the_real_sender_without_host_values_fails_quietly(client: TestClient) -> None:
    s = client.app.state.settings.model_copy(  # type: ignore[attr-defined]
        update={"vapid_private_key": None}
    )
    assert WebPushSender(s).send(sub(), "x") == SendResult.FAILED


def test_the_real_sender_never_logs_the_endpoint_or_keys(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    from pywebpush import WebPushException

    def refuse(**kw: Any) -> None:
        raise WebPushException("x", response=FakeResponse(500))

    monkeypatch.setattr("pywebpush.webpush", refuse)
    with caplog.at_level(logging.DEBUG):
        WebPushSender(settings(client)).send(sub(), "x")
    logged = "\n".join(r.getMessage() for r in caplog.records)
    for secret in ("push.example.test", "key-1", "auth-1", "private-made-up", "owner@"):
        assert secret not in logged


def test_the_sender_is_real_only_when_all_three_host_values_are_set(client: TestClient) -> None:
    on = client.app.state.settings.model_copy(  # type: ignore[attr-defined]
        update={
            "vapid_private_key": SecretStr("p"),
            "vapid_public_key": "k",
            "vapid_subject": SecretStr("mailto:a@example.test"),
        }
    )
    assert isinstance(build_push_sender(on), WebPushSender)
    assert isinstance(build_push_sender(on.model_copy(update={"vapid_subject": None})), NoSender)
