"""The single pure function for reminder status (AC-17).

The web client has the same rule in apps/web/src/lib/reminderStatus.ts. Both are tested against
packages/shared-types/test-vectors/reminder-status.json.
"""

from __future__ import annotations

import datetime as dt
from typing import Literal

Status = Literal["upcoming", "overdue", "completed"]
OverdueBy = Literal["date", "odometer"]


def compute_status(
    *,
    completed_on: dt.date | None,
    due_date: dt.date | None,
    due_odometer: int | None,
    current_odometer_km: int | None,
    today: dt.date,
) -> tuple[Status, list[OverdueBy]]:
    if completed_on is not None:
        return "completed", []
    overdue_by: list[OverdueBy] = []
    if due_date is not None and today > due_date:
        overdue_by.append("date")
    if (
        due_odometer is not None
        and current_odometer_km is not None
        and current_odometer_km > due_odometer
    ):
        overdue_by.append("odometer")
    return ("overdue", overdue_by) if overdue_by else ("upcoming", [])
