"""Ranges the mapper keeps for live readings (ADR-009). Each sits inside the CHECK constraint
of its column in migration 0008, so a kept value is never refused. A test inserts every bound."""

ODOMETER_KM = (1, 10_000_000)
RANGE_KM = (1, 2000)
BATTERY_PERCENT = (0, 100)
# Negative means overdue.
SERVICE_DAYS = (-100_000, 100_000)
SERVICE_DISTANCE_KM = (-100_000, 100_000)
TYRE_KPA = (50, 500)
