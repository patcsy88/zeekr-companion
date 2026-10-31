"""Live Zeekr telemetry, read-only (ADR-009). Off unless the app builds it; nothing does yet.

Three parts, kept apart:
- `map_status` keeps a short allow-list of fields from one status reply and drops the rest
  (position, locks, doors, VIN, plate, nickname and everything not named here).
- `ZeekrStatusSource` wraps the `zeekr-ev-api` client. It calls `login`, `get_vehicle_list` and
  `get_status` and nothing else, and it raises only fixed messages, never the server's text.
- `ZeekrLiveTelemetryProvider` serves `read_*` readings from one cached snapshot, spaces calls out,
  backs off after a failure and stops after repeated failures.

Field meanings and units were compared with the car on one reading (ADR-009). Empty strings and
unparseable values become "no reading".
"""

from __future__ import annotations

import datetime as dt
import logging
import math
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from pydantic import SecretStr

from app.adapters.telemetry import Reading, TyrePressures
from app.config import ZEEKR_LIVE_FIELDS, Settings
from app.live_limits import (
    BATTERY_PERCENT,
    ODOMETER_KM,
    RANGE_KM,
    SERVICE_DAYS,
    SERVICE_DISTANCE_KM,
    TYRE_KPA,
)

SOURCE = "zeekr_live"
log = logging.getLogger("app.zeekr_live")

_AVS = "additionalVehicleStatus"
_MAINT = (_AVS, "maintenanceStatus")
_ELEC = (_AVS, "electricVehicleStatus")
_CLIMATE = (_AVS, "climateStatus")


class ZeekrReadError(Exception):
    """A read failed. The message is fixed text; it never carries anything the server sent."""


@dataclass(frozen=True)
class Snapshot:
    observed_at: dt.datetime | None
    odometer_km: int | None
    battery_percent: float | None
    range_km: int | None
    days_to_service: int | None
    distance_to_service_km: int | None
    tyres_kpa: TyrePressures | None
    is_charging: bool | None
    is_plugged_in: bool | None


def _dig(status: object, path: tuple[str, ...]) -> object:
    node = status
    for part in path:
        node = node.get(part) if isinstance(node, Mapping) else None
    return node


def _number(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    number: float
    if isinstance(value, int | float):
        number = float(value)
    elif isinstance(value, str) and value.strip():
        try:
            number = float(value.strip())
        except ValueError:
            return None
    else:
        return None
    return number if math.isfinite(number) else None


def _whole(value: object, low: int = 0, high: int | None = None) -> int | None:
    number = _number(value)
    if number is None or number != int(number) or number < low:
        return None
    if high is not None and number > high:
        return None
    return int(number)


def _flag(value: object) -> bool | None:
    return value if isinstance(value, bool) else None


def _observed_at(value: object) -> dt.datetime | None:
    millis = _whole(value, low=1)
    if millis is None:
        return None
    try:
        return dt.datetime.fromtimestamp(millis / 1000, tz=dt.UTC)
    except (OverflowError, OSError, ValueError):
        return None


def _tyres(status: object) -> TyrePressures | None:
    names = (
        "tyreStatusDriver",
        "tyreStatusPassenger",
        "tyreStatusDriverRear",
        "tyreStatusPassengerRear",
    )
    values = [_whole(_dig(status, (*_MAINT, name)), *TYRE_KPA) for name in names]
    if any(v is None for v in values):
        return None
    driver, passenger, driver_rear, passenger_rear = (int(v) for v in values if v is not None)
    return TyrePressures(driver, passenger, driver_rear, passenger_rear)


def map_status(status: object) -> Snapshot:
    """Keep only the allow-listed fields. A range of 0 is read as 'not reported'. Values outside
    `app.live_limits` become 'no reading'."""
    percent = _number(_dig(status, (*_ELEC, "chargeLevel")))
    if percent is not None and not BATTERY_PERCENT[0] <= percent <= BATTERY_PERCENT[1]:
        percent = None
    range_km = _whole(_dig(status, (*_ELEC, "distanceToEmptyOnBatteryOnly")), *RANGE_KM)
    return Snapshot(
        observed_at=_observed_at(_dig(status, (*_CLIMATE, "updateTime"))),
        odometer_km=_whole(_dig(status, (*_MAINT, "odometer")), *ODOMETER_KM),
        battery_percent=percent,
        range_km=range_km,
        days_to_service=_whole(_dig(status, (*_MAINT, "daysToService")), *SERVICE_DAYS),
        distance_to_service_km=_whole(
            _dig(status, (*_MAINT, "distanceToService")), *SERVICE_DISTANCE_KM
        ),
        tyres_kpa=_tyres(status),
        is_charging=_flag(_dig(status, (*_ELEC, "isCharging"))),
        is_plugged_in=_flag(_dig(status, (*_ELEC, "isPluggedIn"))),
    )


@dataclass(frozen=True)
class ZeekrSettings:
    username: str
    password: str
    country_code: str
    hmac_access_key: str
    hmac_secret_key: str
    password_public_key: str
    prod_secret: str
    vin_key: str
    vin_iv: str


def build_live_provider(settings: Settings) -> ZeekrLiveTelemetryProvider | None:
    """None unless the owner switched it on. Building it makes no network call: the first login
    happens on the first `read_*`, and nothing in the app calls one yet."""
    if not settings.zeekr_live_enabled:
        return None

    def secret(name: str) -> str:
        value = getattr(settings, name)
        return value.get_secret_value() if isinstance(value, SecretStr) else str(value)

    values = {name.removeprefix("zeekr_"): secret(name) for name in ZEEKR_LIVE_FIELDS}
    # Looked up at call time (not bound as a default) so a test can replace the library.
    source = ZeekrStatusSource(ZeekrSettings(**values), lambda s: _build_client(s))
    return ZeekrLiveTelemetryProvider(
        source, min_interval_s=settings.zeekr_live_interval_minutes * 60.0
    )


def _silent_logger() -> logging.Logger:
    logger = logging.getLogger("app.zeekr_live.library")
    logger.handlers = [logging.NullHandler()]
    logger.propagate = False
    logger.setLevel(logging.CRITICAL + 1)
    return logger


def _build_client(settings: ZeekrSettings) -> Any:
    from zeekr_ev_api.client import ZeekrClient  # type: ignore[import-untyped]

    return ZeekrClient(
        username=settings.username,
        password=settings.password,
        country_code=settings.country_code,
        hmac_access_key=settings.hmac_access_key,
        hmac_secret_key=settings.hmac_secret_key,
        password_public_key=settings.password_public_key,
        prod_secret=settings.prod_secret,
        vin_key=settings.vin_key,
        vin_iv=settings.vin_iv,
        logger=_silent_logger(),
        max_retries=0,
    )


class ZeekrStatusSource:
    """Returns one raw status reply. The only library calls are the three read-only ones."""

    def __init__(
        self,
        settings: ZeekrSettings,
        client_factory: Callable[[ZeekrSettings], Any] = _build_client,
    ) -> None:
        self._settings = settings
        self._factory = client_factory
        self._client: Any = None

    def __call__(self) -> Mapping[str, Any]:
        try:
            if self._client is None:
                client = self._factory(self._settings)
                client.login()
                self._client = client
            vehicles = self._client.get_vehicle_list()
            if not vehicles:
                raise ZeekrReadError("Zeekr returned no vehicle")
            status = vehicles[0].get_status()
        except ZeekrReadError:
            self._client = None
            raise
        except Exception:
            self._client = None
            raise ZeekrReadError("Zeekr read failed") from None
        if not isinstance(status, Mapping):
            raise ZeekrReadError("Zeekr status was not an object")
        return status


class ZeekrLiveTelemetryProvider:
    """Read-only. One snapshot serves every `read_*`; calls are spaced and failures back off."""

    def __init__(
        self,
        source: Callable[[], Mapping[str, Any]],
        *,
        min_interval_s: float = 300.0,
        max_backoff_s: float = 3600.0,
        max_failures: int = 5,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._source = source
        self._min_interval = min_interval_s
        self._max_backoff = max_backoff_s
        self._max_failures = max_failures
        self._clock = clock
        self._snapshot: Snapshot | None = None
        self._next_try = 0.0
        self._failures = 0
        self._fetches = 0

    @property
    def stopped(self) -> bool:
        return self._failures >= self._max_failures

    @property
    def failures(self) -> int:
        """Consecutive failed reads; 0 after a success."""
        return self._failures

    @property
    def fetches(self) -> int:
        """Real reads attempted, so a caller can tell a fresh read from a cached one."""
        return self._fetches

    @property
    def snapshot(self) -> Snapshot | None:
        """The last successful snapshot, or None after a failure or before the first read."""
        return self._snapshot

    def _current(self) -> Snapshot | None:
        if self.stopped or self._clock() < self._next_try:
            return self._snapshot
        self._fetches += 1
        try:
            self._snapshot = map_status(self._source())
        except Exception:
            self._failures += 1
            # Never sooner than the interval, whatever the cap.
            wait = max(
                self._min_interval, min(self._min_interval * 2**self._failures, self._max_backoff)
            )
            self._next_try = self._clock() + wait
            self._snapshot = None
            log.warning("Zeekr read failed (%d of %d)", self._failures, self._max_failures)
            if self._failures >= self._max_failures:
                log.warning("Zeekr reads stopped until the app restarts")
        else:
            self._failures = 0
            self._next_try = self._clock() + self._min_interval
        return self._snapshot

    def _reading[T](self, pick: Callable[[Snapshot], T | None]) -> Reading[T]:
        snap = self._current()
        value = pick(snap) if snap is not None else None
        observed = snap.observed_at if snap is not None and value is not None else None
        return Reading(value=value, source=SOURCE, observed_at=observed)

    def read_odometer(self) -> Reading[int]:
        return self._reading(lambda s: s.odometer_km)

    def read_battery_percent(self) -> Reading[float]:
        return self._reading(lambda s: s.battery_percent)

    def read_range_km(self) -> Reading[int]:
        return self._reading(lambda s: s.range_km)

    def read_days_to_service(self) -> Reading[int]:
        return self._reading(lambda s: s.days_to_service)

    def read_distance_to_service_km(self) -> Reading[int]:
        return self._reading(lambda s: s.distance_to_service_km)

    def read_tyre_pressures_kpa(self) -> Reading[TyrePressures]:
        return self._reading(lambda s: s.tyres_kpa)

    def read_is_charging(self) -> Reading[bool]:
        return self._reading(lambda s: s.is_charging)

    def read_is_plugged_in(self) -> Reading[bool]:
        return self._reading(lambda s: s.is_plugged_in)
