"""Daily odometer read before a service (ADR-009 amendment, owner-approved 2026-11-03).

From 30 days before an open service reminder's due date, and after it until the reminder is
completed, the API reads the car once per Kuala Lumpur day at or after 08:00 and stores the
reading through the same path as the Vehicle card. Nothing else triggers a server-side read.
"""

from __future__ import annotations

import asyncio
import contextlib
import datetime as dt
import logging
from collections.abc import AsyncIterator

from fastapi import FastAPI

from app.clock import KUALA_LUMPUR, today_kl
from app.repositories.live_readings import LiveReadingRepository
from app.repositories.reminders import ReminderRepository
from app.services.live_vehicle import LiveVehicleService

WINDOW_DAYS = 30
READ_FROM = dt.time(8, 0)  # Kuala Lumpur
CHECK_EVERY_S = 900.0
FIRST_CHECK_S = 60.0
log = logging.getLogger("app.daily_read")


def in_window(due_dates: list[dt.date], today: dt.date) -> bool:
    return any(today >= d - dt.timedelta(days=WINDOW_DAYS) for d in due_dates)


class DailyOdometerRead:
    def __init__(self, app: FastAPI) -> None:
        self._app = app
        self._last_attempt: dt.date | None = None

    def run_once(self, now: dt.datetime | None = None) -> str:
        """One check. Returns why it did or did not read (no vehicle values)."""
        provider = self._app.state.live_telemetry
        if provider is None:
            return "off"
        moment = now or dt.datetime.now(dt.UTC)
        local = moment.astimezone(KUALA_LUMPUR)
        today = today_kl(moment)
        if local.time() < READ_FROM:
            return "too early"
        if self._last_attempt == today:
            return "already tried today"
        if provider.stopped:
            return "provider stopped"
        with self._app.state.session_factory() as session:
            due = ReminderRepository(session).open_service_due_dates()
            if not in_window(due, today):
                return "no service due soon"
            live = LiveReadingRepository(session)
            latest = live.latest()
            if latest is not None and today_kl(latest.received_at) == today:
                self._last_attempt = today
                return "already read today"
            self._last_attempt = today
            LiveVehicleService(
                live, provider, self._app.state.settings, self._app.state.live_lock
            ).card(moment)
        return "read"

    async def loop(self) -> None:
        delay = FIRST_CHECK_S
        while True:
            await asyncio.sleep(delay)
            delay = CHECK_EVERY_S
            try:
                await asyncio.to_thread(self.run_once)
            except Exception:
                log.warning("Daily odometer check failed")


@contextlib.asynccontextmanager
async def daily_read_lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Starts the loop only when live readings are on at startup; otherwise nothing runs."""
    if app.state.live_telemetry is None:
        yield
        return
    task = asyncio.create_task(DailyOdometerRead(app).loop())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
