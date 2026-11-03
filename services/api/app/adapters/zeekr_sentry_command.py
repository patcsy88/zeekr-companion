"""The one command the app may send to the car: Sentry on or off (ADR-010).

Everything that goes out is a constant here. The caller picks only `on` or `off`; the service id,
key and value cannot be chosen. The payload was taken from a third-party integration for the same
car and is unverified until the owner's first run. Nothing here logs or returns the reply body.
"""

from __future__ import annotations

from typing import Any, Literal

Desired = Literal["on", "off"]

SERVICE_ID = "RSM"
SETTING_KEY = "rsm"
SETTING_VALUE = "6"
_COMMANDS: dict[str, str] = {"on": "start", "off": "stop"}


def build_request(desired: str) -> tuple[str, str, dict[str, Any]]:
    """`(command, service_id, setting)` for `on` or `off`. Anything else raises ValueError."""
    if not isinstance(desired, str) or desired not in _COMMANDS:
        raise ValueError("desired must be 'on' or 'off'")
    setting = {"serviceParameters": [{"key": SETTING_KEY, "value": SETTING_VALUE}]}
    return _COMMANDS[desired], SERVICE_ID, setting


def send_sentry(vehicle: Any, desired: str) -> bool:
    """Send the one command on a logged-in vehicle. True only if Zeekr said it was accepted.

    A refusal or an error is False and never carries the server's text. "Accepted" is not "done":
    the caller must read the state back.
    """
    command, service_id, setting = build_request(desired)
    try:
        return vehicle.do_remote_control(command, service_id, setting) is True
    except Exception:
        return False
