"""Notification rule check, build step 2 (ADR-015). Nothing here writes to the car.

Every `zeekr_live_interval_minutes` the app takes one reading through the same provider, spacing,
lock and login cap as the Vehicle card, so rules add no Zeekr call. Each enabled rule is
evaluated in memory and the fixed Central locking text is pushed once when it first matches.

The vehicle status, engine status, gear, lock state, position and distance are read in memory,
used once and dropped. Only `last_matched`, `last_result` and `last_sent_at` are stored. A log line
holds counts only.
"""

from __future__ import annotations

import asyncio
import contextlib
import datetime as dt
import logging
from collections.abc import AsyncIterator
from typing import Any

from fastapi import FastAPI

from app.adapters.zeekr_live import GeofenceInput
from app.repositories.geofence_settings import GeofenceSettingsRepository
from app.repositories.live_readings import LiveReadingRepository
from app.repositories.notification_rules import NotificationRuleRepository
from app.repositories.push_subscriptions import PushSubscriptionRepository
from app.services.geofence import distance_km
from app.services.geofence_home import Fetch, HomePoint, HomeResolver
from app.services.geofence_settings import effective
from app.services.live_vehicle import CLOCK_SKEW, LiveVehicleService
from app.services.notification_rules import (
    RuleReading,
    central_lock_text,
    decide_send,
    evaluate_rule,
    explain,
)
from app.services.push import PushService, push_enabled

log = logging.getLogger("app.rules")

FIRST_CHECK_S = 75.0
VEHICLE_URL = "/vehicle"


class RuleCheck:
    def __init__(self, app: FastAPI, fetch: Fetch | None = None) -> None:
        self._app = app
        self._fetch = fetch
        self._home_resolver: HomeResolver | None = None
        self._office_resolver: HomeResolver | None = None
        self._resolver_settings: Any = None

    @property
    def interval_seconds(self) -> float:
        minutes: int = self._app.state.settings.zeekr_live_interval_minutes
        return minutes * 60.0

    def _points(self) -> tuple[HomePoint | None, HomePoint | None]:
        settings = self._app.state.settings
        if self._home_resolver is None or self._resolver_settings is not settings:
            self._home_resolver = HomeResolver(settings, self._fetch)
            self._office_resolver = HomeResolver(settings, self._fetch, "office")
            self._resolver_settings = settings
        home = self._home_resolver.resolve()
        office = self._office_resolver.resolve() if self._office_resolver else None
        return home, office

    def _stale_minutes(self) -> int:
        with self._app.state.session_factory() as session:
            saved = GeofenceSettingsRepository(session).get()
        return effective(self._app.state.settings, saved).stale_minutes

    def _reading(
        self,
        gi: GeofenceInput | None,
        engine: str | None,
        needs_place: bool,
        now: dt.datetime,
    ) -> RuleReading:
        if gi is None:
            return RuleReading()
        seen = gi.observed_at
        if seen is None or seen > now + CLOCK_SKEW:
            return RuleReading(stale=True)
        if now - seen > dt.timedelta(minutes=self._stale_minutes()):
            return RuleReading(stale=True)
        home: HomePoint | None = None
        office: HomePoint | None = None
        if needs_place:
            home, office = self._points()
        nearest: float | None = None
        if home is not None and gi.latitude is not None and gi.longitude is not None:
            nearest = distance_km(home.latitude, home.longitude, gi.latitude, gi.longitude)
            if office is not None:
                nearest = min(
                    nearest,
                    distance_km(office.latitude, office.longitude, gi.latitude, gi.longitude),
                )
        return RuleReading(
            vehicle_status=gi.usage_mode,
            engine_status=engine,
            gear=gi.gear,
            nearest_km=nearest,
            home_set=home is not None or not needs_place,
        )

    def run_once(self, now: dt.datetime | None = None) -> str:
        """One check. Returns counts in words: no reading, position or place."""
        app = self._app
        settings = app.state.settings
        provider = app.state.live_telemetry
        if provider is None:
            return "off"
        moment = now or dt.datetime.now(dt.UTC)
        with app.state.session_factory() as session:
            rules = [r for r in NotificationRuleRepository(session).all() if r.enabled]
        if not rules:
            return "no rules"
        if provider.stopped:
            return "provider stopped"
        with app.state.session_factory() as session:
            card = LiveVehicleService(
                LiveReadingRepository(session), provider, settings, app.state.live_lock
            ).card(moment)
        needs_place = any(c["field"] == "location" for r in rules for c in r.conditions)
        reading = self._reading(
            provider.geofence_input, provider.engine_status, needs_place, moment
        )
        locked = {"locked": True, "unlocked": False}.get(card.central_locking or "")
        text = central_lock_text(locked)
        ready = push_enabled(settings)
        sent_count = 0
        for rule in rules:
            try:
                if self._apply(rule, reading, text, ready, moment):
                    sent_count += 1
            except Exception:
                log.warning("Rule check failed for one rule")
        return f"{len(rules)} rules, {sent_count} sent"

    def _apply(
        self, rule: Any, reading: RuleReading, text: str, ready: bool, now: dt.datetime
    ) -> bool:
        """Evaluates one rule and saves its state. True when a push went out."""
        result = evaluate_rule(rule.match, rule.conditions, reading)
        decision = decide_send(
            result, rule.last_matched, rule.last_sent_at, rule.cooldown_minutes, now
        )
        matched, phrase, sent_at = decision.last_matched, rule.last_result, rule.last_sent_at
        went = False
        if result is None:
            phrase = explain(rule.match, rule.conditions, reading)
        elif result is False:
            phrase = "not matched"
        elif decision.action == "hold":
            phrase = "matched, held by cooldown"
        elif decision.action == "send":
            if not ready:
                matched, phrase = rule.last_matched, "push not set up"
            else:
                state: Any = self._app.state
                with state.session_factory() as session:
                    out = PushService(
                        PushSubscriptionRepository(session), state.settings, state.push_sender
                    ).send_all(text, now, VEHICLE_URL)
                if out.sent > 0:
                    went, phrase, sent_at = True, "matched, sent", now
                else:
                    matched = rule.last_matched
                    if out.failed == 0:
                        phrase = "push not set up"
        if (matched, phrase, sent_at) != (rule.last_matched, rule.last_result, rule.last_sent_at):
            with self._app.state.session_factory() as session:
                NotificationRuleRepository(session).set_state(
                    rule.id, last_matched=matched, last_result=phrase, last_sent_at=sent_at
                )
        return went

    async def loop(self) -> None:
        delay = FIRST_CHECK_S
        while True:
            await asyncio.sleep(delay)
            delay = self.interval_seconds
            try:
                result = await asyncio.to_thread(self.run_once)
                log.info("Rules check: %s", result)
            except Exception:
                log.warning("Rules check failed")


@contextlib.asynccontextmanager
async def rules_lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Starts the loop when live readings are on. It needs no geofence setting."""
    if app.state.live_telemetry is None:
        yield
        return
    task = asyncio.create_task(RuleCheck(app).loop())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
