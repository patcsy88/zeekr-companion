"""Optional error reporting to Sentry (ADR-007). Off unless SENTRY_DSN is set.

Owner records, usernames, amounts and tokens must never leave the host. The scrubber keeps only
what is needed to find a bug: the exception type, the stack trace (file, function, line) and the
request method and path. Everything else is dropped before the event is sent.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

_KEEP_FRAME_KEYS = ("filename", "function", "lineno", "module", "in_app")
_DROP_TOP_LEVEL = (
    "user",
    "extra",
    "contexts",
    "breadcrumbs",
    "modules",
    "server_name",
    "tags",
    "sdk_extras",
)


def _scrub_request(request: dict[str, Any]) -> dict[str, Any]:
    url = str(request.get("url") or "")
    path = urlsplit(url).path if url else ""
    return {"method": request.get("method"), "url": path}


def _scrub_exception(exc: dict[str, Any]) -> dict[str, Any]:
    # The message is dropped: database errors and validation errors can echo submitted values.
    out: dict[str, Any] = {"type": exc.get("type"), "module": exc.get("module")}
    frames = (exc.get("stacktrace") or {}).get("frames") or []
    if frames:
        out["stacktrace"] = {
            "frames": [{k: f[k] for k in _KEEP_FRAME_KEYS if k in f} for f in frames]
        }
    return out


def scrub_event(event: dict[str, Any], _hint: dict[str, Any] | None = None) -> dict[str, Any]:
    """before_send hook. Returns a new event holding only the allow-listed fields."""
    clean: dict[str, Any] = {
        k: event[k]
        for k in ("event_id", "timestamp", "level", "platform", "release", "environment")
        if k in event
    }
    if isinstance(event.get("request"), dict):
        clean["request"] = _scrub_request(event["request"])
    values = (event.get("exception") or {}).get("values") or []
    if values:
        clean["exception"] = {"values": [_scrub_exception(v) for v in values]}
    elif event.get("logentry") or event.get("message"):
        clean["message"] = "log event (message withheld)"
    return clean


def init_sentry(dsn: str | None, environment: str = "production") -> bool:
    """Start reporting when a DSN is given. Returns whether it started."""
    if not dsn:
        return False
    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        send_default_pii=False,
        include_local_variables=False,
        include_source_context=False,
        max_breadcrumbs=0,
        traces_sample_rate=0.0,
        profiles_sample_rate=0.0,
        server_name="",
        default_integrations=False,
        integrations=[StarletteIntegration(), FastApiIntegration()],
        before_send=scrub_event,  # type: ignore[arg-type]
    )
    return True
