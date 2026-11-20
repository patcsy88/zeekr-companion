"""Push notifications, build step 1 (ADR-014): the phones, the four endpoints and the sender seam.
Every endpoint, key and address here is made up."""

from __future__ import annotations

import datetime as dt
import logging
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import text

from app.repositories.push_subscriptions import PushSubscriptionRepository, SavedSubscription
from app.schemas import PUSH_MAX_DEVICES
from app.services.push import NoSender, PushService, SendResult, push_enabled
from tests.conftest import make_settings

CFG = "/api/v1/push/config"
SUBS = "/api/v1/push/subscriptions"
TEST = "/api/v1/push/test"
NOW = dt.datetime(2026, 11, 20, 12, 0, tzinfo=dt.UTC)


def body(n: int = 1, **over: Any) -> dict[str, Any]:
    out: dict[str, Any] = {
        "endpoint": f"https://push.example.test/send/device-{n}",
        "keys": {"p256dh": f"public-key-{n}", "auth": f"auth-secret-{n}"},
    }
    out.update(over)
    return out


class Fake:
    """Records what it was asked to send and answers from a script."""

    def __init__(self, answers: dict[str, str] | None = None) -> None:
        self.answers = answers or {}
        self.sent: list[tuple[str, str]] = []

    def send(self, sub: SavedSubscription, text: str) -> str:
        self.sent.append((sub.endpoint, text))
        return self.answers.get(sub.endpoint, SendResult.OK)


def turn_on(client: TestClient, fake: Any = None) -> Any:
    fake = fake or Fake()
    s = client.app.state  # type: ignore[attr-defined]
    s.settings = s.settings.model_copy(
        update={
            "vapid_private_key": SecretStr("private-made-up"),
            "vapid_public_key": "public-made-up",
            "vapid_subject": SecretStr("mailto:owner@example.test"),
        }
    )
    s.push_sender = fake
    return fake


def test_requires_a_token(client: TestClient) -> None:
    assert client.get(CFG).status_code == 401
    assert client.post(SUBS, json=body()).status_code == 401
    assert client.request("DELETE", SUBS, json={"endpoint": "https://x.test/a"}).status_code == 401
    assert client.post(TEST).status_code == 401


def test_config_is_off_without_host_keys(client: TestClient, auth_headers: dict[str, str]) -> None:
    r = client.get(CFG, headers=auth_headers)
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    assert r.json() == {"enabled": False, "public_key": None, "devices": 0, "max_devices": 5}


def test_config_shows_the_public_key_only_when_on(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    turn_on(client)
    j = client.get(CFG, headers=auth_headers).json()
    assert j == {"enabled": True, "public_key": "public-made-up", "devices": 0, "max_devices": 5}
    assert "private" not in str(j) and "example.test" not in str(j)


@pytest.mark.parametrize("missing", ["vapid_private_key", "vapid_public_key", "vapid_subject"])
def test_push_needs_all_three_host_values(missing: str, database_url: str) -> None:
    full: dict[str, Any] = {
        "vapid_private_key": SecretStr("p"),
        "vapid_public_key": "k",
        "vapid_subject": SecretStr("mailto:a@example.test"),
    }
    assert push_enabled(make_settings(database_url, **full)) is True
    full[missing] = None
    assert push_enabled(make_settings(database_url, **full)) is False


def test_subscribe_is_201_then_200_and_never_echoes_secrets(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    r = client.post(SUBS, json=body(1), headers=auth_headers)
    assert r.status_code == 201 and r.json() == {"devices": 1}
    assert r.headers["cache-control"] == "no-store"
    again = client.post(
        SUBS, json=body(1, keys={"p256dh": "new", "auth": "newer"}), headers=auth_headers
    )
    assert again.status_code == 200 and again.json() == {"devices": 1}
    with client.app.state.engine.connect() as conn:  # type: ignore[attr-defined]
        row = conn.execute(text("SELECT p256dh, auth, failure_count FROM push_subscription")).one()
    assert tuple(row) == ("new", "newer", 0)
    for text_out in (r.text, again.text, client.get(CFG, headers=auth_headers).text):
        assert "push.example.test" not in text_out and "secret" not in text_out


def test_the_sixth_phone_is_409_and_the_five_stay(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    for n in range(1, PUSH_MAX_DEVICES + 1):
        assert client.post(SUBS, json=body(n), headers=auth_headers).status_code == 201
    r = client.post(SUBS, json=body(6), headers=auth_headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"
    assert client.get(CFG, headers=auth_headers).json()["devices"] == 5
    assert client.post(SUBS, json=body(3), headers=auth_headers).status_code == 200


@pytest.mark.parametrize(
    "bad",
    [
        {"endpoint": "http://push.example.test/a"},
        {"endpoint": "https://"},
        {"endpoint": "https://push.example.test/a b"},
        {"endpoint": ""},
        {"endpoint": "https://push.example.test/" + "a" * 2048},
        {"endpoint": 5},
        {"keys": {"p256dh": "", "auth": "x"}},
        {"keys": {"p256dh": "x", "auth": ""}},
        {"keys": {"p256dh": "x" * 257, "auth": "x"}},
        {"keys": {"p256dh": "x"}},
        {"keys": {"p256dh": "x", "auth": "y", "extra": "z"}},
        {"extra": 1},
        {"endpoint": "https://push.example.test/a\x00b"},
    ],
)
def test_bad_subscribe_bodies_are_400_never_422(
    bad: dict[str, Any], client: TestClient, auth_headers: dict[str, str]
) -> None:
    r = client.post(SUBS, json=body(1, **bad), headers=auth_headers)
    assert r.status_code == 400 and r.json()["error"]["code"] == "validation_error"
    assert client.get(CFG, headers=auth_headers).json()["devices"] == 0


def test_a_missing_body_is_400(client: TestClient, auth_headers: dict[str, str]) -> None:
    assert client.post(SUBS, json={}, headers=auth_headers).status_code == 400
    assert client.request("DELETE", SUBS, json={}, headers=auth_headers).status_code == 400


def test_unsubscribe_is_repeatable(client: TestClient, auth_headers: dict[str, str]) -> None:
    client.post(SUBS, json=body(1), headers=auth_headers)
    client.post(SUBS, json=body(2), headers=auth_headers)
    for expect in (1, 1):
        r = client.request(
            "DELETE", SUBS, json={"endpoint": body(1)["endpoint"]}, headers=auth_headers
        )
        assert r.status_code == 200 and r.json() == {"devices": expect}
        assert r.headers["cache-control"] == "no-store"
    unknown = client.request(
        "DELETE", SUBS, json={"endpoint": "https://nope.test/x"}, headers=auth_headers
    )
    assert unknown.status_code == 200 and unknown.json() == {"devices": 1}


def test_test_message_is_409_when_push_is_off(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    r = client.post(TEST, headers=auth_headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"


def test_test_message_goes_to_every_phone_with_fixed_text(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    fake = turn_on(client)
    for n in (1, 2, 3):
        client.post(SUBS, json=body(n), headers=auth_headers)
    r = client.post(TEST, headers=auth_headers)
    assert r.status_code == 200 and r.json() == {"sent": 3, "failed": 0}
    assert r.headers["cache-control"] == "no-store"
    assert {t for _, t in fake.sent} == {"Test from Zeekr Companion."}
    assert len(fake.sent) == 3


def test_a_gone_phone_is_removed_and_the_others_still_get_it(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    gone = body(2)["endpoint"]
    fake = turn_on(client, Fake({gone: SendResult.GONE}))
    for n in (1, 2, 3):
        client.post(SUBS, json=body(n), headers=auth_headers)
    r = client.post(TEST, headers=auth_headers)
    assert r.json() == {"sent": 2, "failed": 1}
    assert len(fake.sent) == 3
    assert client.get(CFG, headers=auth_headers).json()["devices"] == 2


def test_five_failures_in_a_row_remove_the_phone_and_a_success_resets_the_count(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    flaky = body(1)["endpoint"]
    fake = turn_on(client, Fake({flaky: SendResult.FAILED}))
    client.post(SUBS, json=body(1), headers=auth_headers)
    for _ in range(4):
        assert client.post(TEST, headers=auth_headers).json() == {"sent": 0, "failed": 1}
    assert client.get(CFG, headers=auth_headers).json()["devices"] == 1
    fake.answers.clear()
    assert client.post(TEST, headers=auth_headers).json() == {"sent": 1, "failed": 0}
    with client.app.state.engine.connect() as conn:  # type: ignore[attr-defined]
        n, ok = conn.execute(
            text("SELECT failure_count, last_success_at FROM push_subscription")
        ).one()
    assert n == 0 and ok is not None
    fake.answers[flaky] = SendResult.FAILED
    for _ in range(5):
        client.post(TEST, headers=auth_headers)
    assert client.get(CFG, headers=auth_headers).json()["devices"] == 0


def test_a_sender_that_raises_counts_as_a_failure_and_never_breaks_the_rest(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    class Boom:
        def send(self, sub: SavedSubscription, text: str) -> str:
            raise RuntimeError(sub.endpoint)

    turn_on(client, Boom())
    client.post(SUBS, json=body(1), headers=auth_headers)
    r = client.post(TEST, headers=auth_headers)
    assert r.status_code == 200 and r.json() == {"sent": 0, "failed": 1}


def test_the_log_line_holds_no_endpoint_and_no_key(
    client: TestClient, auth_headers: dict[str, str], caplog: pytest.LogCaptureFixture
) -> None:
    turn_on(client, Fake({body(1)["endpoint"]: SendResult.FAILED}))
    client.post(SUBS, json=body(1), headers=auth_headers)
    with caplog.at_level(logging.DEBUG):
        client.post(TEST, headers=auth_headers)
    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert "Push: 1 of 1 sends failed" in logged
    for secret in ("push.example.test", "public-key-1", "auth-secret-1", "owner@example.test"):
        assert secret not in logged


def test_the_default_sender_fails_every_send_until_the_library_is_installed(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    assert isinstance(client.app.state.push_sender, NoSender)  # type: ignore[attr-defined]
    sub = SavedSubscription(__import__("uuid").uuid4(), "https://x.test/a", "k", "a")
    assert NoSender().send(sub, "hi") == SendResult.FAILED


def test_repository_edges(client: TestClient) -> None:
    factory = client.app.state.session_factory  # type: ignore[attr-defined]
    with factory() as session:
        repo = PushSubscriptionRepository(session)
        assert repo.count() == 0 and repo.all() == []
        assert repo.upsert("https://a.test/1", "k", "a", NOW, 1) == "created"
        assert repo.upsert("https://a.test/2", "k", "a", NOW, 1) == "full"
        assert repo.upsert("https://a.test/1", "k2", "a2", NOW, 1) == "updated"
        only = repo.all()[0]
        repo.record_success(only.id, NOW)
        repo.record_failure(only.id, 2)
        repo.record_failure(only.id, 2)
        assert repo.count() == 0
        repo.record_success(only.id, NOW)
        repo.record_failure(only.id, 2)
        repo.delete_id(only.id)
        repo.delete_endpoint("https://a.test/none")


def test_service_without_a_repo_row_is_quiet(client: TestClient) -> None:
    state = client.app.state  # type: ignore[attr-defined]
    with state.session_factory() as session:
        service = PushService(PushSubscriptionRepository(session), state.settings, Fake())
        assert service.send_all("x", NOW).model_dump() == {"sent": 0, "failed": 0}
