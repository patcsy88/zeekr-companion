from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status

from app.openapi_docs import (
    BAD_REQUEST,
    CONFLICT,
    INTERNAL,
    NOT_FOUND,
    UNAUTHENTICATED,
    responses,
)
from app.routers.deps import TyreEventServiceDep, require_auth
from app.schemas import PageLimit, TyreEventCreate, TyreEventOut, TyreEventPage, TyreEventPatch

router = APIRouter(
    prefix="/tyre-events", tags=["tyre-events"], dependencies=[Depends(require_auth)]
)


@router.post(
    "",
    response_model=TyreEventOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        200: {"model": TyreEventOut, "description": "Identical replay of an existing event"},
        **responses(BAD_REQUEST, UNAUTHENTICATED, CONFLICT, INTERNAL),
    },
)
def create_tyre_event(
    body: TyreEventCreate, response: Response, service: TyreEventServiceDep
) -> TyreEventOut:
    event, created = service.create(body)
    if not created:
        response.status_code = status.HTTP_200_OK
    return event


@router.get(
    "",
    response_model=TyreEventPage,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, INTERNAL),
)
def list_tyre_events(
    service: TyreEventServiceDep,
    limit: Annotated[PageLimit, Query(json_schema_extra={"minimum": 1, "maximum": 100})] = 50,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
) -> TyreEventPage:
    return service.list(limit, cursor)


@router.get(
    "/{event_id}",
    response_model=TyreEventOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, NOT_FOUND, INTERNAL),
)
def get_tyre_event(event_id: uuid.UUID, service: TyreEventServiceDep) -> TyreEventOut:
    return service.get(event_id)


@router.patch(
    "/{event_id}",
    response_model=TyreEventOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, NOT_FOUND, INTERNAL),
)
def patch_tyre_event(
    event_id: uuid.UUID, body: TyreEventPatch, service: TyreEventServiceDep
) -> TyreEventOut:
    return service.update(event_id, body)


@router.delete(
    "/{event_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, NOT_FOUND, INTERNAL),
)
def delete_tyre_event(event_id: uuid.UUID, service: TyreEventServiceDep) -> Response:
    service.delete(event_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
