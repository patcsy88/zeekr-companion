from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.errors import Unauthenticated
from app.repositories.reminders import ReminderRepository
from app.repositories.service_records import ServiceRecordRepository
from app.repositories.vehicle import VehicleRepository
from app.services.auth import AuthService
from app.services.reminders import ReminderService
from app.services.service_records import ServiceRecordService
from app.services.vehicle import VehicleService


def get_session(request: Request) -> Iterator[Session]:
    with request.app.state.session_factory() as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


def get_auth_service(request: Request) -> AuthService:
    service: AuthService = request.app.state.auth_service
    return service


AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]


def require_auth(request: Request, auth: AuthServiceDep) -> None:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token or not auth.is_valid_token(token.strip()):
        raise Unauthenticated("Missing or invalid token.")


def get_vehicle_service(session: SessionDep) -> VehicleService:
    return VehicleService(VehicleRepository(session))


def get_service_record_service(session: SessionDep) -> ServiceRecordService:
    return ServiceRecordService(ServiceRecordRepository(session))


def get_reminder_service(session: SessionDep) -> ReminderService:
    return ReminderService(ReminderRepository(session), ServiceRecordRepository(session))


VehicleServiceDep = Annotated[VehicleService, Depends(get_vehicle_service)]
ServiceRecordServiceDep = Annotated[ServiceRecordService, Depends(get_service_record_service)]
ReminderServiceDep = Annotated[ReminderService, Depends(get_reminder_service)]
