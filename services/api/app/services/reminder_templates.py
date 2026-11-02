"""Static, versioned reminder templates (FR-12). Read-only data: nothing here creates a reminder.

Content comes only from research entry M12 (docs/research/vehicle-integrations.md), the Zeekr
Malaysia schedule PDF, Performance Range (AWD) table, re-checked 2026-10-22. The PDF marks no work
and no cost at 20,000, 60,000, 100,000 and 140,000 km, so the template starts at 40,000 km (owner
decision 2026-11-02, version 2) and holds only the visits that have work.
"""

from __future__ import annotations

import datetime as dt

from app.schemas import (
    ReminderTemplate,
    ReminderTemplateList,
    TemplateCheckpoint,
    TemplateInterval,
    TemplateSource,
)

_WORK_ITEMS = (
    "Maintenance inspection",
    "Cabin air filter replacement",
    "Brake fluid replacement",
    "Front and rear reducer lubricant replacement",
)
_COOLANT = "Coolant replacement"
_COOLANT_CHECKPOINTS = (2, 4)  # 80,000 km and 160,000 km
STEP_KM = 40_000
STEP_MONTHS = 24
TEMPLATE_ID = "awd-performance-service"


def _checkpoint(number: int) -> TemplateCheckpoint:
    items = list(_WORK_ITEMS)
    if number in _COOLANT_CHECKPOINTS:
        items.insert(3, _COOLANT)
    return TemplateCheckpoint(
        number=number,
        km=STEP_KM * number,
        months=STEP_MONTHS * number,
        work_items=items,
        work_items_stated=True,
    )


def get_templates() -> ReminderTemplateList:
    return ReminderTemplateList(
        items=[
            ReminderTemplate(
                id="awd-performance-service",
                version=2,
                name="AWD Performance service schedule",
                kind="service",
                source=TemplateSource(
                    title="Zeekr Malaysia Service Maintenance Schedule and Pricing (PDF)",
                    url=(
                        "https://assets.zeekrlife.com/assets/my/"
                        "Service_Maintenance_Schedule_And_Pricing.pdf"
                    ),
                    research_ref="M12",
                    status="verified",
                    retrieved=dt.date(2026, 10, 22),
                ),
                caveat=(
                    "Requirements vary by model, build date, operating conditions and local "
                    "rules. Confirm against your own booklet or service centre."
                ),
                interval=TemplateInterval(
                    km=STEP_KM, months=STEP_MONTHS, rule="whichever comes first"
                ),
                baseline_required=True,
                checkpoints=[_checkpoint(n) for n in range(1, 5)],
            )
        ]
    )
