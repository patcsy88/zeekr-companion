"""Daily odometer read before a service (approved 2026-11-03). Fake source only."""

from __future__ import annotations

import asyncio
import contextlib
import datetime as dt
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.adapters.zeekr_live import ZeekrLiveTelemetryProvider, ZeekrReadError
from app.clock import KUALA_LUMPUR
from app.services.daily_read import DailyOdometerRead, daily_read_lifespan, in_window
from tests.conftest import new_id
from tests.test_live_vehicle import Clock, Source, with_time

URL = "/api/v1/reminders"
NOW = dt.datetime(2026, 11, 3, 1, 0, tzinfo=dt.UTC)  # 09:00 in Kuala Lumpur


def kl(hour: int, minute: int = 0, day: int = 3) -> dt.datetime:
    return dt.datetime(2026, 11, day, hour, minute, tzinfo=KUALA_LUMPUR).astimezone(dt.UTC)


def add_reminder(client: TestClient, headers: dict[str, str], **kw: Any) -> str:
    b: dict[str, Any] = {
        "id": new_id(),
        "kind": "service",
        "title": "Service",
        "due_date": "2026-12-01",
        "due_odometer": 40000,
        "notes": None,
        "template_ref": None,
    }
    b.update(kw)
    assert client.post(URL, json=b, headers=headers).status_code == 201
    return str(b["id"])


def install(client: TestClient, *replies: Any) -> Source:
    source = Source(*replies)
    client.app.state.live_telemetry = ZeekrLiveTelemetryProvider(  # type: ignore[attr-defined]
        source, clock=Clock(), min_interval_s=300
    )
    return source


def job(client: TestClient) -> DailyOdometerRead:
    return DailyOdometerRead(client.app)  # type: ignore[arg-type]


def stored(client: TestClient) -> int:
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        return int(conn.execute(text("SELECT count(*) FROM live_reading")).scalar_one())


def fresh(at: dt.datetime) -> dict[str, Any]:
    return with_time(at - dt.timedelta(minutes=1))


def test_window_rule() -> None:
    d = dt.date(2026, 12, 1)
    assert not in_window([d], dt.date(2026, 10, 31))
    assert in_window([d], dt.date(2026, 11, 1))
    assert in_window([d], dt.date(2026, 12, 20))
    assert not in_window([], dt.date(2026, 12, 1))


def test_reads_once_inside_the_window(client: TestClient, auth_headers: dict[str, str]) -> None:
    add_reminder(client, auth_headers)
    source = install(client, fresh(NOW))
    j = job(client)
    assert j.run_once(NOW) == "read"
    assert source.calls == 1 and stored(client) == 1
    assert j.run_once(NOW + dt.timedelta(hours=3)) == "already tried today"
    assert source.calls == 1


def test_reads_again_the_next_day(client: TestClient, auth_headers: dict[str, str]) -> None:
    add_reminder(client, auth_headers)
    source = install(client, fresh(NOW), fresh(NOW + dt.timedelta(days=1)))
    j = job(client)
    j.run_once(NOW)
    source.calls = source.calls  # the provider spaces reads by its own clock
    client.app.state.live_telemetry._clock = lambda: 10_000.0  # type: ignore[attr-defined]
    assert j.run_once(NOW + dt.timedelta(days=1)) == "read"
    assert source.calls == 2


def test_does_not_read_before_0800_kl(client: TestClient, auth_headers: dict[str, str]) -> None:
    add_reminder(client, auth_headers)
    source = install(client, fresh(kl(7, 59)))
    assert job(client).run_once(kl(7, 59)) == "too early"
    assert source.calls == 0
    assert job(client).run_once(kl(8, 0)) == "read"


def test_does_not_read_outside_the_window(client: TestClient, auth_headers: dict[str, str]) -> None:
    add_reminder(client, auth_headers, due_date="2027-10-07")
    source = install(client, fresh(NOW))
    assert job(client).run_once(NOW) == "no service due soon"
    assert source.calls == 0 and stored(client) == 0


def test_keeps_reading_after_the_due_date_until_completed(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    rid = add_reminder(client, auth_headers, due_date="2026-10-01")
    source = install(client, fresh(NOW))
    assert job(client).run_once(NOW) == "read"
    assert source.calls == 1
    client.patch(f"{URL}/{rid}", json={"completed_on": "2026-11-03"}, headers=auth_headers)
    assert job(client).run_once(NOW + dt.timedelta(days=1)) == "no service due soon"
    assert source.calls == 1


def test_only_open_service_reminders_with_a_date_count(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    add_reminder(
        client, auth_headers, kind="insurance_renewal", due_odometer=None, due_date="2026-11-10"
    )
    add_reminder(client, auth_headers, due_date=None, due_odometer=50000)
    source = install(client, fresh(NOW))
    assert job(client).run_once(NOW) == "no service due soon"
    assert source.calls == 0


def test_a_reading_already_stored_today_counts(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    add_reminder(client, auth_headers)
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(
            text(
                "INSERT INTO live_reading (id, observed_at, received_at, odometer_km) "
                "VALUES (gen_random_uuid(), :t, :t, 100)"
            ),
            {"t": NOW - dt.timedelta(minutes=30)},
        )
    source = install(client, fresh(NOW))
    assert job(client).run_once(NOW) == "already read today"
    assert source.calls == 0


def test_stopped_provider_is_left_alone(client: TestClient, auth_headers: dict[str, str]) -> None:
    add_reminder(client, auth_headers)
    source = install(client, ZeekrReadError("down"))
    provider = client.app.state.live_telemetry  # type: ignore[attr-defined]
    for _ in range(6):
        provider._clock = lambda n=_: 100_000.0 * (n + 1)
        with contextlib.suppress(Exception):
            provider.read_odometer()
    assert provider.stopped
    calls = source.calls
    assert job(client).run_once(NOW) == "provider stopped"
    assert source.calls == calls


def test_one_attempt_per_day_even_if_it_fails(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    add_reminder(client, auth_headers)
    source = install(client, ZeekrReadError("down"))
    j = job(client)
    assert j.run_once(NOW) == "read"
    assert j.run_once(NOW + dt.timedelta(hours=2)) == "already tried today"
    assert source.calls == 1


def test_off_makes_no_call_and_starts_no_task(client: TestClient) -> None:
    app: FastAPI = client.app  # type: ignore[assignment]
    app.state.live_telemetry = None
    assert DailyOdometerRead(app).run_once(NOW) == "off"

    async def started() -> bool:
        async with daily_read_lifespan(app):
            return any(
                "DailyOdometerRead" in repr(t.get_coro())
                or "loop" in getattr(t.get_coro(), "__qualname__", "")
                for t in asyncio.all_tasks()
            )

    assert asyncio.run(started()) is False


def test_nothing_in_the_reading_reaches_the_log(
    client: TestClient, auth_headers: dict[str, str], caplog: Any
) -> None:
    add_reminder(client, auth_headers)
    install(client, ZeekrReadError("secret-canary-value"))
    job(client).run_once(NOW)
    assert "secret-canary-value" not in caplog.text
