"""One login to Zeekr, run by the owner, to see which field names come back (ADR-009 gate 6).

Usage:  ZEEKR_LOGIN_CHECK_CONFIRM=one-attempt python -m app.cli.zeekr_login_check [--status]

It reads the account and the six app values from environment variables, never from a file, and
prints names and types only: no value, no VIN, no token. It makes ONE login attempt and does not
retry. With --status it also reads the status of the first vehicle once. It calls only
`login`, `get_vehicle_list` and `get_status`; nothing here can send a command to the car, and a
test fails if a write method is named in this file. It is not part of the running app.
Exit code 0 means the login worked, 1 means it failed, 2 means nothing was sent.
"""

from __future__ import annotations

import logging
import os
import sys
from collections.abc import Callable, Mapping
from typing import Any

CONFIRM_VARIABLE = "ZEEKR_LOGIN_CHECK_CONFIRM"
CONFIRM_VALUE = "one-attempt"

# environment variable -> ZeekrClient constructor argument
REQUIRED = {
    "ZEEKR_USERNAME": "username",
    "ZEEKR_PASSWORD": "password",
    "ZEEKR_COUNTRY_CODE": "country_code",
    "ZEEKR_HMAC_ACCESS_KEY": "hmac_access_key",
    "ZEEKR_HMAC_SECRET_KEY": "hmac_secret_key",
    "ZEEKR_PASSWORD_PUBLIC_KEY": "password_public_key",
    "ZEEKR_PROD_SECRET": "prod_secret",
    "ZEEKR_VIN_KEY": "vin_key",
    "ZEEKR_VIN_IV": "vin_iv",
}

_MAX_LINES = 300
_MAX_DEPTH = 6
_MAX_KEY = 40


def describe(value: object, path: str = "$", depth: int = 0) -> list[str]:
    """Names and types of a JSON-like value. Never returns a value."""
    if depth > _MAX_DEPTH:
        return [f"{path}: (too deep)"]
    if isinstance(value, dict):
        lines = [f"{path}: object"]
        for key in sorted(value, key=str):
            name = str(key) if len(str(key)) <= _MAX_KEY else "<long key>"
            lines.extend(describe(value[key], f"{path}.{name}", depth + 1))
        return lines
    if isinstance(value, list):
        lines = [f"{path}: list of {len(value)}"]
        if value:
            lines.extend(describe(value[0], f"{path}[0]", depth + 1))
        return lines
    return [f"{path}: {type(value).__name__}"]


def _build_client(**kwargs: Any) -> Any:
    from zeekr_ev_api.client import ZeekrClient  # type: ignore[import-untyped]

    return ZeekrClient(**kwargs)


def _silent_logger() -> logging.Logger:
    logger = logging.getLogger("zeekr_login_check")
    logger.handlers = [logging.NullHandler()]
    logger.propagate = False
    logger.setLevel(logging.CRITICAL + 1)
    return logger


def _print(lines: list[str]) -> None:
    for line in lines[:_MAX_LINES]:
        print(f"  {line}")
    if len(lines) > _MAX_LINES:
        print(f"  ... {len(lines) - _MAX_LINES} more lines not shown")


def main(
    argv: list[str] | None = None,
    env: Mapping[str, str] | None = None,
    client_factory: Callable[..., Any] = _build_client,
) -> int:
    args = sys.argv[1:] if argv is None else argv
    values = os.environ if env is None else env
    want_status = "--status" in args
    if env is None:
        logging.disable(logging.CRITICAL)

    if values.get(CONFIRM_VARIABLE) != CONFIRM_VALUE:
        print(
            f"Set {CONFIRM_VARIABLE}={CONFIRM_VALUE} to confirm one attempt. Nothing was sent.",
            file=sys.stderr,
        )
        return 2
    missing = [name for name in REQUIRED if not values.get(name)]
    if missing:
        print("Not set: " + ", ".join(missing) + ". Nothing was sent.", file=sys.stderr)
        return 2

    client = client_factory(
        **{argument: values[name] for name, argument in REQUIRED.items()},
        logger=_silent_logger(),
        max_retries=0,
    )
    print("Making one login attempt. No retry will follow.")
    try:
        client.login()
    except Exception as exc:  # the message can carry tokens, so only the class is shown
        print(f"Login failed: {type(exc).__name__}. Details are not printed.", file=sys.stderr)
        return 1
    print("Login worked.")

    try:
        vehicles = client.get_vehicle_list()
        print(f"Vehicles visible to this account: {len(vehicles)}")
        if not vehicles:
            print("The list is empty. See the ADR-009 note on library issue 2.")
            return 0
        print("Vehicle record fields:")
        _print(describe(vehicles[0].data))
        if want_status:
            print("Status fields (one read):")
            _print(describe(vehicles[0].get_status()))
    except Exception as exc:  # as above
        print(f"Read failed: {type(exc).__name__}. Details are not printed.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
