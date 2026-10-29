"""The two advisory checks of ADR-008, as pure functions over plain data.

No database, no clock and no model call: callers pass the data and today's Asia/Kuala_Lumpur date.
All thresholds are named constants (proposed values the owner can change). A check returns
findings plus the reasons it could not evaluate, so silence is never ambiguous.

Only derived values go into `Finding.inputs`. Those are exactly the values that may be sent to a
model: no names, notes, ids or free text.
"""

from __future__ import annotations

import datetime as dt
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from fractions import Fraction
from typing import Any, Literal

RULE_VERSION = 1

PACE_WINDOW_DAYS = 180
PACE_MIN_RECORDS = 2
PACE_MIN_SPAN_DAYS = 30
HORIZON_DAYS = 365
CHARGE_BASELINE_MAX = 10
CHARGE_BASELINE_MIN = 5
DRIFT_PERCENT = 20

Condition = Literal["date_vs_km_warranty", "date_vs_km_service", "charging_cost_drift"]
SubjectKind = Literal["warranty_coverage", "reminder"]

_CONDITION_FOR: dict[SubjectKind, Condition] = {
    "warranty_coverage": "date_vs_km_warranty",
    "reminder": "date_vs_km_service",
}
_TITLE_FOR: dict[SubjectKind, str] = {
    "warranty_coverage": "Review warranty: the km limit may be reached before the end date",
    "reminder": "Review service: the km limit may be reached before the due date",
}


@dataclass(frozen=True)
class OdometerSample:
    date: dt.date
    km: int


@dataclass(frozen=True)
class LimitSubject:
    """An item with both a date and a km limit: a warranty coverage or a service reminder."""

    kind: SubjectKind
    id: uuid.UUID
    limit_km: int
    limit_date: dt.date


@dataclass(frozen=True)
class ChargeSample:
    id: uuid.UUID
    date: dt.date
    created_at: dt.datetime
    amount_minor: int
    energy_wh: int | None


@dataclass(frozen=True)
class SourceRef:
    kind: Literal["warranty_coverage", "reminder", "expense"]
    id: uuid.UUID


@dataclass(frozen=True)
class Finding:
    condition: Condition
    dedupe_key: str
    inputs: dict[str, int | str]
    source_refs: tuple[SourceRef, ...]
    suggestion: dict[str, Any] | None


@dataclass(frozen=True)
class Skipped:
    condition: Condition
    reason: Literal["not_enough_data"]


@dataclass(frozen=True)
class CheckOutcome:
    findings: tuple[Finding, ...] = field(default_factory=tuple)
    skipped: tuple[Skipped, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class Pace:
    """Driving pace as an exact ratio: `km` driven over `days`, with both above zero."""

    km: int
    days: int


def driving_pace(samples: Sequence[OdometerSample], today: dt.date) -> Pace | None:
    """Pace over the last PACE_WINDOW_DAYS days, or None when it cannot be worked out.

    Needs at least PACE_MIN_RECORDS samples in the window spanning at least PACE_MIN_SPAN_DAYS
    days, and an odometer that went up. Samples on one date are ordered by km, so the earliest
    is the lowest reading and the latest is the highest.
    """
    start = today - dt.timedelta(days=PACE_WINDOW_DAYS)
    window = sorted((s for s in samples if start <= s.date <= today), key=lambda s: (s.date, s.km))
    if len(window) < PACE_MIN_RECORDS:
        return None
    first, last = window[0], window[-1]
    days = (last.date - first.date).days
    km = last.km - first.km
    if days < PACE_MIN_SPAN_DAYS or km <= 0:
        return None
    return Pace(km=km, days=days)


def _ceil_div(a: int, b: int) -> int:
    return -(-a // b)


def check_date_vs_km(
    subjects: Sequence[LimitSubject],
    samples: Sequence[OdometerSample],
    current_km: int | None,
    today: dt.date,
) -> CheckOutcome:
    """Find items whose km limit would be reached before their date limit.

    A subject is skipped without comment when its date has passed or the odometer is already past
    its km limit (it is expired or overdue, which the other screens already show). A finding needs
    the projected limit date to fall before the date limit and within HORIZON_DAYS of today.
    """
    live = [
        s
        for s in subjects
        if s.limit_date >= today and (current_km is None or current_km <= s.limit_km)
    ]
    pace = driving_pace(samples, today) if current_km is not None else None
    if pace is None or current_km is None:
        reasons = {_CONDITION_FOR[s.kind] for s in live}
        skipped = tuple(Skipped(c, "not_enough_data") for c in sorted(reasons))
        return CheckOutcome(skipped=skipped)

    findings: list[Finding] = []
    for s in live:
        remaining = s.limit_km - current_km
        days = _ceil_div(remaining * pace.days, pace.km)
        if days > HORIZON_DAYS:
            continue
        projected = today + dt.timedelta(days=days)
        if projected >= s.limit_date:
            continue
        condition = _CONDITION_FOR[s.kind]
        findings.append(
            Finding(
                condition=condition,
                dedupe_key=f"{condition}:{s.id}",
                inputs={
                    "km_to_limit": remaining,
                    "days_to_expiry": (s.limit_date - today).days,
                    "projected_limit_date": projected.isoformat(),
                },
                source_refs=(SourceRef(s.kind, s.id),),
                suggestion={
                    "kind": "review_reminder",
                    "title": _TITLE_FOR[s.kind],
                    "due_date": projected.isoformat(),
                    "due_odometer": None,
                },
            )
        )
    findings.sort(key=lambda f: f.dedupe_key)
    return CheckOutcome(findings=tuple(findings))


def _round_half_up(value: Fraction) -> int:
    return (2 * value.numerator + value.denominator) // (2 * value.denominator)


def cost_per_kwh_sen(amount_minor: int, energy_wh: int) -> int:
    """Sen per kWh, rounded to the nearest sen (halves up): sen * 1000 Wh per kWh / Wh."""
    return _round_half_up(Fraction(amount_minor * 1000, energy_wh))


def check_charging_cost_drift(samples: Sequence[ChargeSample]) -> CheckOutcome:
    """Compare the latest priced charge with the mean of the charges before it.

    Only charges with a recorded energy count. The latest is the newest by date, created_at, id.
    The baseline is up to CHARGE_BASELINE_MAX earlier charges and needs at least
    CHARGE_BASELINE_MIN. A finding needs the latest to differ from the baseline by
    DRIFT_PERCENT percent or more, in either direction, using the rounded sen values.
    """
    priced = sorted(
        (s for s in samples if s.energy_wh is not None and s.energy_wh > 0),
        key=lambda s: (s.date, s.created_at, s.id),
        reverse=True,
    )
    if len(priced) < 1 + CHARGE_BASELINE_MIN:
        return CheckOutcome(skipped=(Skipped("charging_cost_drift", "not_enough_data"),))
    latest, prior = priced[0], priced[1 : 1 + CHARGE_BASELINE_MAX]
    if latest.energy_wh is None:
        return CheckOutcome(skipped=(Skipped("charging_cost_drift", "not_enough_data"),))
    latest_cost = cost_per_kwh_sen(latest.amount_minor, latest.energy_wh)
    mean = sum((Fraction(p.amount_minor * 1000, p.energy_wh or 1) for p in prior), Fraction(0))
    average = _round_half_up(mean / len(prior))
    if average <= 0:
        return CheckOutcome(skipped=(Skipped("charging_cost_drift", "not_enough_data"),))
    if abs(latest_cost - average) * 100 < DRIFT_PERCENT * average:
        return CheckOutcome()
    finding = Finding(
        condition="charging_cost_drift",
        dedupe_key=f"charging_cost_drift:{latest.id}",
        inputs={
            "latest_cost_per_kwh_sen": latest_cost,
            "average_cost_per_kwh_sen": average,
            "latest_date": latest.date.isoformat(),
        },
        source_refs=(SourceRef("expense", latest.id),),
        suggestion=None,
    )
    return CheckOutcome(findings=(finding,))
