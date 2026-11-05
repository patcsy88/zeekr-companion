"""Sentry on or off from the app (ADR-010). The only service that sends a command to the car.

One send at a time, never sooner than MIN_SPACING_S after the last logged one, and only on the
owner's request: nothing here is scheduled and nothing calls it but the route. The state shown
afterwards is what the car reports on a read, never an assumption that the command worked.
"""

from __future__ import annotations

import datetime as dt
import logging
import threading
from collections.abc import Callable, Mapping
from typing import Any

from sqlalchemy.exc import SQLAlchemyError

from app.adapters.zeekr_live import SENTRY_KEY, ZeekrLiveTelemetryProvider, _sentry
from app.adapters.zeekr_sentry_command import send_sentry
from app.errors import Conflict, NotFound, UpstreamFailed
from app.repositories.car_command_log import CarCommandLogRepository
from app.schemas import CommandLogItem, CommandLogOut, SentryCommandOut
from app.services.live_vehicle import months_before
from app.services.sentry_state import SentryStateHub

RETENTION_MONTHS = 12
MIN_SPACING_S = 60.0
LIVE_LOCK_WAIT_S = 5.0
log = logging.getLogger("app.sentry_command")

_NOT_ON = "Live vehicle readings are off."
_BUSY = "A Sentry command is already in progress."
_SOON = "Too soon after the last Sentry command. Try again in a minute."
_REFUSED = "The car's service did not accept the command."
_FAILED = "Could not reach the car's service."


def _label(state: object) -> str | None:
    value = _sentry(state.get(SENTRY_KEY)) if isinstance(state, Mapping) else None
    return None if value is None else ("on" if value else "off")


class SentryCommandService:
    def __init__(
        self,
        repo: CarCommandLogRepository,
        provider: ZeekrLiveTelemetryProvider | None,
        live_lock: threading.Lock,
        send_lock: threading.Lock,
        sleep: Callable[[float], None],
        wait_s: float,
        hub: SentryStateHub | None = None,
        now: Callable[[], dt.datetime] = lambda: dt.datetime.now(dt.UTC),
    ) -> None:
        self._repo = repo
        self._provider = provider
        self._live_lock = live_lock
        self._send_lock = send_lock
        self._sleep = sleep
        self._wait_s = wait_s
        self._hub = hub
        self._now = now

    def send(self, desired: str) -> SentryCommandOut:
        provider = self._provider
        vehicle_of = getattr(provider.source, "vehicle", None) if provider else None
        if provider is None or vehicle_of is None:
            raise NotFound(_NOT_ON)
        if not self._send_lock.acquire(blocking=False):
            raise Conflict(_BUSY)
        try:
            last = self._repo.last_created()
            if last is not None and (self._now() - last).total_seconds() < MIN_SPACING_S:
                raise Conflict(_SOON)
            if not self._live_lock.acquire(timeout=LIVE_LOCK_WAIT_S):
                raise Conflict(_BUSY)
            try:
                return self._send_locked(desired, vehicle_of)
            finally:
                self._live_lock.release()
        finally:
            self._send_lock.release()

    def _send_locked(self, desired: str, vehicle_of: Callable[[], Any]) -> SentryCommandOut:
        out = self._send_once(desired, vehicle_of)
        if self._hub is not None and out.state_after is not None:
            self._hub.publish(out.state_after, self._now())
        return out

    def _send_once(self, desired: str, vehicle_of: Callable[[], Any]) -> SentryCommandOut:
        try:
            vehicle = vehicle_of()
            before = _label(vehicle.get_remote_control_state())
        except Exception:
            self._record(desired, "failed", None)
            raise UpstreamFailed(_FAILED) from None
        if before == desired:
            return SentryCommandOut(desired=desired, sent=False, state_after=before, confirmed=True)
        accepted = send_sentry(vehicle, desired)
        self._sleep(self._wait_s)
        try:
            after = _label(vehicle.get_remote_control_state())
        except Exception:
            after = None
        self._record(desired, "sent" if accepted else "refused", after)
        if not accepted:
            raise UpstreamFailed(_REFUSED)
        return SentryCommandOut(
            desired=desired,
            sent=True,
            state_after=after,
            confirmed=after == desired,
        )

    def _record(self, desired: str, result: str, state_after: str | None) -> None:
        now = self._now()
        try:
            self._repo.add(
                {
                    "created_at": now,
                    "desired": desired,
                    "source": "manual",
                    "result": result,
                    "state_after": state_after,
                },
                keep_after=months_before(now, RETENTION_MONTHS),
            )
        except SQLAlchemyError:
            log.warning("Could not log a Sentry command")

    def log_items(self, limit: int) -> CommandLogOut:
        floor = months_before(self._now(), RETENTION_MONTHS)
        rows = self._repo.list(limit, floor)
        return CommandLogOut(
            items=[
                CommandLogItem(
                    id=r.id,
                    created_at=r.created_at,
                    desired=r.desired,
                    source=r.source,
                    result=r.result,
                    state_after=r.state_after,
                )
                for r in rows
            ],
            retention_months=RETENTION_MONTHS,
        )
