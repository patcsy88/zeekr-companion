from __future__ import annotations

from fastapi import APIRouter, Depends

from app.openapi_docs import BAD_REQUEST, INTERNAL, NOT_FOUND, UNAUTHENTICATED, responses
from app.routers.deps import VehicleServiceDep, require_auth
from app.schemas import VehicleIn, VehicleOut

router = APIRouter(prefix="/vehicle", tags=["vehicle"], dependencies=[Depends(require_auth)])


@router.put(
    "",
    response_model=VehicleOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, INTERNAL),
)
def put_vehicle(body: VehicleIn, service: VehicleServiceDep) -> VehicleOut:
    return service.put(body)


@router.get(
    "",
    response_model=VehicleOut,
    responses=responses(UNAUTHENTICATED, NOT_FOUND, INTERNAL),
)
def get_vehicle(service: VehicleServiceDep) -> VehicleOut:
    return service.get()
