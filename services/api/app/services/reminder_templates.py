"""Static, versioned reminder templates (FR-12). Read-only data: nothing here creates a reminder.

Content comes only from research entry M12 (docs/research/vehicle-integrations.md), the Zeekr
Malaysia schedule PDF, Performance Range (AWD) table, re-checked 2026-10-22. The PDF marks no work
items at the odd checkpoints, so those stay empty with `work_items_stated` false.
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

_EVEN_ITEMS = (
    "Maintenance inspection",
    "Cabin air filter replacement",
    "Brake fluid replacement",
    "Front and rear reducer lubricant replacement",
)
_COOLANT = "Coolant replacement"
_COOLANT_CHECKPOINTS = (4, 8)


def _checkpoint(number: int) -> TemplateCheckpoint:
    items: list[str] = []
    if number % 2 == 0:
        items = list(_EVEN_ITEMS)
        if number in _COOLANT_CHECKPOINTS:
            items.insert(3, _COOLANT)
    return TemplateCheckpoint(
        number=number,
        km=20_000 * number,
        months=12 * number,
        work_items=items,
        work_items_stated=bool(items),
    )


def get_templates() -> ReminderTemplateList:
    return ReminderTemplateList(
        items=[
            ReminderTemplate(
                id="awd-performance-service",
                version=1,
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
                interval=TemplateInterval(km=20_000, months=12, rule="whichever comes first"),
                baseline_required=True,
                checkpoints=[_checkpoint(n) for n in range(1, 9)],
            )
        ]
    )
