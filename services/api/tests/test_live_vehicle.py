"""ADR-009: the live vehicle card, its stored history and the interval setting. Fake source only."""

from __future__ import annotations

import datetime as dt
import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import text

from app.adapters.zeekr_live import ZeekrLiveTelemetryProvider, ZeekrReadError
from app.config import Settings
from app.services.live_vehicle import months_before
from tests.conftest import make_settings  # noqa: F401
from tests.test_zeekr_live import BASE, CANARY, status

CARD = "/api/v1/live-vehicle"
HISTORY = "/api/v1/live-vehicle/history"


def ms(moment: dt.datetime) -> int:
    return int(moment.timestamp() * 1000)


def recent(minutes_ago: int = 1) -> dt.datetime:
    return (dt.datetime.now(dt.UTC) - dt.timedelta(minutes=minutes_ago)).replace(microsecond=0)


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class Source:
    """A fake status source. `replies` are returned in order; an Exception is raised."""

    def __init__(self, *replies: Any) -> None:
        self.replies = list(replies)
        self.calls = 0

    def __call__(self) -> Any:
        self.calls += 1
        reply = self.replies[min(self.calls, len(self.replies)) - 1]
        if isinstance(reply, Exception):
            raise reply
        return reply


def with_time(moment: dt.datetime, **kw: Any) -> dict[str, Any]:
    body = status(**kw)
    body["additionalVehicleStatus"]["climateStatus"]["updateTime"] = ms(moment)
    return body


@pytest.fixture
def live(client: TestClient) -> Any:
    def install(*replies: Any, **kw: Any) -> tuple[Source, Clock]:
        source, clock = Source(*replies), Clock()
        client.app.state.live_telemetry = ZeekrLiveTelemetryProvider(  # type: ignore[attr-defined]
            source, clock=clock, min_interval_s=300, **kw
        )
        return source, clock

    return install


def count(client: TestClient) -> int:
    with client.app.state.engine.connect() as conn:  # type: ignore[attr-defined]
        return int(conn.execute(text("SELECT count(*) FROM live_reading")).scalar_one())


def test_off_returns_nothing_and_stores_nothing(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    assert client.app.state.live_telemetry is None  # type: ignore[attr-defined]
    body = client.get(CARD, headers=auth_headers).json()
    assert body["status"] == "off"
    assert body["served_from"] is None and body["observed_at"] is None
    assert body["interval_minutes"] == 5
    assert body["readings"]["odometer_km"] is None
    assert all(v is None for v in body["readings"]["tyres_kpa"].values())
    assert count(client) == 0


@pytest.mark.parametrize(
    ("method", "url"),
    [("get", CARD), ("get", HISTORY), ("delete", HISTORY + "?confirm=delete_all")],
)
def test_all_three_need_a_token(client: TestClient, method: str, url: str) -> None:
    response = getattr(client, method)(url)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthenticated"
    assert response.headers["cache-control"] == "no-store"


def test_real_read_is_stored_and_shown(
    client: TestClient, auth_headers: dict[str, str], live: Any
) -> None:
    moment = recent()
    source, _ = live(with_time(moment))
    body = client.get(CARD, headers=auth_headers).json()
    assert body["status"] == "ok" and body["served_from"] == "zeekr"
    assert body["observed_at"] == moment.isoformat().replace("+00:00", "Z")
    r = body["readings"]
    assert r["odometer_km"] == 4321 and r["battery_percent"] == 64.0 and r["range_km"] == 349
    assert r["plugged_in"] is True and r["charging"] is False
    assert r["tyres_kpa"] == {
        "driver_front": 236,
        "passenger_front": 240,
        "driver_rear": 238,
        "passenger_rear": 233,
    }
    assert r["service_distance_km"] == 35000 and r["service_days"] == 200
    assert source.calls == 1 and count(client) == 1


def test_a_call_inside_the_window_is_served_from_cache_and_stores_nothing(
    client: TestClient, auth_headers: dict[str, str], live: Any
) -> None:
    source, clock = live(with_time(recent()))
    client.get(CARD, headers=auth_headers)
    clock.now += 299
    again = client.get(CARD, headers=auth_headers).json()
    assert again["served_from"] == "cache" and again["status"] == "ok"
    assert again["readings"]["odometer_km"] == 4321
    assert source.calls == 1 and count(client) == 1


def test_a_repeat_of_the_same_car_time_is_not_stored_again(
    client: TestClient, auth_headers: dict[str, str], live: Any
) -> None:
    moment = recent()
    source, clock = live(with_time(moment), with_time(moment))
    client.get(CARD, headers=auth_headers)
    clock.now += 301
    second = client.get(CARD, headers=auth_headers).json()
    assert source.calls == 2 and second["served_from"] == "zeekr"
    assert count(client) == 1


def test_a_newer_car_time_is_a_second_row_and_history_is_newest_first(
    client: TestClient, auth_headers: dict[str, str], live: Any
) -> None:
    t1, t2 = recent(10), recent(2)
    newer = with_time(t2)
    newer["additionalVehicleStatus"]["maintenanceStatus"]["odometer"] = 4330
    _, clock = live(with_time(t1), newer)
    client.get(CARD, headers=auth_headers)
    clock.now += 301
    client.get(CARD, headers=auth_headers)
    body = client.get(HISTORY, headers=auth_headers).json()
    assert [i["odometer_km"] for i in body["items"]] == [4330, 4321]
    assert body["interval_minutes"] == 5 and body["retention_months"] == 12
    since = client.get(HISTORY, params={"since": t2.isoformat()}, headers=auth_headers).json()
    assert [i["odometer_km"] for i in since["items"]] == [4330]


def test_a_reading_with_every_field_empty_or_no_car_time_is_not_stored(
    client: TestClient, auth_headers: dict[str, str], live: Any
) -> None:
    live({"additionalVehicleStatus": {"climateStatus": {"updateTime": ms(recent())}}})
    body = client.get(CARD, headers=auth_headers).json()
    assert body["status"] == "ok" and body["observed_at"] is None
    assert count(client) == 0
    no_time = with_time(recent())
    del no_time["additionalVehicleStatus"]["climateStatus"]
    live(no_time)
    client.get(CARD, headers=auth_headers)
    assert count(client) == 0


def test_a_failure_shows_the_last_stored_reading_and_then_pauses(
    client: TestClient, auth_headers: dict[str, str], live: Any
) -> None:
    fail = ZeekrReadError(f"{CANARY} text from the server")
    source, clock = live(with_time(recent()), fail, fail, fail, fail, fail, max_failures=2)
    assert client.get(CARD, headers=auth_headers).json()["status"] == "ok"
    clock.now += 301
    first = client.get(CARD, headers=auth_headers).json()
    assert first["status"] == "unavailable"
    assert first["readings"]["odometer_km"] == 4321 and first["observed_at"] is not None
    clock.now += 100_000
    paused = client.get(CARD, headers=auth_headers).json()
    assert paused["status"] == "paused" and paused["readings"]["odometer_km"] == 4321
    calls = source.calls
    clock.now += 100_000
    client.get(CARD, headers=auth_headers)
    assert source.calls == calls
    assert CANARY not in json.dumps(paused)
    assert count(client) == 1


def test_nothing_private_reaches_the_response_or_the_table(
    client: TestClient, auth_headers: dict[str, str], live: Any
) -> None:
    live(with_time(recent()))
    card = client.get(CARD, headers=auth_headers).text
    history = client.get(HISTORY, headers=auth_headers).text
    with client.app.state.engine.connect() as conn:  # type: ignore[attr-defined]
        dump = json.dumps(
            [list(map(str, r)) for r in conn.execute(text("SELECT * FROM live_reading"))]
        )
        columns = {
            r[0]
            for r in conn.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = 'live_reading'"
                )
            )
        }
    for blob in (card, history, dump):
        assert CANARY not in blob
    banned = ("vin", "plate", "nick", "lock", "door", "lat", "lon", "position", "raw")
    assert not [c for c in columns if any(b in c for b in banned)]
    assert not [w for w in banned if f'"{w}' in card.lower()]


def test_rows_older_than_twelve_months_are_deleted_when_one_is_stored(
    client: TestClient, auth_headers: dict[str, str], live: Any
) -> None:
    now = dt.datetime.now(dt.UTC)
    old = months_before(now, 12) - dt.timedelta(days=1)
    keep = months_before(now, 12) + dt.timedelta(days=1)
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        for n, when in enumerate((old, keep)):
            conn.execute(
                text(
                    "INSERT INTO live_reading (id, observed_at, received_at, odometer_km) "
                    "VALUES (gen_random_uuid(), :t, :t, :km)"
                ),
                {"t": when, "km": 100 + n},
            )
    assert count(client) == 2
    live(with_time(recent()))
    client.get(CARD, headers=auth_headers)
    kms = [i["odometer_km"] for i in client.get(HISTORY, headers=auth_headers).json()["items"]]
    assert sorted(kms) == [101, 4321]


def test_months_before_clamps_the_day() -> None:
    assert months_before(dt.datetime(2026, 3, 31, tzinfo=dt.UTC), 1) == dt.datetime(
        2026, 2, 28, tzinfo=dt.UTC
    )
    assert months_before(dt.datetime(2026, 10, 31, tzinfo=dt.UTC), 12) == dt.datetime(
        2025, 10, 31, tzinfo=dt.UTC
    )
    assert months_before(dt.datetime(2026, 1, 15, tzinfo=dt.UTC), 12) == dt.datetime(
        2025, 1, 15, tzinfo=dt.UTC
    )


def test_delete_all_needs_confirmation_and_returns_the_count(
    client: TestClient, auth_headers: dict[str, str], live: Any
) -> None:
    live(with_time(recent()))
    client.get(CARD, headers=auth_headers)
    for url in (HISTORY, HISTORY + "?confirm=yes", HISTORY + "?confirm="):
        r = client.delete(url, headers=auth_headers)
        assert r.status_code == 400 and r.json()["error"]["code"] == "validation_error"
    assert count(client) == 1
    done = client.delete(HISTORY + "?confirm=delete_all", headers=auth_headers)
    assert done.status_code == 200 and done.json() == {"deleted": 1}
    assert count(client) == 0
    assert client.delete(HISTORY + "?confirm=delete_all", headers=auth_headers).json() == {
        "deleted": 0
    }


@pytest.mark.parametrize("limit", ["0", "1001", "abc", "1.0", "-1", ""])
def test_history_limit_is_validated(
    client: TestClient, auth_headers: dict[str, str], limit: str
) -> None:
    r = client.get(HISTORY, params={"limit": limit}, headers=auth_headers)
    assert r.status_code == 400 and r.json()["error"]["code"] == "validation_error"


def test_history_bad_since_is_a_400_and_limit_bounds_work(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    assert (
        client.get(HISTORY, params={"since": "yesterday"}, headers=auth_headers).status_code == 400
    )
    assert client.get(HISTORY, params={"limit": "1000"}, headers=auth_headers).status_code == 200
    assert client.get(HISTORY, params={"limit": "1"}, headers=auth_headers).status_code == 200


def test_the_card_and_history_take_no_writes(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    for method in ("post", "put", "patch"):
        r = getattr(client, method)(CARD, json={}, headers=auth_headers)
        assert r.status_code == 405
        r = getattr(client, method)(HISTORY, json={}, headers=auth_headers)
        assert r.status_code == 405


def test_concurrent_pages_cause_one_read(
    client: TestClient, auth_headers: dict[str, str], live: Any
) -> None:
    from concurrent.futures import ThreadPoolExecutor

    source, _ = live(with_time(recent()))
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda _: client.get(CARD, headers=auth_headers), range(6)))
    assert all(r.status_code == 200 for r in results)
    assert source.calls == 1 and count(client) == 1


# --- the interval setting ---


def settings_with(**kw: Any) -> Settings:
    return Settings(_env_file=None, **BASE, **kw)  # type: ignore[arg-type]


def test_interval_defaults_to_five_and_below_five_refuses_to_start() -> None:
    assert settings_with().zeekr_live_interval_minutes == 5
    assert settings_with(zeekr_live_interval_minutes=15).zeekr_live_interval_minutes == 15
    for bad in (4, 0, -1):
        with pytest.raises(ValidationError):
            settings_with(zeekr_live_interval_minutes=bad)


def test_the_interval_sets_the_provider_spacing_and_is_reported(
    database_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.adapters import zeekr_live
    from app.adapters.zeekr_live import build_live_provider
    from tests.test_zeekr_live import live_settings

    monkeypatch.setattr(zeekr_live, "_build_client", lambda s: None)
    provider = build_live_provider(live_settings(zeekr_live_interval_minutes=20))
    assert provider is not None
    assert provider._min_interval == 20 * 60


# --- fixes from the QA and security reviews (2026-10-31) ---


def test_mapper_limits_sit_inside_the_table_checks() -> None:
    from app.adapters.zeekr_live import map_status
    from app.live_limits import ODOMETER_KM, SERVICE_DAYS, SERVICE_DISTANCE_KM

    def mapped(**kw: Any) -> Any:
        return map_status(status(**kw))

    def maint(**kw: Any) -> dict[str, Any]:
        body = status()
        body["additionalVehicleStatus"]["maintenanceStatus"].update(kw)
        return body

    assert map_status(maint(odometer=ODOMETER_KM[1])).odometer_km == ODOMETER_KM[1]
    assert map_status(maint(odometer=ODOMETER_KM[1] + 1)).odometer_km is None
    assert map_status(maint(odometer=3_000_000_000)).odometer_km is None
    assert map_status(maint(daysToService=SERVICE_DAYS[1] + 1)).days_to_service is None
    assert map_status(maint(daysToService=SERVICE_DAYS[0] - 1)).days_to_service is None
    assert (
        map_status(maint(distanceToService=SERVICE_DISTANCE_KM[1] + 1)).distance_to_service_km
        is None
    )
    assert mapped() is not None


def test_overdue_service_is_kept_as_a_negative_number() -> None:
    from app.adapters.zeekr_live import map_status

    body = status()
    body["additionalVehicleStatus"]["maintenanceStatus"].update(
        daysToService=-5, distanceToService=-120
    )
    snap = map_status(body)
    assert snap.days_to_service == -5 and snap.distance_to_service_km == -120


def test_an_odd_value_from_the_car_no_longer_breaks_the_card(
    client: TestClient, auth_headers: dict[str, str], live: Any
) -> None:
    body = with_time(recent())
    body["additionalVehicleStatus"]["maintenanceStatus"]["odometer"] = 20_000_000
    body["additionalVehicleStatus"]["maintenanceStatus"]["distanceToService"] = 200_000
    live(body)
    r = client.get(CARD, headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "ok" and r.json()["readings"]["odometer_km"] is None
    assert r.json()["readings"]["battery_percent"] == 64.0


def test_a_storage_error_is_unavailable_not_a_500(
    client: TestClient, auth_headers: dict[str, str], live: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    from sqlalchemy.exc import OperationalError

    from app.repositories.live_readings import LiveReadingRepository

    def boom(self: Any, values: Any, keep_after: Any) -> bool:
        raise OperationalError("insert", {}, Exception(CANARY))

    monkeypatch.setattr(LiveReadingRepository, "store", boom)
    live(with_time(recent()))
    r = client.get(CARD, headers=auth_headers)
    assert r.status_code == 200 and r.json()["status"] == "unavailable"
    assert CANARY not in r.text and count(client) == 0


def test_a_car_time_in_the_future_is_not_stored(
    client: TestClient, auth_headers: dict[str, str], live: Any
) -> None:
    live(with_time(dt.datetime.now(dt.UTC) + dt.timedelta(days=400)))
    body = client.get(CARD, headers=auth_headers).json()
    assert body["status"] == "ok" and body["observed_at"] is None
    assert count(client) == 0
    live(with_time(dt.datetime.now(dt.UTC) + dt.timedelta(minutes=2)))
    client.get(CARD, headers=auth_headers)
    assert count(client) == 1


def test_a_card_request_does_not_wait_forever_for_a_slow_read(
    client: TestClient, auth_headers: dict[str, str], live: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    import threading

    from app.services import live_vehicle

    monkeypatch.setattr(live_vehicle, "LOCK_WAIT_S", 0.2)
    live(with_time(recent()))
    lock: threading.Lock = client.app.state.live_lock  # type: ignore[attr-defined]
    lock.acquire()
    try:
        r = client.get(CARD, headers=auth_headers)
        assert r.status_code == 200 and r.json()["served_from"] == "cache"
        # delete does not wait behind a read either
        assert (
            client.delete(HISTORY + "?confirm=delete_all", headers=auth_headers).status_code == 200
        )
    finally:
        lock.release()


def test_history_prunes_rows_older_than_twelve_months(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    old = months_before(dt.datetime.now(dt.UTC), 12) - dt.timedelta(days=1)
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(
            text(
                "INSERT INTO live_reading (id, observed_at, received_at, odometer_km) "
                "VALUES (gen_random_uuid(), :t, :t, 1)"
            ),
            {"t": old},
        )
    assert client.get(HISTORY, headers=auth_headers).json()["items"] == []
    assert count(client) == 0


@pytest.mark.parametrize("since", ["9999-12-31T23:59:59-05:00", "0001-01-01T00:00:00+05:00"])
def test_an_extreme_since_is_a_400(
    client: TestClient, auth_headers: dict[str, str], since: str
) -> None:
    r = client.get(HISTORY, params={"since": since}, headers=auth_headers)
    assert r.status_code == 400 and r.json()["error"]["code"] == "validation_error"


def test_backoff_is_never_shorter_than_the_interval() -> None:
    clock = Clock()
    source = Source(ZeekrReadError("x"), ZeekrReadError("x"))
    provider = ZeekrLiveTelemetryProvider(
        source, clock=clock, min_interval_s=120 * 60, max_backoff_s=3600
    )
    provider.read_odometer()
    clock.now += 119 * 60
    provider.read_odometer()
    assert source.calls == 1
    clock.now += 2 * 60
    provider.read_odometer()
    assert source.calls == 2


def test_the_module_calls_only_the_three_read_only_library_methods() -> None:
    import ast
    import inspect

    from app.adapters import zeekr_live

    tree = ast.parse(inspect.getsource(zeekr_live))
    allowed = {"login", "get_vehicle_list", "get_status"}
    called = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            owner = node.func.value
            names = {n.id for n in ast.walk(owner) if isinstance(n, ast.Name)}
            attrs = {n.attr for n in ast.walk(owner) if isinstance(n, ast.Attribute)}
            if names & {"client", "vehicles"} or "_client" in attrs:
                called.add(node.func.attr)
            if isinstance(owner, ast.Subscript) and "vehicles" in names:
                called.add(node.func.attr)
    assert called <= allowed, called
    assert allowed <= called, called


def test_cache_headers_are_no_store_on_success_too(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    for r in (
        client.get(CARD, headers=auth_headers),
        client.get(HISTORY, headers=auth_headers),
        client.delete(HISTORY + "?confirm=delete_all", headers=auth_headers),
    ):
        assert r.status_code == 200 and r.headers["cache-control"] == "no-store"


def test_every_value_the_mapper_keeps_fits_the_table(client: TestClient) -> None:
    """Every bound is inserted into the real table, so its CHECK constraints judge them."""
    from app import live_limits as lim

    def row(**kw: Any) -> dict[str, Any]:
        return kw

    cases = [
        row(odometer_km=lim.ODOMETER_KM[0]),
        row(odometer_km=lim.ODOMETER_KM[1]),
        row(battery_percent=lim.BATTERY_PERCENT[0]),
        row(battery_percent=lim.BATTERY_PERCENT[1]),
        row(range_km=lim.RANGE_KM[0]),
        row(range_km=lim.RANGE_KM[1]),
        row(service_days=lim.SERVICE_DAYS[0]),
        row(service_days=lim.SERVICE_DAYS[1]),
        row(service_distance_km=lim.SERVICE_DISTANCE_KM[0]),
        row(service_distance_km=lim.SERVICE_DISTANCE_KM[1]),
        *(
            row(**{col: v})
            for col in (
                "tyre_driver_front_kpa",
                "tyre_passenger_front_kpa",
                "tyre_driver_rear_kpa",
                "tyre_passenger_rear_kpa",
            )
            for v in lim.TYRE_KPA
        ),
    ]
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        for n, values in enumerate(cases):
            cols = ", ".join(values)
            params = ", ".join(f":{c}" for c in values)
            conn.execute(
                text(
                    f"INSERT INTO live_reading (id, observed_at, received_at, {cols}) "  # noqa: S608
                    "VALUES (gen_random_uuid(), now() - make_interval(secs => :n), now(), "
                    f"{params})"
                ),
                {"n": n, **values},
            )
    assert count(client) == len(cases)
