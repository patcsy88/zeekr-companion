"""Push notifications (ADR-014, owner approved 2026-11-20): saved phones and the sender seam.

Build step 1: the phones and the endpoints. The real sender library is not installed yet; until it
is, `NoSender` says every send failed. Nothing here logs or returns an endpoint or a key.
"""

from __future__ import annotations

import datetime as dt
import logging
from typing import Protocol

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
