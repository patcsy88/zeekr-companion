"""The single pure function for warranty status (AC-51).

The web client has the same rule in apps/web (warrantyStatus). Both are tested against
packages/shared-types/test-vectors/warranty-status.json.
"""

from __future__ import annotations

import datetime as dt
from typing import Literal

Status = Literal["not_started", "active", "expiring_soon", "expired"]
Basis = Literal["date", "odometer"]

EXPIRING_SOON_DAYS = 90
EXPIRING_SOON_KM = 5_000


def compute_status(
    *,
    start_date: dt.date,
    end_date: dt.date | None,
    km_limit: int | None,
    current_odometer_km: int | None,
    today: dt.date,
) -> tuple[Status, list[Basis], list[Basis]]:
    """Return (status, expired_by, expiring_soon_by). Equality is never expired."""
    km_known = km_limit is not None and current_odometer_km is not None
    expired_by: list[Basis] = []
    if end_date is not None and today > end_date:
        expired_by.append("date")
    if km_known and current_odometer_km > km_limit:  # type: ignore[operator]
        expired_by.append("odometer")
    if expired_by:
        return "expired", expired_by, []
    if today < start_date:
        return "not_started", [], []
    soon_by: list[Basis] = []
    if end_date is not None and (end_date - today).days <= EXPIRING_SOON_DAYS:
        soon_by.append("date")
    if km_known and km_limit - current_odometer_km <= EXPIRING_SOON_KM:  # type: ignore[operator]
        soon_by.append("odometer")
    if soon_by:
        return "expiring_soon", [], soon_by
    return "active", [], []
