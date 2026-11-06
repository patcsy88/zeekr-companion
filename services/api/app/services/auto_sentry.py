"""Automatic Sentry on (ADR-011, approved 2026-11-06).

The geofence check calls `AutoSentrySender.after_alert_opened` once, only when a new alert has
just opened (a fresh reading, the car parked asleep outside the area, Sentry reading off). It sends
Sentry **on** through the same `SentryCommandService` as the manual switch, never off and never any
other command. One attempt per alert: there is no retry, and a failure leaves the toggle on.

Nothing here stores or logs a position, a distance, a home point, a payload or a VIN.
"""

from __future__ import annotations

import datetime as dt
import logging

from fastapi import FastAPI
from sqlalchemy.exc import SQLAlchemyError

from app.config import Settings
from app.errors import AppError, Conflict
from app.repositories.auto_sentry_settings import AutoSentrySettingsRepository
from app.repositories.car_command_log import CarCommandLogRepository
from app.schemas import (
    AUTO_QUIET_MAX,
    AUTO_QUIET_MIN,
    AutoSentryIn,
    AutoSentryLimitsOut,
    AutoSentryOut,
    AutoSentryRangeOut,
)
from app.services.live_vehicle import months_before
from app.services.sentry_command import RETENTION_MONTHS, SentryCommandService

log = logging.getLogger("app.auto_sentry")

_CANNOT_ENABLE = (
    "Automatic Sentry cannot be turned on: the host switch, live readings and the geofence "
    "must all be on."
)


def can_enable(settings: Settings) -> bool:
    return (
        settings.geofence_auto_sentry_allowed
        and settings.zeekr_live_enabled
        and settings.geofence_enabled
    )


class AutoSentrySettingsService:
    def __init__(self, repo: AutoSentrySettingsRepository, settings: Settings) -> None:
        self._repo = repo
        self._settings = settings

    def view(self) -> AutoSentryOut:
        saved = self._repo.get()
        return AutoSentryOut(
            enabled=saved.enabled,
            quiet_minutes=saved.quiet_minutes,
            host_allowed=self._settings.geofence_auto_sentry_allowed,
            can_enable=can_enable(self._settings),
            limits=AutoSentryLimitsOut(
                quiet_minutes=AutoSentryRangeOut(min=AUTO_QUIET_MIN, max=AUTO_QUIET_MAX)
            ),
        )

    def save(self, body: AutoSentryIn) -> AutoSentryOut:
        if body.enabled and not can_enable(self._settings):
            raise Conflict(_CANNOT_ENABLE)
        self._repo.save(body.enabled, body.quiet_minutes, dt.datetime.now(dt.UTC))
        return self.view()


class AutoSentrySender:
    def __init__(self, app: FastAPI) -> None:
        self._app = app

    def after_alert_opened(self, now: dt.datetime) -> str | None:
        """Returns a short outcome in words, or None when the toggle is off (nothing is logged).

        Never raises: a failure here must not stop the geofence check.
        """
        try:
            return self._run(now)
        except Exception:
            log.warning("Automatic Sentry on failed unexpectedly")
            return "error"

    def _run(self, now: dt.datetime) -> str | None:
        app = self._app
        settings: Settings = app.state.settings
        with app.state.session_factory() as session:
            saved = AutoSentrySettingsRepository(session).get()
            if not saved.enabled:
                return None
            log_repo = CarCommandLogRepository(session)
            if not settings.geofence_auto_sentry_allowed:
                return self._skip(log_repo, now, "host_off")
            last = log_repo.last_created()
            if last is not None and now - last < dt.timedelta(minutes=saved.quiet_minutes):
                return self._skip(log_repo, now, "quiet_period")
            state = app.state
            service = SentryCommandService(
                log_repo,
                state.live_telemetry,
                state.live_lock,
                state.sentry_send_lock,
                state.sentry_sleep,
                float(settings.sentry_confirm_wait_seconds),
                state.sentry_hub,
                lambda: now,  # one clock for the check, the spacing and the log row
            )
            try:
                out = service.send("on", "auto")
            except Conflict:
                return self._skip(log_repo, now, "busy")
            except AppError:
                log.info("Automatic Sentry on: failed or refused (logged, not retried)")
                return "failed or refused"
            outcome = (
                "already on" if not out.sent else ("sent" if out.confirmed else "not confirmed")
            )
            log.info("Automatic Sentry on: %s", outcome)
            return outcome

    @staticmethod
    def _skip(repo: CarCommandLogRepository, now: dt.datetime, reason: str) -> str:
        try:
            repo.add(
                {
                    "created_at": now,
                    "desired": "on",
                    "source": "auto",
                    "result": "skipped",
                    "state_after": None,
                    "skip_reason": reason,
                },
                keep_after=months_before(now, RETENTION_MONTHS),
            )
        except SQLAlchemyError:
            log.warning("Could not log a skipped automatic send")
        log.info("Automatic Sentry on: skipped (%s)", reason)
        return f"skipped ({reason})"
