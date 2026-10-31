from __future__ import annotations

import datetime as dt
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query

from app.openapi_docs import BAD_REQUEST, INTERNAL, UNAUTHENTICATED, responses
from app.routers.deps import LiveVehicleServiceDep, require_auth
from app.schemas import LiveCardOut, LiveDeleteOut, LiveHistoryLimit, LiveHistoryOut, UtcDateTime

router = APIRouter(tags=["live-vehicle"], dependencies=[Depends(require_auth)])


@router.get(
    "/live-vehicle",
    response_model=LiveCardOut,
    responses=responses(UNAUTHENTICATED, INTERNAL),
)
def live_card(service: LiveVehicleServiceDep) -> LiveCardOut:
    """The latest reading. Makes a real Zeekr read only if the spacing window has passed."""
    return service.card()


@router.get(
    "/live-vehicle/history",
    response_model=LiveHistoryOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, INTERNAL),
)
def live_history(
    service: LiveVehicleServiceDep,
    limit: Annotated[
        LiveHistoryLimit, Query(json_schema_extra={"minimum": 1, "maximum": 1000})
    ] = 100,
    since: Annotated[UtcDateTime | None, Query()] = None,
) -> LiveHistoryOut:
    since_utc: dt.datetime | None = since
    return service.history(limit, since_utc)


@router.delete(
    "/live-vehicle/history",
    response_model=LiveDeleteOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, INTERNAL),
)
def live_delete_all(
    service: LiveVehicleServiceDep, confirm: Annotated[Literal["delete_all"], Query()]
) -> LiveDeleteOut:
    """Deletes every stored reading. Needs `confirm=delete_all`."""
    return service.delete_all()
