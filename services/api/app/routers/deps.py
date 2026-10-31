from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.errors import Unauthenticated
from app.repositories.advisory import AdvisoryRepository
from app.repositories.expenses import ExpenseRepository
from app.repositories.live_readings import LiveReadingRepository
from app.repositories.reminders import ReminderRepository
from app.repositories.service_records import ServiceRecordRepository
from app.repositories.vehicle import VehicleRepository
from app.repositories.warranty import WarrantyClaimRepository, WarrantyCoverageRepository
from app.services.advisory import AdvisoryService
from app.services.auth import AuthService
from app.services.expenses import ExpenseService
from app.services.live_vehicle import LiveVehicleService
from app.services.reminders import ReminderService
from app.services.service_records import ServiceRecordService
from app.services.vehicle import VehicleService
from app.services.warranty import WarrantyClaimService, WarrantyCoverageService


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


def get_expense_service(session: SessionDep) -> ExpenseService:
    return ExpenseService(ExpenseRepository(session))


def get_warranty_coverage_service(session: SessionDep) -> WarrantyCoverageService:
    return WarrantyCoverageService(
        WarrantyCoverageRepository(session), ServiceRecordRepository(session)
    )


def get_warranty_claim_service(session: SessionDep) -> WarrantyClaimService:
    return WarrantyClaimService(WarrantyClaimRepository(session))


def get_advisory_service(request: Request, session: SessionDep) -> AdvisoryService:
    return AdvisoryService(
        AdvisoryRepository(session),
        ServiceRecordRepository(session),
        request.app.state.settings,
        request.app.state.reasoning_model,
    )


def get_live_vehicle_service(request: Request, session: SessionDep) -> LiveVehicleService:
    return LiveVehicleService(
        LiveReadingRepository(session),
        request.app.state.live_telemetry,
        request.app.state.settings,
        request.app.state.live_lock,
    )


VehicleServiceDep = Annotated[VehicleService, Depends(get_vehicle_service)]
ServiceRecordServiceDep = Annotated[ServiceRecordService, Depends(get_service_record_service)]
ReminderServiceDep = Annotated[ReminderService, Depends(get_reminder_service)]
ExpenseServiceDep = Annotated[ExpenseService, Depends(get_expense_service)]
WarrantyCoverageServiceDep = Annotated[
    WarrantyCoverageService, Depends(get_warranty_coverage_service)
]
WarrantyClaimServiceDep = Annotated[WarrantyClaimService, Depends(get_warranty_claim_service)]
AdvisoryServiceDep = Annotated[AdvisoryService, Depends(get_advisory_service)]
LiveVehicleServiceDep = Annotated[LiveVehicleService, Depends(get_live_vehicle_service)]
