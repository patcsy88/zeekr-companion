"""ADR-009: the live Zeekr provider. No network: the client is a fake with canary values."""

from __future__ import annotations

import datetime as dt
import inspect
import logging
from typing import Any

import pytest

from app.adapters import zeekr_live
from app.adapters.telemetry import TyrePressures, VehicleTelemetryProvider
from app.adapters.zeekr_live import (
    ZeekrLiveTelemetryProvider,
    ZeekrReadError,
    ZeekrSettings,
    ZeekrStatusSource,
    map_status,
)

CANARY = "CANARY-VALUE-7c1e"
UPDATE_MS = 1_700_000_000_000


def status(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "additionalVehicleStatus": {
            "maintenanceStatus": {
                "odometer": 4321,
                "daysToService": 200,
                "distanceToService": 35000,
                "tyreStatusDriver": "236",
                "tyreStatusPassenger": "240",
                "tyreStatusDriverRear": "238",
                "tyreStatusPassengerRear": "233",
                "mainBatteryStatus": {"stateOfHealth": "0"},
            },
            "electricVehicleStatus": {
                "chargeLevel": "64.0",
                "stateOfCharge": "",
                "distanceToEmptyOnBatteryOnly": "349",
                "isCharging": False,
                "isPluggedIn": True,
            },
            "climateStatus": {"updateTime": UPDATE_MS},
            "drivingSafetyStatus": {"centralLockingStatus": CANARY},
        },
        "basicVehicleStatus": {
            "distanceToEmpty": "0",
            "position": {"latitude": CANARY, "longitude": CANARY},
        },
        "vin": CANARY,
        "plateNo": CANARY,
    }
    body.update(overrides)
    return body


def test_map_keeps_the_allow_listed_fields() -> None:
    snap = map_status(status())
    assert snap.odometer_km == 4321
    assert snap.battery_percent == 64.0
    assert snap.range_km == 349
    assert snap.days_to_service == 200
    assert snap.distance_to_service_km == 35000
    assert snap.tyres_kpa == TyrePressures(236, 240, 238, 233)
    assert snap.is_charging is False
    assert snap.is_plugged_in is True
    assert snap.observed_at == dt.datetime.fromtimestamp(UPDATE_MS / 1000, tz=dt.UTC)


def test_snapshot_holds_nothing_from_dropped_fields() -> None:
    assert CANARY not in repr(map_status(status()))
    assert {f for f in zeekr_live.Snapshot.__dataclass_fields__} == {
        "observed_at",
        "odometer_km",
        "battery_percent",
        "range_km",
        "days_to_service",
        "distance_to_service_km",
        "tyres_kpa",
        "is_charging",
        "is_plugged_in",
    }


@pytest.mark.parametrize("bad", ["", "  ", "abc", None, True, [], {}, "1e999", "nan"])
def test_unusable_values_become_no_reading(bad: object) -> None:
    body = status()
    body["additionalVehicleStatus"]["maintenanceStatus"]["odometer"] = bad
    body["additionalVehicleStatus"]["electricVehicleStatus"]["chargeLevel"] = bad
    snap = map_status(body)
    assert snap.odometer_km is None
    assert snap.battery_percent is None


def test_out_of_range_values_become_no_reading() -> None:
    body = status()
    ev = body["additionalVehicleStatus"]["electricVehicleStatus"]
    ev["chargeLevel"] = "140"
    ev["distanceToEmptyOnBatteryOnly"] = "0"
    body["additionalVehicleStatus"]["maintenanceStatus"]["tyreStatusDriver"] = "9"
    snap = map_status(body)
    assert snap.battery_percent is None
    assert snap.range_km is None
    assert snap.tyres_kpa is None


def test_missing_groups_and_wrong_shapes_give_empty_snapshot() -> None:
    for body in ({}, None, [], "x", {"additionalVehicleStatus": "x"}):
        snap = map_status(body)
        assert snap.odometer_km is None and snap.tyres_kpa is None and snap.observed_at is None


def test_non_boolean_flags_are_not_trusted() -> None:
    body = status()
    body["additionalVehicleStatus"]["electricVehicleStatus"]["isCharging"] = "true"
    assert map_status(body).is_charging is None


class FakeVehicle:
    def __init__(self, body: Any) -> None:
        self.body = body
        self.calls: list[str] = []

    def get_status(self) -> Any:
        self.calls.append("get_status")
        if isinstance(self.body, Exception):
            raise self.body
        return self.body


class FakeClient:
    def __init__(self, body: Any = None, vehicles: int = 1, fail_login: bool = False) -> None:
        self.vehicle = FakeVehicle(status() if body is None else body)
        self.vehicle_count = vehicles
        self.fail_login = fail_login
        self.logins = 0

    def login(self) -> None:
        self.logins += 1
        if self.fail_login:
            raise RuntimeError(f"Login failed: token {CANARY}")

    def get_vehicle_list(self) -> list[FakeVehicle]:
        return [self.vehicle] * self.vehicle_count


def settings() -> ZeekrSettings:
    return ZeekrSettings(*[f"{CANARY}-{i}" for i in range(9)])


def test_source_logs_in_once_and_reuses_the_client() -> None:
    client = FakeClient()
    source = ZeekrStatusSource(settings(), lambda _: client)
    source()
    source()
    assert client.logins == 1
    assert client.vehicle.calls == ["get_status", "get_status"]


def test_source_failure_message_is_fixed_and_hides_the_cause() -> None:
    source = ZeekrStatusSource(settings(), lambda _: FakeClient(fail_login=True))
    with pytest.raises(ZeekrReadError) as caught:
        source()
    assert CANARY not in str(caught.value) and CANARY not in repr(caught.value)
    assert caught.value.__cause__ is None and caught.value.__suppress_context__


def test_source_read_failure_hides_text_and_forces_a_new_login() -> None:
    clients: list[FakeClient] = []

    def factory(_: ZeekrSettings) -> FakeClient:
        clients.append(FakeClient(RuntimeError(f"secret {CANARY}")))
        return clients[-1]

    source = ZeekrStatusSource(settings(), factory)
    for _ in range(2):
        with pytest.raises(ZeekrReadError) as caught:
            source()
        assert CANARY not in str(caught.value)
    assert len(clients) == 2


def test_source_no_vehicle_and_wrong_shape() -> None:
    with pytest.raises(ZeekrReadError, match="no vehicle"):
        ZeekrStatusSource(settings(), lambda _: FakeClient(vehicles=0))()
    with pytest.raises(ZeekrReadError, match="not an object"):
        ZeekrStatusSource(settings(), lambda _: FakeClient(body=["x"]))()


def test_source_calls_only_the_three_read_methods() -> None:
    class Strict(FakeClient):
        def __getattr__(self, name: str) -> Any:
            raise AssertionError(f"unexpected library call: {name}")

    ZeekrStatusSource(settings(), lambda _: Strict())()


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def provider(source: Any, clock: Clock, **kw: Any) -> ZeekrLiveTelemetryProvider:
    return ZeekrLiveTelemetryProvider(source, clock=clock, **kw)


def test_one_snapshot_serves_every_read_and_is_cached_between_calls() -> None:
    calls: list[int] = []

    def source() -> dict[str, Any]:
        calls.append(1)
        return status()

    clock = Clock()
    live = provider(source, clock, min_interval_s=300)
    assert live.read_odometer().value == 4321
    assert live.read_battery_percent().value == 64.0
    assert live.read_tyre_pressures_kpa().value == TyrePressures(236, 240, 238, 233)
    assert len(calls) == 1
    clock.now += 301
    live.read_range_km()
    assert len(calls) == 2


def test_reading_carries_source_and_observed_at() -> None:
    reading = provider(status, Clock()).read_odometer()
    assert reading.source == "zeekr_live"
    assert reading.observed_at == dt.datetime.fromtimestamp(UPDATE_MS / 1000, tz=dt.UTC)
    assert reading.observed_at is not None and reading.observed_at.utcoffset() == dt.timedelta(0)


def test_missing_value_has_no_observed_at() -> None:
    body = status()
    body["additionalVehicleStatus"]["maintenanceStatus"]["odometer"] = ""
    reading = provider(lambda: body, Clock()).read_odometer()
    assert reading.value is None and reading.observed_at is None


def test_failure_gives_no_reading_backs_off_and_then_stops(
    caplog: pytest.LogCaptureFixture,
) -> None:
    calls: list[int] = []

    def source() -> dict[str, Any]:
        calls.append(1)
        raise ZeekrReadError(f"x {CANARY}")

    clock = Clock()
    live = provider(source, clock, min_interval_s=10, max_backoff_s=100, max_failures=3)
    caplog.set_level(logging.DEBUG)
    assert live.read_odometer().value is None
    live.read_odometer()
    assert len(calls) == 1  # inside the back-off, no new call
    for _ in range(5):
        clock.now += 1000
        live.read_odometer()
    assert len(calls) == 3 and live.stopped
    clock.now += 100000
    live.read_odometer()
    assert len(calls) == 3  # stopped: no more calls
    assert CANARY not in caplog.text
    assert all(r.levelno >= logging.WARNING for r in caplog.records)


def test_success_after_failure_resets_the_count() -> None:
    outcomes: list[Any] = [ZeekrReadError("x"), status()]

    def source() -> dict[str, Any]:
        item = outcomes.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    clock = Clock()
    live = provider(source, clock, min_interval_s=10, max_failures=2)
    live.read_odometer()
    clock.now += 1000
    assert live.read_odometer().value == 4321
    assert not live.stopped


def _public(cls: type) -> list[str]:
    return [n for n, _ in inspect.getmembers(cls, inspect.isfunction) if not n.startswith("_")]


def test_live_provider_only_has_read_methods_and_fits_the_port() -> None:
    assert all(n.startswith("read_") for n in _public(ZeekrLiveTelemetryProvider))
    assert set(_public(VehicleTelemetryProvider)) == set(_public(ZeekrLiveTelemetryProvider))


def test_module_names_no_write_or_control_call() -> None:
    source = inspect.getsource(zeekr_live)
    for banned in (
        "do_remote_control",
        "set_charge_plan",
        "set_travel_plan",
        "export_session",
        "load_session",
        "get_gps",
        "trackpoint",
    ):
        assert banned not in source


def test_module_does_not_log_settings_or_responses() -> None:
    source = inspect.getsource(zeekr_live)
    assert "log.debug" not in source and "log.info" not in source
    assert "password" not in source.split("log.warning")[1].split("\n")[0]


# --- settings and wiring (ADR-009) ---

from pydantic import SecretStr, ValidationError  # noqa: E402

from app.adapters.zeekr_live import build_live_provider  # noqa: E402
from app.config import ZEEKR_LIVE_FIELDS, Settings  # noqa: E402

BASE = {
    "database_url": "postgresql://user:pw@localhost/db",
    "token_secret": "-".join(
        ["fake", "test", "only", "not", "a", "real", "secret", "value", "xyz"]
    ),
}


def live_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {name: f"{CANARY}-{name}" for name in ZEEKR_LIVE_FIELDS}
    values["zeekr_live_enabled"] = True
    values["zeekr_country_code"] = "MY"
    values.update(overrides)
    return Settings(_env_file=None, **BASE, **values)  # type: ignore[arg-type]


def test_off_by_default_and_builds_nothing() -> None:
    settings = Settings(_env_file=None, **BASE)  # type: ignore[arg-type]
    assert settings.zeekr_live_enabled is False
    assert build_live_provider(settings) is None


def test_enabled_without_every_setting_refuses_to_start() -> None:
    with pytest.raises(ValidationError) as caught:
        live_settings(zeekr_prod_secret=None, zeekr_vin_iv="  ")
    text = str(caught.value)
    assert "ZEEKR_PROD_SECRET" in text and "ZEEKR_VIN_IV" in text
    assert CANARY not in text


def test_empty_strings_count_as_unset() -> None:
    settings = Settings(_env_file=None, **BASE, zeekr_username="", zeekr_country_code=" ")  # type: ignore[arg-type]
    assert settings.zeekr_username is None and settings.zeekr_country_code is None


def test_secrets_are_hidden_in_repr() -> None:
    settings = live_settings()
    assert CANARY not in repr(settings) and CANARY not in str(settings)
    assert isinstance(settings.zeekr_password, SecretStr)


def test_enabled_builds_a_provider_without_any_network_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def forbidden(*_: Any, **__: Any) -> Any:
        raise AssertionError("the library must not be built while constructing the provider")

    monkeypatch.setattr(zeekr_live, "_build_client", forbidden)
    provider = build_live_provider(live_settings())
    assert isinstance(provider, ZeekrLiveTelemetryProvider)
    assert not provider.stopped


def test_provider_passes_the_settings_to_the_library_once_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[ZeekrSettings] = []

    def fake_build(s: ZeekrSettings) -> FakeClient:
        seen.append(s)
        return FakeClient()

    monkeypatch.setattr(zeekr_live, "_build_client", fake_build)
    provider = build_live_provider(live_settings())
    assert provider is not None
    assert seen == []
    assert provider.read_odometer().value == 4321
    assert seen[0].username == f"{CANARY}-zeekr_username"
    assert seen[0].prod_secret == f"{CANARY}-zeekr_prod_secret"
