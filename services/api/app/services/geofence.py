"""Geofence alert (Piece B, owner-approved 2026-11-05). Read-only: nothing here writes to the car.

Every `GEOFENCE_INTERVAL_MINUTES` the app takes one reading through the same provider, spacing,
lock and login cap as the Vehicle card. An alert is open while all of these hold on a fresh
reading: the car is farther than the radius from home, `gearAutoStatus` is '0' and `usageMode`
is '0', and Sentry reads off. It closes by itself when any stops holding. At most one is open.

The position is read from the reply in memory, used once, and dropped. It is never written to
the database, a log line, an error or a response. A stale or incomplete reading changes nothing.
"""

from __future__ import annotations

import asyncio
import contextlib
import datetime as dt
import logging
import math
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import FastAPI

from app.adapters.zeekr_live import GeofenceInput
from app.repositories.advisory import AdvisoryRepository, ProposalCapReached
from app.repositories.live_readings import LiveReadingRepository
from app.services import advisory_checks as checks
from app.services.advisory import MAX_PROPOSALS
from app.services.geofence_home import Fetch, HomePoint, HomeResolver
from app.services.live_vehicle import CLOCK_SKEW, LiveVehicleService

CONDITION = "sentry_off_outside_geofence"
PARKED_ASLEEP = "0"  # gearAutoStatus Park, and usageMode Deep Sleep (owner decision, 2026-11-05)
EARTH_RADIUS_KM = 6371.0
FIRST_CHECK_S = 60.0
ENDED_SUFFIX = ":end"
log = logging.getLogger("app.geofence")

Result = Literal["alert", "clear", "stale", "incomplete", "no_reading", "no_home"]


@dataclass(frozen=True)
class Verdict:
    result: Result
    age_minutes: int | None = None


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance (haversine) in kilometres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def evaluate(
    reading: GeofenceInput | None,
    home: HomePoint | None,
    *,
    radius_km: float,
    stale_minutes: int,
    now: dt.datetime,
) -> Verdict:
    if home is None:
        return Verdict("no_home")
    if reading is None:
        return Verdict("no_reading")
    seen = reading.observed_at
    if seen is None or seen > now + CLOCK_SKEW:
        return Verdict("incomplete")
    age = max(now - seen, dt.timedelta(0))
    minutes = int(age.total_seconds() // 60)
    if age > dt.timedelta(minutes=stale_minutes):
        return Verdict("stale", minutes)
    if (
        reading.latitude is None
        or reading.longitude is None
        or reading.usage_mode is None
        or reading.gear is None
        or reading.sentry_active is None
    ):
        return Verdict("incomplete", minutes)
    outside = distance_km(home.latitude, home.longitude, reading.latitude, reading.longitude) > (
        radius_km
    )
    holds = (
        outside
        and reading.gear == PARKED_ASLEEP
        and reading.usage_mode == PARKED_ASLEEP
        and reading.sentry_active is False
    )
    return Verdict("alert" if holds else "clear", minutes)


class GeofenceCheck:
    def __init__(self, app: FastAPI, fetch: Fetch | None = None) -> None:
        self._app = app
        self._resolver_fetch = fetch
        self._resolver: HomeResolver | None = None
        self._resolver_settings: Any = None
        self.last_age_minutes: int | None = None

    @property
    def interval_seconds(self) -> float:
        minutes: int = self._app.state.settings.geofence_interval_minutes
        return minutes * 60.0

    def _home(self) -> HomePoint | None:
        settings = self._app.state.settings
        if self._resolver is None or self._resolver_settings is not settings:
            self._resolver = HomeResolver(settings, self._resolver_fetch)
            self._resolver_settings = settings
        return self._resolver.resolve()

    def run_once(self, now: dt.datetime | None = None) -> str:
        """One check. Returns the outcome in words (no position, no distance)."""
        self.last_age_minutes = None
        app = self._app
        settings = app.state.settings
        provider = app.state.live_telemetry
        if not settings.geofence_enabled or provider is None:
            return "off"
        moment = now or dt.datetime.now(dt.UTC)
        home = self._home()
        if home is None:
            return "home not set"
        if provider.stopped:
            return "provider stopped"
        with app.state.session_factory() as session:
            LiveVehicleService(
                LiveReadingRepository(session), provider, settings, app.state.live_lock
            ).card(moment)
        verdict = evaluate(
            provider.geofence_input,
            home,
            radius_km=settings.geofence_radius_km,
            stale_minutes=settings.geofence_stale_minutes,
            now=moment,
        )
        self.last_age_minutes = verdict.age_minutes
        if verdict.result in ("alert", "clear"):
            return self._apply(verdict, moment)
        return {"no_reading": "no reading"}.get(verdict.result, verdict.result)

    def _apply(self, verdict: Verdict, now: dt.datetime) -> str:
        with self._app.state.session_factory() as session:
            repo = AdvisoryRepository(session)
            try:
                repo.lock_run()
                latest = repo.latest_condition(CONDITION)
                live = (
                    latest is not None
                    and latest.status != "closed"
                    and not (latest.dedupe_key.endswith(ENDED_SUFFIX))
                )
                if verdict.result == "alert":
                    if live and latest is not None:
                        out = (
                            "alert open" if latest.status == "proposed" else "alert already decided"
                        )
                    else:
                        out = self._open(repo, now, verdict.age_minutes or 0)
                elif live and latest is not None:
                    if latest.status == "proposed":
                        repo.close(latest, now)
                        out = "alert closed"
                    else:
                        repo.end_episode(latest, ENDED_SUFFIX)
                        out = "clear"
                else:
                    out = "clear"
                repo.commit()
                return out
            except ProposalCapReached:
                repo.rollback()
                return "cap reached"
            except Exception:
                repo.rollback()
                raise

    @staticmethod
    def _open(repo: AdvisoryRepository, now: dt.datetime, age_minutes: int) -> str:
        values: dict[str, Any] = {
            "id": uuid.uuid4(),
            "condition": CONDITION,
            "dedupe_key": f"geofence:{now.astimezone(dt.UTC):%Y%m%dT%H%M%SZ}",
            "status": "proposed",
            "inputs": {"reading_age_minutes": age_minutes},
            "source_refs": [],
            "explanation": None,
            "explanation_status": "disabled",
            "urgency": None,
            "suggestion": None,
            "rule_version": checks.RULE_VERSION,
            "prompt_version": None,
            "model_id": None,
        }
        row = repo.insert(values, MAX_PROPOSALS)
        return "alert opened" if row is not None else "alert open"

    async def loop(self) -> None:
        delay = FIRST_CHECK_S
        while True:
            await asyncio.sleep(delay)
            delay = self.interval_seconds
            try:
                result = await asyncio.to_thread(self.run_once)
                age = self.last_age_minutes
                log.info(
                    "Geofence check: %s%s",
                    result,
                    "" if age is None else f" (reading {age} min old)",
                )
            except Exception:
                log.warning("Geofence check failed")


@contextlib.asynccontextmanager
async def geofence_lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Starts the loop only when the geofence and live readings are both on at startup."""
    if not app.state.settings.geofence_enabled or app.state.live_telemetry is None:
        yield
        return
    task = asyncio.create_task(GeofenceCheck(app).loop())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
