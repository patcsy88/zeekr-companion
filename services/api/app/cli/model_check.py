"""Make one real model call with made-up numbers, to prove the host settings work (ADR-008).

Usage (inside the api container):  python -m app.cli.model_check
It uses the same settings and the same code path as the advisory run, but reads no records, writes
nothing to the database and does not count towards the monthly limit. The numbers are invented,
so no owner data is sent. It prints the outcome, token counts and the reply, never a key.
Exit code 0 means a valid reply came back.
"""

from __future__ import annotations

import sys

from app.config import Settings
from app.services.reasoning import build_reasoning_model

_CONDITION = "date_vs_km_warranty"
_INPUTS: dict[str, int | str] = {
    "km_to_limit": 1200,
    "days_to_expiry": 90,
    "projected_limit_date": "2030-01-15",
}


def main() -> int:
    settings = Settings()
    if not settings.advisory_model_enabled:
        print("ADVISORY_MODEL_ENABLED is not true. Nothing was sent.", file=sys.stderr)
        return 2
    model = build_reasoning_model(settings)
    if model is None:
        print("The key or model id is not set. Nothing was sent.", file=sys.stderr)
        return 2
    where = settings.advisory_model_base_url or "the default Anthropic endpoint"
    print(f"Model: {model.model_id}. Endpoint: {where}. Sending made-up numbers only.")
    result = model.explain(_CONDITION, _INPUTS)
    print(f"Outcome: {result.outcome}")
    print(f"Tokens: in={result.input_tokens} out={result.output_tokens}")
    if result.response_text is not None:
        print(f"Reply: {result.response_text}")
    if result.explanation is not None:
        print(f"Parsed urgency: {result.explanation.urgency}")
    return 0 if result.outcome == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
