"""Calendar dates are judged in Asia/Kuala_Lumpur (UTC+8, no DST). Owner decision 2026-10-22.

Timestamps stay UTC; only "today" for date rules uses this zone.
"""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

KUALA_LUMPUR = ZoneInfo("Asia/Kuala_Lumpur")


def today_kl(now: dt.datetime | None = None) -> dt.date:
    """The current calendar date in Asia/Kuala_Lumpur. `now` is injectable for tests."""
    instant = now if now is not None else dt.datetime.now(dt.UTC)
    return instant.astimezone(KUALA_LUMPUR).date()


def add_months(day: dt.date, months: int) -> dt.date:
    """The same day `months` calendar months later, clamped to the month's last day."""
    index = day.year * 12 + (day.month - 1) + months
    year, month = divmod(index, 12)
    month += 1
    d = day.day
    while True:
        try:
            return day.replace(year=year, month=month, day=d)
        except ValueError:
            d -= 1
