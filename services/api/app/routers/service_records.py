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
from app.routers.deps import ServiceRecordServiceDep, require_auth
from app.schemas import (
    ServiceRecordCreate,
    ServiceRecordOut,
    ServiceRecordPage,
    ServiceRecordPatch,
)

router = APIRouter(
    prefix="/service-records", tags=["service-records"], dependencies=[Depends(require_auth)]
)


@router.post(
    "",
    response_model=ServiceRecordOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        200: {"model": ServiceRecordOut, "description": "Identical replay of an existing record"},
        **responses(BAD_REQUEST, UNAUTHENTICATED, CONFLICT, INTERNAL),
    },
)
def create_record(
    body: ServiceRecordCreate, response: Response, service: ServiceRecordServiceDep
) -> ServiceRecordOut:
    record, created = service.create(body)
    if not created:
        response.status_code = status.HTTP_200_OK  # idempotent replay
    return record


@router.get(
    "",
    response_model=ServiceRecordPage,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, INTERNAL),
)
def list_records(
    service: ServiceRecordServiceDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
) -> ServiceRecordPage:
    return service.list(limit, cursor)


@router.get(
    "/{record_id}",
    response_model=ServiceRecordOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, NOT_FOUND, INTERNAL),
)
def get_record(record_id: uuid.UUID, service: ServiceRecordServiceDep) -> ServiceRecordOut:
    return service.get(record_id)


@router.patch(
    "/{record_id}",
    response_model=ServiceRecordOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, NOT_FOUND, INTERNAL),
)
def patch_record(
    record_id: uuid.UUID, body: ServiceRecordPatch, service: ServiceRecordServiceDep
) -> ServiceRecordOut:
    return service.update(record_id, body)


@router.delete(
    "/{record_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, NOT_FOUND, INTERNAL),
)
def delete_record(record_id: uuid.UUID, service: ServiceRecordServiceDep) -> Response:
    service.delete(record_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
