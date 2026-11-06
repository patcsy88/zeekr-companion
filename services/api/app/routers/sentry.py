from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from app.errors import RateLimited
from app.openapi_docs import (
    BAD_REQUEST,
    CONFLICT,
    INTERNAL,
    NOT_FOUND,
    UNAUTHENTICATED,
    UPSTREAM,
    responses,
)
from app.routers.deps import AutoSentrySettingsServiceDep, SentryCommandServiceDep, require_auth
from app.schemas import (
    AutoSentryIn,
    AutoSentryOut,
    CommandLogLimit,
    CommandLogOut,
    SentryCommandIn,
    SentryCommandOut,
    SentryStateOut,
)
from app.services.sentry_state import SentryStateHub

KEEPALIVE_S = 20.0

router = APIRouter(tags=["sentry"], dependencies=[Depends(require_auth)])


@router.post(
    "/vehicle/sentry",
    response_model=SentryCommandOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, NOT_FOUND, CONFLICT, UPSTREAM, INTERNAL),
)
def send_sentry(body: SentryCommandIn, service: SentryCommandServiceDep) -> SentryCommandOut:
    """Sends one Sentry on or off command and reads the state back. The only command the app
    can send (ADR-010). Waits SENTRY_CONFIRM_WAIT_SECONDS (default 15) for the car to report."""
    return service.send(body.desired)


@router.get(
    "/vehicle/sentry/log",
    response_model=CommandLogOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, INTERNAL),
)
def sentry_log(
    service: SentryCommandServiceDep,
    limit: Annotated[CommandLogLimit, Query(json_schema_extra={"minimum": 1, "maximum": 100})] = 20,
) -> CommandLogOut:
    return service.log_items(limit)


@router.get(
    "/vehicle/sentry/auto",
    response_model=AutoSentryOut,
    responses=responses(UNAUTHENTICATED, INTERNAL),
)
def get_auto_sentry(service: AutoSentrySettingsServiceDep) -> AutoSentryOut:
    """The automatic Sentry on toggle and quiet period (ADR-011). Off by default; no car read."""
    return service.view()


@router.put(
    "/vehicle/sentry/auto",
    response_model=AutoSentryOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, CONFLICT, INTERNAL),
)
def put_auto_sentry(body: AutoSentryIn, service: AutoSentrySettingsServiceDep) -> AutoSentryOut:
    """Saves the toggle and the quiet period. Turning it on is 409 unless the host switch, live
    readings and the geofence are all on. Turning it off always works. Sends nothing."""
    return service.save(body)


@router.get(
    "/vehicle/sentry/state",
    response_model=SentryStateOut,
    responses=responses(UNAUTHENTICATED, INTERNAL),
)
def sentry_state(request: Request) -> SentryStateOut:
    """The last Sentry state this API saw after a send. In memory only; no read of the car."""
    hub: SentryStateHub = request.app.state.sentry_hub
    held = hub.current()
    return SentryStateOut(
        state=held[0] if held else None,
        at=held[1] if held else None,
    )


def _event(state: str, at: object) -> bytes:
    iso = at.isoformat().replace("+00:00", "Z")  # type: ignore[attr-defined]
    return f"event: sentry\ndata: {json.dumps({'state': state, 'at': iso})}\n\n".encode()


@router.get(
    "/vehicle/sentry/events",
    response_class=StreamingResponse,
    responses=responses(UNAUTHENTICATED, INTERNAL),
)
async def sentry_events(request: Request) -> StreamingResponse:
    """Server-Sent Events: the held state on connect, then one event per finished send."""
    hub: SentryStateHub = request.app.state.sentry_hub
    sub = hub.subscribe(asyncio.get_running_loop())
    if sub is None:
        raise RateLimited("Too many open streams.", 30)
    token = request.headers.get("authorization", "").partition(" ")[2].strip()
    auth = request.app.state.auth_service
    keepalive = float(getattr(request.app.state, "sentry_keepalive_s", KEEPALIVE_S))

    async def body() -> AsyncIterator[bytes]:
        try:
            held = hub.current()
            if held is not None:
                yield _event(*held)
            while True:
                try:
                    state, at = await asyncio.wait_for(sub.queue.get(), timeout=keepalive)
                except TimeoutError:
                    if not auth.is_valid_token(token):
                        return
                    yield b": keepalive\n\n"
                    continue
                yield _event(state, at)
        finally:
            hub.unsubscribe(sub)

    return StreamingResponse(
        body(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
        background=BackgroundTask(hub.unsubscribe, sub),
    )
