"""One owner-run attempt to switch Sentry on or off (ADR-010). The agent never runs this.

Usage:  ZEEKR_SENTRY_SEND_CONFIRM=send-one-command \\
            python -m app.cli.zeekr_sentry_send --on      (or --off)

It makes ONE login, reads the Sentry state, sends ONE command, waits, and reads the state again.
It prints only: whether the login worked, the state before, whether Zeekr accepted the call, and
the state after. A state is printed as on, off or "other" (anything but the two strings seen).
Never printed: the reply, the server's text, the VIN, any position or any other field.
"Accepted" is not "done": trust the state after, and read once more later if it still shows the
old value, because the car can report late.

It reads the account and the six app values from environment variables, never from a file. Exit
code 0 means the call was accepted and the state after matches, 1 means a failure or a mismatch,
2 means nothing was sent.
"""

from __future__ import annotations

import logging
import os
import sys
import time
from collections.abc import Callable, Mapping
from typing import Any

from app.adapters.zeekr_live import SENTRY_KEY, _sentry
from app.adapters.zeekr_sentry_command import send_sentry
from app.cli.zeekr_login_check import REQUIRED, _build_client, _silent_logger

CONFIRM_VARIABLE = "ZEEKR_SENTRY_SEND_CONFIRM"
CONFIRM_VALUE = "send-one-command"
WAIT_SECONDS = 15.0


def _label(state: Mapping[str, Any] | None) -> str:
    value = _sentry(state.get(SENTRY_KEY)) if isinstance(state, Mapping) else None
    return {True: "on", False: "off", None: "other"}[value]


def main(
    argv: list[str] | None = None,
    env: Mapping[str, str] | None = None,
    client_factory: Callable[..., Any] = _build_client,
    sleep: Callable[[float], None] = time.sleep,
) -> int:
    args = sys.argv[1:] if argv is None else argv
    values = os.environ if env is None else env
    if env is None:
        logging.disable(logging.CRITICAL)

    wanted = [a for a in ("--on", "--off") if a in args]
    if len(wanted) != 1:
        print("Give exactly one of --on or --off. Nothing was sent.", file=sys.stderr)
        return 2
    desired = wanted[0].removeprefix("--")
    if values.get(CONFIRM_VARIABLE) != CONFIRM_VALUE:
        print(
            f"Set {CONFIRM_VARIABLE}={CONFIRM_VALUE} to confirm one command. Nothing was sent.",
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
        vehicles = client.get_vehicle_list()
    except Exception as exc:  # the message can carry tokens, so only the class is shown
        print(
            f"Login or vehicle list failed: {type(exc).__name__}. Nothing was sent.",
            file=sys.stderr,
        )
        return 1
    if not vehicles:
        print("The vehicle list is empty. Nothing was sent.", file=sys.stderr)
        return 1
    vehicle = vehicles[0]

    try:
        before = _label(vehicle.get_remote_control_state())
    except Exception as exc:
        print(f"Reading the state failed: {type(exc).__name__}. Nothing was sent.", file=sys.stderr)
        return 1
    print(f"Sentry state before: {before}")
    if before == desired:
        print("The car already reports that state. Nothing was sent.")
        return 0

    print(f"Sending one command: Sentry {desired}.")
    accepted = send_sentry(vehicle, desired)
    print(f"Zeekr accepted the call: {'yes' if accepted else 'no'}")
    sleep(WAIT_SECONDS)
    try:
        after = _label(vehicle.get_remote_control_state())
    except Exception as exc:
        print(f"Reading the state back failed: {type(exc).__name__}.", file=sys.stderr)
        return 1
    print(f"Sentry state after {int(WAIT_SECONDS)} seconds: {after}")
    return 0 if accepted and after == desired else 1


if __name__ == "__main__":
    raise SystemExit(main())
