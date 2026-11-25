"""Notification rules, build step 2 (ADR-015): the check, the send and the cooldown.
Fake source, fake sender, made-up places (home 10.0, 20.0) and made-up addresses only."""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import text

from app.adapters.zeekr_live import ZeekrLiveTelemetryProvider
from app.repositories.push_subscriptions import SavedSubscription
from app.services import push as push_module
from app.services import rule_check
from app.services.push import SendResult, WebPushSender
from app.services.rule_check import RuleCheck, rules_lifespan
from tests.test_geofence_check import INSIDE, NOW, OUTSIDE, Rig, configure, reading
from tests.test_live_vehicle import Clock, Source
from tests.test_push import SUBS, body, turn_on

URL = "/api/v1/notification-rules"
VS = {"field": "vehicle_status", "codes": ["0", "1"]}
ENG = {"field": "engine_status", "codes": ["engine-off"]}
LOC = {"field": "location", "where": "outside", "radius_km": 5}


class Sender:
    def __init__(self, answer: str = SendResult.OK) -> None:
        self.answer = answer
        self.sent: list[tuple[str, str]] = []

    def send(self, sub: SavedSubscription, text: str, url: str = "/sentry") -> str:
        self.sent.append((text, url))
        return self.answer


def car(
    at: dt.datetime,
    where: tuple[float, float] = OUTSIDE,
    *,
    engine: object = "engine-off",
    lock: object = "1",
    **kw: Any,
) -> dict[str, Any]:
    r = reading(at, where, **kw)
    if engine is not None:
        r["basicVehicleStatus"]["engineStatus"] = engine
    if lock is not None:
        r["additionalVehicleStatus"]["drivingSafetyStatus"] = {"centralLockingStatus": lock}
    return r


class Setup:
    def __init__(
        self,
        client: TestClient,
        headers: dict[str, str],
        tmp_path: Path,
        *specs: dict[str, Any],
        push: bool = True,
        phone: bool = True,
        **cfg: Any,
    ) -> None:
        self.client = client
        configure(client, tmp_path, **cfg)
        self.sender = Sender()
        if push:
            turn_on(client, self.sender)
        if phone:
            assert client.post(SUBS, json=body(1), headers=headers).status_code == 201
        self.headers = headers
        self.rig = Rig(
            client,
            *[car(NOW + dt.timedelta(minutes=5 * (i + 1)), **spec) for i, spec in enumerate(specs)],
        )

    def rule(self, **over: Any) -> str:
        payload: dict[str, Any] = {"name": "R", "conditions": [VS, ENG], "cooldown_minutes": 0}
        payload.update(over)
        r = self.client.post(URL, json=payload, headers=self.headers)
        assert r.status_code == 201, r.text
        return str(r.json()["id"])

    def run(self, job: RuleCheck | None = None) -> str:
        self.rig.clock.now += 301
        self.rig.when += dt.timedelta(minutes=5)
        return (job or RuleCheck(self.client.app)).run_once(self.rig.when)  # type: ignore[arg-type]

    def state(self) -> list[dict[str, Any]]:
        return self.client.get(URL, headers=self.headers).json()  # type: ignore[no-any-return]


def test_it_sends_once_with_the_fixed_text_and_the_vehicle_tab(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    s = Setup(client, auth_headers, tmp_path, {}, {}, {})
    s.rule()
    assert s.run() == "1 rules, 1 sent"
    assert s.sender.sent == [("Central locking: Locked.", "/vehicle")]
    row = s.state()[0]
    assert row["last_matched"] is True and row["last_result"] == "matched, sent"
    assert row["last_sent_at"] is not None
    assert s.run() == "1 rules, 0 sent" and len(s.sender.sent) == 1  # still matched: no repeat


def test_it_sends_again_after_the_rule_stops_matching(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    s = Setup(client, auth_headers, tmp_path, {}, {"usage": "2"}, {})
    s.rule()
    s.run()
    s.run()
    assert s.state()[0]["last_result"] == "not matched" and s.state()[0]["last_matched"] is False
    s.run()
    assert len(s.sender.sent) == 2


def test_the_cooldown_holds_a_send_then_sends_after_it(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    s = Setup(client, auth_headers, tmp_path, {}, {"usage": "2"}, {}, {}, {})
    s.rule(cooldown_minutes=20)
    s.run()  # t=5 sent
    s.run()  # t=10 not matched
    s.run()  # t=15 matched again, 10 minutes after the send: held
    assert len(s.sender.sent) == 1
    row = s.state()[0]
    assert row["last_result"] == "matched, held by cooldown" and row["last_matched"] is False
    s.run()  # t=20: 15 minutes, still held
    assert len(s.sender.sent) == 1
    s.run()  # t=25: 20 minutes, sends
    assert len(s.sender.sent) == 2 and s.state()[0]["last_matched"] is True


def test_a_restart_does_not_repeat_a_stored_match(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    s = Setup(client, auth_headers, tmp_path, {}, {})
    s.rule()
    s.run()
    s.run(RuleCheck(client.app))  # type: ignore[arg-type]
    assert len(s.sender.sent) == 1


def test_a_reading_that_is_too_old_sends_nothing(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    s = Setup(client, auth_headers, tmp_path, {"age_minutes": 45})
    s.rule()
    s.run()
    assert s.sender.sent == [] and s.state()[0]["last_result"] == "reading too old"
    assert s.state()[0]["last_matched"] is None


def test_a_missing_engine_status_is_not_evaluated(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    s = Setup(client, auth_headers, tmp_path, {"engine": None})
    s.rule()
    s.run()
    assert s.sender.sent == [] and s.state()[0]["last_result"] == "no reading"


@pytest.mark.parametrize("spelling", ["engine_off", " Engine-Off "])
def test_the_engine_status_spelling_is_normalised(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path, spelling: str
) -> None:
    s = Setup(client, auth_headers, tmp_path, {"engine": spelling})
    s.rule()
    s.run()
    assert len(s.sender.sent) == 1


@pytest.mark.parametrize(
    ("lock", "want"),
    [
        ("0", "Central locking: Unlocked."),
        (None, "Central locking: no reading."),
        ("9", "Central locking: no reading."),
    ],
)
def test_the_text_follows_the_lock(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path, lock: Any, want: str
) -> None:
    s = Setup(client, auth_headers, tmp_path, {"lock": lock})
    s.rule()
    s.run()
    assert [t for t, _ in s.sender.sent] == [want]


def test_location_outside_and_inside(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    s = Setup(client, auth_headers, tmp_path, {}, {"where": INSIDE})
    s.rule(name="out", conditions=[LOC])
    s.rule(name="in", conditions=[{**LOC, "where": "inside"}])
    s.run()
    assert len(s.sender.sent) == 1  # "out" matched, "in" did not
    s.run()
    assert len(s.sender.sent) == 2


def test_the_office_counts_as_inside(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    s = Setup(
        client,
        auth_headers,
        tmp_path,
        {},
        geofence_office_lat=SecretStr("10.06"),
        geofence_office_lon=SecretStr("20.0"),
    )
    s.rule(conditions=[LOC])
    s.run()
    assert s.sender.sent == [] and s.state()[0]["last_result"] == "not matched"


def test_home_not_set_is_not_evaluated(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    s = Setup(client, auth_headers, tmp_path, {}, geofence_home_lat=None, geofence_home_lon=None)
    s.rule(conditions=[LOC])
    s.run()
    assert s.sender.sent == [] and s.state()[0]["last_result"] == "home not set"


def test_the_geofence_does_not_need_to_be_on(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    s = Setup(client, auth_headers, tmp_path, {}, geofence_enabled=False)
    s.rule()
    s.run()
    assert len(s.sender.sent) == 1


def test_with_push_not_set_up_nothing_is_sent_and_it_is_said(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    s = Setup(client, auth_headers, tmp_path, {}, {}, push=False)
    s.rule()
    s.run()
    row = s.state()[0]
    assert row["last_result"] == "push not set up" and row["last_matched"] is None


def test_a_failed_send_is_not_marked_and_retries(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    s = Setup(client, auth_headers, tmp_path, {}, {})
    s.sender.answer = SendResult.FAILED
    s.rule()
    s.run()
    assert s.state()[0]["last_matched"] is None and s.state()[0]["last_sent_at"] is None
    s.sender.answer = SendResult.OK
    s.run()
    assert s.state()[0]["last_matched"] is True and len(s.sender.sent) == 2


def test_no_saved_phone_means_not_sent_and_retry(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    s = Setup(client, auth_headers, tmp_path, {}, {}, phone=False)
    s.rule()
    s.run()
    assert s.state()[0]["last_matched"] is None
    assert client.post(SUBS, json=body(1), headers=auth_headers).status_code == 201
    s.run()
    assert s.state()[0]["last_matched"] is True


def test_no_enabled_rule_takes_no_reading(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    s = Setup(client, auth_headers, tmp_path, {})
    assert s.run() == "no rules"
    s.rule(enabled=False)
    assert s.run() == "no rules" and s.rig.source.calls == 0


def test_many_rules_make_one_reading(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    s = Setup(client, auth_headers, tmp_path, {})
    for n in range(3):
        s.rule(name=f"R{n}")
    s.run()
    assert s.rig.source.calls == 1


def test_it_is_off_without_live_readings(client: TestClient) -> None:
    client.app.state.live_telemetry = None  # type: ignore[attr-defined]
    assert RuleCheck(client.app).run_once(NOW) == "off"  # type: ignore[arg-type]


def test_a_stopped_provider_is_skipped(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    s = Setup(client, auth_headers, tmp_path, {})
    s.rule()
    s.client.app.state.live_telemetry = ZeekrLiveTelemetryProvider(  # type: ignore[attr-defined]
        Source(RuntimeError("x")), clock=Clock(), min_interval_s=300, max_failures=1
    )
    s.client.app.state.live_telemetry.read_odometer()  # type: ignore[attr-defined]
    assert RuleCheck(client.app).run_once(NOW) == "provider stopped"  # type: ignore[arg-type]


def test_one_failing_rule_does_not_stop_the_others(
    client: TestClient,
    auth_headers: dict[str, str],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    s = Setup(client, auth_headers, tmp_path, {})
    s.rule(name="A")
    s.rule(name="B")
    real = RuleCheck._apply
    calls = {"n": 0}

    def flaky(self: RuleCheck, *a: Any, **k: Any) -> bool:
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("https://push.example.test/secret")
        return real(self, *a, **k)

    monkeypatch.setattr(RuleCheck, "_apply", flaky)
    assert s.run() == "2 rules, 1 sent"


def test_logs_and_rows_hold_no_reading_or_place(
    client: TestClient,
    auth_headers: dict[str, str],
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    s = Setup(client, auth_headers, tmp_path, {}, {})
    s.rule(conditions=[VS, ENG, LOC])
    result = s.run()
    s.run()
    assert result == "1 rules, 1 sent"
    with client.app.state.engine.connect() as conn:  # type: ignore[attr-defined]
        row = str(conn.execute(text("SELECT * FROM notification_rules")).one())
    for blob in (caplog.text, row, str(s.state())):
        for word in ("10.06", "20.0", "Locked", "latitude", "longitude", "usage", "gear"):
            assert word not in blob


def test_an_edit_lets_the_rule_send_once_more(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    s = Setup(client, auth_headers, tmp_path, {}, {})
    rid = s.rule()
    s.run()
    r = client.put(
        f"{URL}/{rid}",
        json={"name": "R", "conditions": [VS], "cooldown_minutes": 0},
        headers=auth_headers,
    )
    assert r.status_code == 200
    s.run()
    assert len(s.sender.sent) == 2


# --- provider, sender, loop ---------------------------------------------------------------


def test_the_provider_keeps_the_engine_status_and_clears_it_on_failure() -> None:
    clock = Clock()
    source = Source(car(NOW), RuntimeError("down"))
    p = ZeekrLiveTelemetryProvider(source, clock=clock, min_interval_s=300)
    assert p.engine_status is None
    p.read_odometer()
    assert p.engine_status == "engine-off"
    clock.now += 301
    p.read_odometer()
    assert p.engine_status is None


def test_the_real_sender_uses_the_url_it_is_given(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import json
    import uuid

    seen: dict[str, Any] = {}
    monkeypatch.setattr("pywebpush.webpush", lambda **kw: seen.update(kw) or "ok")
    turn_on(client)
    sender = WebPushSender(client.app.state.settings)  # type: ignore[attr-defined]
    sub = SavedSubscription(uuid.uuid4(), "https://push.example.test/a", "k", "a")
    assert sender.send(sub, "Hi", "/vehicle") == SendResult.OK
    assert json.loads(seen["data"]) == {"body": "Hi", "url": "/vehicle"}
    assert push_module.DEFAULT_URL == "/sentry"


def test_the_interval_follows_the_live_setting(client: TestClient) -> None:
    s = client.app.state  # type: ignore[attr-defined]
    s.settings = s.settings.model_copy(update={"zeekr_live_interval_minutes": 7})
    assert RuleCheck(client.app).interval_seconds == 420.0  # type: ignore[arg-type]


def test_the_loop_survives_a_failed_check(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    job = RuleCheck(client.app)  # type: ignore[arg-type]
    runs = {"n": 0}

    def once() -> str:
        runs["n"] += 1
        if runs["n"] == 1:
            raise RuntimeError("boom")
        return "ok"

    sleeps = {"n": 0}

    async def sleep(_: float) -> None:
        sleeps["n"] += 1
        if sleeps["n"] > 3:
            raise asyncio.CancelledError

    monkeypatch.setattr(job, "run_once", once)
    monkeypatch.setattr(rule_check.asyncio, "sleep", sleep)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(job.loop())
    assert runs["n"] == 3


def test_the_lifespan_starts_only_with_live_readings(client: TestClient) -> None:
    async def go(live: Any) -> None:
        client.app.state.live_telemetry = live  # type: ignore[attr-defined]
        async with rules_lifespan(client.app):  # type: ignore[arg-type]
            pass

    asyncio.run(go(None))
    asyncio.run(go(object()))
