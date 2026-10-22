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
