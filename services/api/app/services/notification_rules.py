"""Notification rules, build step 1 (ADR-015): the rule list, the options and the pure checks.

Nothing here reads the car, sends a push or runs a loop. `evaluate_rule` and `decide_send` work on
a small in-memory `RuleReading` that is never stored, logged or returned.
"""

from __future__ import annotations

import datetime as dt
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from app.adapters.zeekr_live import ENGINE_STATUS_LABELS
from app.config import Settings
from app.errors import Conflict, NotFound
from app.models import NotificationRule
from app.repositories.notification_rules import NotificationRuleRepository
from app.schemas import (
    RULE_COOLDOWN_DEFAULT,
    RULE_COOLDOWN_MAX,
    RULE_MAX,
    RULE_MAX_CONDITIONS,
    RULE_RADIUS_MAX_KM,
    NotificationRuleIn,
    NotificationRuleOptionsOut,
    NotificationRuleOut,
    RuleFieldOut,
    RuleLimitsOut,
    RuleOptionOut,
)
from app.services.push import push_enabled

# Labels are the public Home Assistant integration's (docs/architecture/vehicle-status-codes.md).
# None is confirmed for every code on the owner's car, so all are `verified: false`.
VEHICLE_STATUS_LABELS: dict[str, str] = {
    "0": "Deep Sleep",
    "1": "Parked",
    "2": "Unlocked",
    "3": "System Active",
    "4": "Ready to Go",
    "13": "Active",
}
GEAR_LABELS: dict[str, str] = {
    "0": "Park (P)",
    "1": "Reverse (R)",
    "2": "Neutral (N)",
    "3": "Drive (D)",
}
LOCATION_LABELS: dict[str, str] = {
    "outside": "Outside the geofence",
    "inside": "Inside the geofence",
}
MATCH_LABELS: dict[str, str] = {"all": "All conditions (AND)", "any": "Any condition (OR)"}

LOCK_TEXT_LOCKED = "Central locking: Locked."
LOCK_TEXT_UNLOCKED = "Central locking: Unlocked."
LOCK_TEXT_NONE = "Central locking: no reading."


def _options(labels: dict[str, str]) -> list[RuleOptionOut]:
    return [RuleOptionOut(code=c, label=label, verified=False) for c, label in labels.items()]


def central_lock_text(locked: bool | None) -> str:
    """The fixed push text. No place, distance, reading age or rule name."""
    if locked is None:
        return LOCK_TEXT_NONE
    return LOCK_TEXT_LOCKED if locked else LOCK_TEXT_UNLOCKED


@dataclass(frozen=True)
class RuleReading:
    """What one check may hold, in memory only. `nearest_km` is the distance to the nearest of
    the home and office points (None when the position is missing). The position itself is not
    here, and every value is hidden from `repr`."""

    stale: bool = field(default=False, repr=False)
    vehicle_status: str | None = field(default=None, repr=False)
    engine_status: str | None = field(default=None, repr=False)
    gear: str | None = field(default=None, repr=False)
    nearest_km: float | None = field(default=None, repr=False)
    home_set: bool = field(default=True, repr=False)


def _condition(cond: dict[str, Any], reading: RuleReading) -> bool | None:
    """True, False or None (unknown)."""
    if reading.stale:
        return None
    kind = cond["field"]
    if kind == "location":
        if not reading.home_set or reading.nearest_km is None:
            return None
        outside = reading.nearest_km > float(cond["radius_km"])
        return outside if cond["where"] == "outside" else not outside
    value = {
        "vehicle_status": reading.vehicle_status,
        "engine_status": reading.engine_status,
        "gear": reading.gear,
    }.get(kind)
    if value is None:
        return None
    return value in cond["codes"]


def evaluate_rule(
    match: str, conditions: Sequence[dict[str, Any]], reading: RuleReading
) -> bool | None:
    """True (matched), False (not matched) or None (not evaluated). ADR-015 decision 5."""
    results = [_condition(c, reading) for c in conditions]
    if match == "any":
        if any(r is True for r in results):
            return True
        return None if any(r is None for r in results) else False
    if any(r is False for r in results):
        return False
    return None if any(r is None for r in results) else True


def explain(match: str, conditions: Sequence[dict[str, Any]], reading: RuleReading) -> str:
    """The fixed phrase for a result that is not a plain match or non-match."""
    if reading.stale:
        return "reading too old"
    for c in conditions:
        if c["field"] == "location" and not reading.home_set:
            return "home not set"
    return "no reading"


@dataclass(frozen=True)
class SendDecision:
    action: str  # "send", "hold" or "none"
    last_matched: bool | None


def decide_send(
    result: bool | None,
    last_matched: bool | None,
    last_sent_at: dt.datetime | None,
    cooldown_minutes: int,
    now: dt.datetime,
) -> SendDecision:
    """Once when the result goes from not true to matched, held back by the cooldown (ADR-015
    decisions 7 and 8). A held send does not set `last_matched` to true."""
    if result is None:
        return SendDecision("none", last_matched)
    if result is False:
        return SendDecision("none", False)
    if last_matched is True:
        return SendDecision("none", True)
    if (
        cooldown_minutes > 0
        and last_sent_at is not None
        and now - last_sent_at < dt.timedelta(minutes=cooldown_minutes)
    ):
        return SendDecision("hold", last_matched)
    return SendDecision("send", True)


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


class NotificationRuleService:
    def __init__(self, repo: NotificationRuleRepository, settings: Settings) -> None:
        self._repo = repo
        self._settings = settings

    @staticmethod
    def _out(row: NotificationRule) -> NotificationRuleOut:
        return NotificationRuleOut.model_validate(
            {
                "id": row.id,
                "name": row.name,
                "enabled": row.enabled,
                "match": row.match,
                "conditions": row.conditions,
                "cooldown_minutes": row.cooldown_minutes,
                "last_matched": row.last_matched,
                "last_sent_at": row.last_sent_at,
                "last_result": row.last_result or "not checked yet",
            }
        )

    @staticmethod
    def _values(body: NotificationRuleIn) -> dict[str, Any]:
        return {
            "name": body.name,
            "enabled": body.enabled,
            "match": body.match,
            "conditions": [c.model_dump(mode="json") for c in body.conditions],
            "cooldown_minutes": body.cooldown_minutes,
        }

    def list(self) -> list[NotificationRuleOut]:
        return [self._out(r) for r in self._repo.all()]

    def create(self, body: NotificationRuleIn) -> NotificationRuleOut:
        row = self._repo.create(self._values(body), _now(), RULE_MAX)
        if row is None:
            raise Conflict(f"At most {RULE_MAX} rules can be saved.")
        return self._out(row)

    def replace(self, rule_id: uuid.UUID, body: NotificationRuleIn) -> NotificationRuleOut:
        row = self._repo.replace(rule_id, self._values(body), _now())
        if row is None:
            raise NotFound("Rule not found.")
        return self._out(row)

    def delete(self, rule_id: uuid.UUID) -> None:
        if not self._repo.delete(rule_id):
            raise NotFound("Rule not found.")

    def options(self) -> NotificationRuleOptionsOut:
        return NotificationRuleOptionsOut(
            fields=[
                RuleFieldOut(
                    field="vehicle_status",
                    name="Vehicle Status",
                    options=_options(VEHICLE_STATUS_LABELS),
                ),
                RuleFieldOut(
                    field="engine_status",
                    name="Engine Status",
                    options=_options(ENGINE_STATUS_LABELS),
                ),
                RuleFieldOut(field="gear", name="Gear", options=_options(GEAR_LABELS)),
                RuleFieldOut(
                    field="location", name="Car location", options=_options(LOCATION_LABELS)
                ),
            ],
            match=_options(MATCH_LABELS),
            limits=RuleLimitsOut(
                max_rules=RULE_MAX,
                max_conditions=RULE_MAX_CONDITIONS,
                cooldown_minutes_min=0,
                cooldown_minutes_max=RULE_COOLDOWN_MAX,
                cooldown_minutes_default=RULE_COOLDOWN_DEFAULT,
                radius_km_max=RULE_RADIUS_MAX_KM,
            ),
            push_ready=push_enabled(self._settings),
        )
