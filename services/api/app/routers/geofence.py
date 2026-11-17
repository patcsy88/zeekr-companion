from __future__ import annotations

from fastapi import APIRouter, Depends

from app.openapi_docs import BAD_REQUEST, INTERNAL, UNAUTHENTICATED, responses
from app.routers.deps import GeofenceMapServiceDep, GeofenceSettingsServiceDep, require_auth
from app.schemas import GeofenceMapOut, GeofenceSettingsIn, GeofenceSettingsOut

router = APIRouter(tags=["geofence"], dependencies=[Depends(require_auth)])


@router.get(
    "/geofence/settings",
    response_model=GeofenceSettingsOut,
    responses=responses(UNAUTHENTICATED, INTERNAL),
)
def get_settings(service: GeofenceSettingsServiceDep) -> GeofenceSettingsOut:
    """The settings in force, where each value comes from, and the limits. Never the home point."""
    return service.view()


@router.put(
    "/geofence/settings",
    response_model=GeofenceSettingsOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, INTERNAL),
)
def put_settings(
    body: GeofenceSettingsIn, service: GeofenceSettingsServiceDep
) -> GeofenceSettingsOut:
    """Saves all five values. They apply at the next check. Nothing is sent to the car."""
    return service.save(body)


@router.delete(
    "/geofence/settings",
    response_model=GeofenceSettingsOut,
    responses=responses(UNAUTHENTICATED, INTERNAL),
)
def reset_settings(service: GeofenceSettingsServiceDep) -> GeofenceSettingsOut:
    """Removes the saved row so the host values apply again. Safe to repeat."""
    return service.reset()


@router.get(
    "/geofence/map",
    response_model=GeofenceMapOut,
    responses=responses(UNAUTHENTICATED, INTERNAL),
)
def get_map(service: GeofenceMapServiceDep) -> GeofenceMapOut:
    """The car's offset from home (km, rounded to 0.1) from the reading already held. Never a
    coordinate. Never calls the car."""
    return service.view()
