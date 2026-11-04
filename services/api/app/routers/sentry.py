from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.openapi_docs import (
    BAD_REQUEST,
    CONFLICT,
    INTERNAL,
    NOT_FOUND,
    UNAUTHENTICATED,
    UPSTREAM,
    responses,
)
from app.routers.deps import SentryCommandServiceDep, require_auth
from app.schemas import CommandLogLimit, CommandLogOut, SentryCommandIn, SentryCommandOut

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
