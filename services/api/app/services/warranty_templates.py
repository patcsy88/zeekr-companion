"""Static, versioned warranty template (FR-6). Read-only data: nothing here creates a coverage.

Content comes only from research entries M8 to M10 (docs/research/vehicle-integrations.md), the
Zeekr Malaysia Warranty PDF, re-checked 2026-10-22. Durations and km only: no part lists, no
price, no statement of what is covered. The server never computes dates.
"""

from __future__ import annotations

import datetime as dt

from app.schemas import (
    WarrantyTemplate,
    WarrantyTemplateItem,
    WarrantyTemplateList,
    WarrantyTemplateSource,
)


def _item(key: str, name: str, months: int, km: int, ref: str) -> WarrantyTemplateItem:
    return WarrantyTemplateItem(key=key, name=name, months=months, km=km, research_ref=ref)


def get_templates() -> WarrantyTemplateList:
    return WarrantyTemplateList(
        items=[
            WarrantyTemplate(
                id="my-factory-warranty",
                version=1,
                name="Zeekr Malaysia factory warranty terms",
                source=WarrantyTemplateSource(
                    title="Zeekr Malaysia Warranty (PDF)",
                    url="https://assets.zeekrlife.com/assets/my/Warranty.pdf",
                    research_ref="M8, M9, M10",
                    status="verified",
                    retrieved=dt.date(2026, 10, 22),
                ),
                caveat=(
                    "Terms, scope, exclusions and conditions vary by build date, usage and "
                    "local rules. Confirm against your own warranty booklet or service centre."
                ),
                baseline_required=True,
                items=[
                    _item("general", "Vehicle warranty", 60, 150_000, "M8"),
                    _item(
                        "paint_corrosion",
                        "Paint and surface corrosion warranty",
                        60,
                        150_000,
                        "M8",
                    ),
                    _item("powertrain", "Electric powertrain warranty", 96, 160_000, "M9"),
                    _item("wear_short", "Wear-and-tear cover (short)", 6, 10_000, "M10"),
                    _item("wear_long", "Wear-and-tear cover (long)", 12, 20_000, "M10"),
                    WarrantyTemplateItem(
                        key="genuine_parts",
                        name="Genuine replacement parts",
                        months=None,
                        km=None,
                        research_ref="M10",
                        enter_manually=True,
                    ),
                ],
            )
        ]
    )
