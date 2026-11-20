from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, Response

from app.openapi_docs import BAD_REQUEST, CONFLICT, INTERNAL, UNAUTHENTICATED, responses
from app.routers.deps import PushServiceDep, require_auth
from app.schemas import (
    PushConfigOut,
    PushDevicesOut,
    PushSubscribeIn,
    PushTestOut,
    PushUnsubscribeIn,
)

router = APIRouter(tags=["push"], dependencies=[Depends(require_auth)])


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


@router.get(
    "/push/config",
    response_model=PushConfigOut,
    responses=responses(UNAUTHENTICATED, INTERNAL),
)
def get_config(service: PushServiceDep, response: Response) -> PushConfigOut:
    """Is push set up on the host, the public key, and how many phones are saved."""
    response.headers["Cache-Control"] = "no-store"
    return service.config()


@router.post(
    "/push/subscriptions",
    response_model=PushDevicesOut,
    status_code=201,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, CONFLICT, INTERNAL),
)
def subscribe(body: PushSubscribeIn, service: PushServiceDep, response: Response) -> PushDevicesOut:
    """Saves this phone (201), or refreshes its keys when it is already saved (200). The address
    and keys are never returned."""
    response.headers["Cache-Control"] = "no-store"
    created, out = service.subscribe(body, _now())
    if not created:
        response.status_code = 200
    return out


@router.delete(
    "/push/subscriptions",
    response_model=PushDevicesOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, INTERNAL),
)
def unsubscribe(
    body: PushUnsubscribeIn, service: PushServiceDep, response: Response
) -> PushDevicesOut:
    """Removes this phone. An unknown address is also 200, so it is safe to repeat."""
    response.headers["Cache-Control"] = "no-store"
    return service.unsubscribe(body.endpoint)


@router.post(
    "/push/test",
    response_model=PushTestOut,
    responses=responses(UNAUTHENTICATED, CONFLICT, INTERNAL),
)
def send_test(service: PushServiceDep, response: Response) -> PushTestOut:
    """Sends one fixed test message to every saved phone. 409 when push is not set up."""
    response.headers["Cache-Control"] = "no-store"
    return service.test(_now())
