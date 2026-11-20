"""Push notifications (ADR-014, owner approved 2026-11-20): saved phones and the sender seam.

Build step 1: the phones and the endpoints. The real sender library is not installed yet; until it
is, `NoSender` says every send failed. Nothing here logs or returns an endpoint or a key.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
from typing import Any, Protocol

from fastapi import FastAPI

from app.config import Settings
from app.errors import Conflict
from app.repositories.push_subscriptions import PushSubscriptionRepository, SavedSubscription
from app.schemas import (
    PUSH_MAX_DEVICES,
    PushConfigOut,
    PushDevicesOut,
    PushSubscribeIn,
    PushTestOut,
)

log = logging.getLogger("app.push")

MAX_FAILURES = 5
TEST_TEXT = "Test from Zeekr Companion."

_OFF = "Push is not set up on the host."
_FULL = "This account already has the most phones allowed. Remove one first."


class SendResult:
    OK = "ok"
    GONE = "gone"  # the push service says the phone no longer exists (404 or 410)
    FAILED = "failed"


class PushSender(Protocol):
    def send(self, sub: SavedSubscription, text: str) -> str:
        """Returns a SendResult value. Never raises, never logs the endpoint or the keys."""
        ...


class NoSender:
    """Used until the real library is approved and installed: every send fails."""

    def send(self, sub: SavedSubscription, text: str) -> str:
        return SendResult.FAILED


SEND_TIMEOUT_S = 5.0

ALERT_TEXT_OFF = "Car is away from home and Sentry is off."
ALERT_TEXT_ON = "Car is away from home. Sentry was turned on automatically."
ALERT_TEXT_FAILED = "Car is away from home. Sentry could not be turned on."


def alert_text(auto_result: str | None) -> str:
    """The fixed text for a new alert, from the automatic-send result (None = toggle off)."""
    if auto_result in ("sent", "already on"):
        return ALERT_TEXT_ON
    if auto_result is None or auto_result.startswith("skipped"):
        return ALERT_TEXT_OFF
    return ALERT_TEXT_FAILED


class WebPushSender:
    """Sends through pywebpush with the host's VAPID values. The tap target is the Sentry tab."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def send(self, sub: SavedSubscription, text: str) -> str:
        key = self._settings.vapid_private_key
        subject = self._settings.vapid_subject
        if key is None or subject is None:
            return SendResult.FAILED
        try:
            from pywebpush import WebPushException, webpush
        except Exception:
            return SendResult.FAILED
        payload = json.dumps({"body": text, "url": "/sentry"})
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=payload,
                vapid_private_key=key.get_secret_value(),
                vapid_claims={"sub": subject.get_secret_value()},
                timeout=SEND_TIMEOUT_S,
                ttl=3600,
            )
        except WebPushException as exc:
            return SendResult.GONE if exc.status_code in (404, 410) else SendResult.FAILED
        except Exception:
            return SendResult.FAILED
        return SendResult.OK


def build_push_sender(settings: Settings) -> PushSender:
    return WebPushSender(settings) if push_enabled(settings) else NoSender()


def notify_alert(app: FastAPI, auto_result: str | None, now: dt.datetime) -> None:
    """One notification for a new alert. Best effort: never raises, never stops the check."""
    try:
        state: Any = app.state
        if not push_enabled(state.settings):
            return
        with state.session_factory() as session:
            PushService(
                PushSubscriptionRepository(session), state.settings, state.push_sender
            ).send_all(alert_text(auto_result), now)
    except Exception:
        log.warning("Push: alert notification failed")


def push_enabled(settings: Settings) -> bool:
    return bool(
        settings.vapid_private_key is not None
        and settings.vapid_subject is not None
        and settings.vapid_public_key
    )


class PushService:
    def __init__(
        self, repo: PushSubscriptionRepository, settings: Settings, sender: PushSender
    ) -> None:
        self._repo = repo
        self._settings = settings
        self._sender = sender

    def config(self) -> PushConfigOut:
        on = push_enabled(self._settings)
        return PushConfigOut(
            enabled=on,
            public_key=self._settings.vapid_public_key if on else None,
            devices=self._repo.count(),
            max_devices=PUSH_MAX_DEVICES,
        )

    def subscribe(self, body: PushSubscribeIn, now: dt.datetime) -> tuple[bool, PushDevicesOut]:
        """Returns (created, devices). A phone over the limit is a 409."""
        result = self._repo.upsert(
            body.endpoint, body.keys.p256dh, body.keys.auth, now, PUSH_MAX_DEVICES
        )
        if result == "full":
            raise Conflict(_FULL)
        return result == "created", PushDevicesOut(devices=self._repo.count())

    def unsubscribe(self, endpoint: str) -> PushDevicesOut:
        self._repo.delete_endpoint(endpoint)
        return PushDevicesOut(devices=self._repo.count())

    def send_all(self, text: str, now: dt.datetime) -> PushTestOut:
        """One message to every saved phone. A gone phone is removed; repeated failures remove it
        too. One failure never stops the others."""
        sent = failed = 0
        for sub in self._repo.all():
            try:
                outcome = self._sender.send(sub, text)
            except Exception:
                outcome = SendResult.FAILED
            if outcome == SendResult.OK:
                self._repo.record_success(sub.id, now)
                sent += 1
            elif outcome == SendResult.GONE:
                self._repo.delete_id(sub.id)
                failed += 1
            else:
                self._repo.record_failure(sub.id, MAX_FAILURES)
                failed += 1
        if failed:
            log.warning("Push: %d of %d sends failed", failed, sent + failed)
        return PushTestOut(sent=sent, failed=failed)

    def test(self, now: dt.datetime) -> PushTestOut:
        if not push_enabled(self._settings):
            raise Conflict(_OFF)
        return self.send_all(TEST_TEXT, now)
