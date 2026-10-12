"""Pure ASGI middleware: request body size cap and `Cache-Control: no-store` on API responses."""

from __future__ import annotations

import json
from typing import Any

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# Largest legitimate body is a service record: notes (5000 chars) + description + provider, which
# is under 40 KiB even when every character is JSON-escaped. 64 KiB leaves headroom.
MAX_BODY_BYTES = 64 * 1024


class _BodyTooLarge(BaseException):
    """BaseException on purpose: framework `except Exception` blocks must not turn it into a 400/500
    of their own. It is always caught in `BodyLimitMiddleware`."""


def _too_large_body() -> bytes:
    payload = {
        "error": {
            "code": "validation_error",
            "message": "Request failed validation.",
            "details": [{"field": "body", "issue": "request body is too large"}],
        }
    }
    return json.dumps(payload).encode()


class BodyLimitMiddleware:
    """Reject bodies over `max_bytes` with the contract's 400 validation_error before parsing."""

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = Headers(scope=scope).get("content-length")
        if declared is not None and declared.isdigit() and int(declared) > self.max_bytes:
            await self._reject(send)
            return

        received = 0
        started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _BodyTooLarge
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except _BodyTooLarge:
            if started:
                raise RuntimeError(
                    "request body exceeded the limit after the response began"
                ) from None
            await self._reject(send)

    @staticmethod
    async def _reject(send: Send) -> None:
        body = _too_large_body()
        headers: list[tuple[bytes, bytes]] = [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode()),
            (b"connection", b"close"),
        ]
        await send({"type": "http.response.start", "status": 400, "headers": headers})
        await send({"type": "http.response.body", "body": body})


class NoStoreMiddleware:
    """Add `Cache-Control: no-store` to every response under /api (tokens and personal data)."""

    def __init__(self, app: ASGIApp, prefix: str = "/api") -> None:
        self.app = app
        self.prefix = prefix

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path: Any = scope.get("path", "")
        if scope["type"] != "http" or not (
            path == self.prefix or path.startswith(self.prefix + "/")
        ):
            await self.app(scope, receive, send)
            return

        async def send_with_header(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)["Cache-Control"] = "no-store"
            await send(message)

        await self.app(scope, receive, send_with_header)
