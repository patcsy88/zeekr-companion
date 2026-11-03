"""One login to Zeekr, run by the owner, to see which field names come back (ADR-009 gate 6).

Usage:  ZEEKR_LOGIN_CHECK_CONFIRM=one-attempt \\
            python -m app.cli.zeekr_login_check [--status] [--values] [--dump] [--remote-state] \\
            [--show-code]

With --dump (implies --status) it prints every plain value in the one status reply as
`path = value`, so the owner can see all fields. Any path with a segment that looks like
position, VIN, plate, name, phone, address, token or key is printed as <hidden>, and so are
lock and door fields unless --include-lock-door is also given. Hiding works by key name, so
it is a guard, not a guarantee: read the output before pasting it anywhere, and never paste it
into the repo.

With --values (implies --status) it prints the value of each path in VALUE_PATHS instead of the
field tree, so the owner can compare them with the car. The list holds no position, lock, door,
VIN or plate field. Values are for the owner's screen only: never paste them into the repo.

With --remote-state it also makes one read of the car's remote-control state (a GET; the library
method reads the state and sends no command) and prints it like --dump does, with the same hiding.
Use it alone to skip the status read. It is for finding which field names exist; the meaning of
any field stays unverified.

With --show-code, a failed login also prints the server's error number (digits after a key named
like `code`) and any phrase from a short fixed list. No other server text is ever printed.

It reads the account and the six app values from environment variables, never from a file, and
prints names and types only: no value, no VIN, no token. It makes ONE login attempt and does not
retry. With --status it also reads the status of the first vehicle once. It calls only
`login`, `get_vehicle_list`, `get_status` and `get_remote_control_state`; nothing here can send a
command to the car, and a test fails if a write method is named in this file. It is not part of
the running app.
Exit code 0 means the login worked, 1 means it failed, 2 means nothing was sent.
"""

from __future__ import annotations

import logging
import os
import re
import sys
import traceback
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

_MAX_LINES = 700
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


_AVS = "additionalVehicleStatus"
# The only fields --values may print. Nothing about position, locks, doors, VIN or plate.
VALUE_PATHS = (
    f"{_AVS}.maintenanceStatus.odometer",
    f"{_AVS}.maintenanceStatus.daysToService",
    f"{_AVS}.maintenanceStatus.distanceToService",
    f"{_AVS}.maintenanceStatus.serviceWarningStatus",
    f"{_AVS}.maintenanceStatus.mainBatteryStatus.stateOfHealth",
    f"{_AVS}.maintenanceStatus.tyreStatusDriver",
    f"{_AVS}.maintenanceStatus.tyreStatusPassenger",
    f"{_AVS}.maintenanceStatus.tyreStatusDriverRear",
    f"{_AVS}.maintenanceStatus.tyreStatusPassengerRear",
    f"{_AVS}.maintenanceStatus.tyreTempDriver",
    f"{_AVS}.maintenanceStatus.tyreTempPassenger",
    f"{_AVS}.maintenanceStatus.tyreTempDriverRear",
    f"{_AVS}.maintenanceStatus.tyreTempPassengerRear",
    f"{_AVS}.electricVehicleStatus.stateOfCharge",
    f"{_AVS}.electricVehicleStatus.chargeLevel",
    f"{_AVS}.electricVehicleStatus.chargeSts",
    f"{_AVS}.electricVehicleStatus.isCharging",
    f"{_AVS}.electricVehicleStatus.isPluggedIn",
    f"{_AVS}.electricVehicleStatus.timeToFullyCharged",
    f"{_AVS}.electricVehicleStatus.distanceToEmptyOnBatteryOnly",
    "basicVehicleStatus.distanceToEmpty",
    f"{_AVS}.climateStatus.exteriorTemp",
    f"{_AVS}.climateStatus.interiorTemp",
    f"{_AVS}.climateStatus.updateTime",
)
_MAX_VALUE = 24


def pick_values(status: object) -> list[str]:
    """`path = value` for each allow-listed path that holds a plain number, string or flag."""
    lines = []
    for path in VALUE_PATHS:
        node: object = status
        for part in path.split("."):
            node = node.get(part) if isinstance(node, dict) else None
        if isinstance(node, bool | int | float):
            lines.append(f"{path} = {node}")
        elif isinstance(node, str):
            lines.append(f"{path} = {node[:_MAX_VALUE]!r}")
        elif node is None:
            lines.append(f"{path} = (absent or null)")
        else:
            lines.append(f"{path} = ({type(node).__name__}, not printed)")
    return lines


# Short fragments ("vin", "lat", "key", "uid") also sit inside harmless words ("driving",
# "latest", "fluid"), so they match only as whole words after the key is split at capital
# letters, digits and underscores. Long fragments cannot sit inside a harmless word, so they
# match anywhere (this also catches all-lowercase keys such as "gpsstate").
_KEY_WORDS = re.compile(r"[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+")
_HIDDEN_WORDS = frozenset(
    {"lat", "lon", "lng", "vin", "plate", "nick", "name", "phone", "mobile"}
    | {"key", "sign", "auth", "account", "user", "uid", "device", "sim"}
)
_HIDDEN_FRAGMENT = re.compile(
    r"latitude|longitude|gps|position|location|address|licen[cs]e|nickname|e-?mail|token|"
    r"secret|password|imei|iccid",
    re.IGNORECASE,
)
_LOCK_DOOR_WORDS = frozenset({"door", "doors", "trunk", "boot", "bonnet", "hood", "tailgate"})


def _words(key: str) -> list[str]:
    return [word.lower() for word in _KEY_WORDS.findall(key)]


def _sensitive_key(key: str) -> bool:
    return bool(_HIDDEN_FRAGMENT.search(key)) or any(w in _HIDDEN_WORDS for w in _words(key))


def _lock_door_key(key: str) -> bool:
    return any(w in _LOCK_DOOR_WORDS or w.startswith(("lock", "unlock")) for w in _words(key))


_DUMP_MAX_LINES = 600
_DUMP_MAX_DEPTH = 10
_DUMP_MAX_ITEMS = 5
_DUMP_MAX_STRING = 40


def dump_values(status: object, include_lock_door: bool = False) -> list[str]:
    """`path = value` for every plain value, with sensitive-looking paths shown as <hidden>."""
    lines: list[str] = []

    def hidden(key: str) -> bool:
        return _sensitive_key(key) or (not include_lock_door and _lock_door_key(key))

    def walk(node: object, path: str, depth: int, mask: bool) -> None:
        if len(lines) >= _DUMP_MAX_LINES:
            return
        if depth > _DUMP_MAX_DEPTH:
            lines.append(f"{path} = (too deep)")
        elif isinstance(node, dict):
            for key in sorted(node, key=str):
                name = str(key) if len(str(key)) <= _MAX_KEY else "<long key>"
                walk(node[key], f"{path}.{name}", depth + 1, mask or hidden(str(key)))
        elif isinstance(node, list):
            lines.append(f"{path} = list of {len(node)}")
            for i, item in enumerate(node[:_DUMP_MAX_ITEMS]):
                walk(item, f"{path}[{i}]", depth + 1, mask)
        elif mask:
            lines.append(f"{path} = <hidden>")
        elif isinstance(node, bool | int | float) or node is None:
            lines.append(f"{path} = {node}")
        elif isinstance(node, str):
            if len(node) > _DUMP_MAX_STRING and " " not in node:
                lines.append(f"{path} = <long string, hidden>")
            else:
                lines.append(f"{path} = {node[:_DUMP_MAX_STRING]!r}")
        else:
            lines.append(f"{path} = ({type(node).__name__}, not printed)")

    walk(status, "$", 0, False)
    return lines


LIBRARY_PACKAGE = "zeekr_ev_api"


def failing_stage(exc: BaseException) -> str:
    """Where in the library the exception came from: function name and line, never any text.

    The login runs a fixed chain of steps, so the innermost library function says which step
    failed (for example `_check_user`, `_do_login_request` or `_bearer_login`).
    """
    found = "unknown"
    for frame, line in traceback.walk_tb(exc.__traceback__):
        module = str(frame.f_globals.get("__name__", ""))
        if module == LIBRARY_PACKAGE or module.startswith(LIBRARY_PACKAGE + "."):
            found = f"{frame.f_code.co_name} (line {line})"
    return found


KNOWN_MESSAGES = (
    "Signature authentication failed",
    "Decrypt X-VIN failed",
    "Invalid access key",
    "Token expired",
)
_CODE_PATTERN = re.compile(
    r"""["']?(?:code|errCode|errorCode|resultCode|status)["']?\s*[:=]\s*["']?(\d{3,7})["']?(?![\w-])"""
)


def failure_hint(exc: BaseException) -> str:
    """A server error number and a known phrase from the exception text, or nothing.

    The text can hold tokens, so nothing from it is copied except digits that follow a key named
    like `code`, and a phrase is printed from our own fixed list, never from the text itself.
    """
    text = str(exc)
    codes = []
    for match in _CODE_PATTERN.finditer(text):
        if match.group(1) not in codes:
            codes.append(match.group(1))
    phrases = [phrase for phrase in KNOWN_MESSAGES if phrase.lower() in text.lower()]
    parts = []
    if codes:
        parts.append("code " + ", ".join(codes[:3]))
    if phrases:
        parts.append("message matches: " + "; ".join(phrases))
    return " | ".join(parts) if parts else "no known code or message found"


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
    want_values = "--values" in args
    want_dump = "--dump" in args
    want_status = "--status" in args or want_values or want_dump
    want_hint = "--show-code" in args
    want_remote_state = "--remote-state" in args
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
        print(
            f"Login failed: {type(exc).__name__} in {failing_stage(exc)}. Details are not printed.",
            file=sys.stderr,
        )
        if want_hint:
            print(f"Server hint: {failure_hint(exc)}", file=sys.stderr)
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
        if want_remote_state:
            state = vehicles[0].get_remote_control_state()
            print("Remote-control state values (read only, sensitive-looking paths hidden):")
            _print(dump_values(state, "--include-lock-door" in args))
        if want_status:
            status = vehicles[0].get_status()
            if want_dump:
                print("All plain status values (sensitive-looking paths hidden, one read):")
                _print(dump_values(status, "--include-lock-door" in args))
            elif want_values:
                print("Status values (fixed list, one read):")
                _print(pick_values(status))
            else:
                print("Status fields (one read):")
                _print(describe(status))
    except Exception as exc:  # as above
        print(
            f"Read failed: {type(exc).__name__} in {failing_stage(exc)}. Details are not printed.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
