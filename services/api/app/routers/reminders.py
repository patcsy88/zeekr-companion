from __future__ import annotations

import datetime as dt
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
from app.routers.deps import ReminderServiceDep, require_auth
from app.schemas import (
    ReminderCreate,
    ReminderList,
    ReminderOut,
    ReminderPatch,
    ReminderTemplateList,
)
from app.services.reminder_templates import get_templates

router = APIRouter(tags=["reminders"], dependencies=[Depends(require_auth)])

Today = Annotated[dt.date | None, Query(description="Date used for status; defaults to KL today")]


@router.post(
    "/reminders",
    response_model=ReminderOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        200: {"model": ReminderOut, "description": "Identical replay of an existing reminder"},
        **responses(BAD_REQUEST, UNAUTHENTICATED, CONFLICT, INTERNAL),
    },
)
def create_reminder(
    body: ReminderCreate, response: Response, service: ReminderServiceDep
) -> ReminderOut:
    reminder, created = service.create(body)
    if not created:
        response.status_code = status.HTTP_200_OK
    return reminder


@router.get(
    "/reminders",
    response_model=ReminderList,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, INTERNAL),
)
def list_reminders(
    service: ReminderServiceDep, today: Today = None, include_completed: bool = False
) -> ReminderList:
    return service.list(today, include_completed)


@router.get(
    "/reminders/{reminder_id}",
    response_model=ReminderOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, NOT_FOUND, INTERNAL),
)
def get_reminder(
    reminder_id: uuid.UUID, service: ReminderServiceDep, today: Today = None
) -> ReminderOut:
    return service.get(reminder_id, today)


@router.patch(
    "/reminders/{reminder_id}",
    response_model=ReminderOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, NOT_FOUND, INTERNAL),
)
def patch_reminder(
    reminder_id: uuid.UUID, body: ReminderPatch, service: ReminderServiceDep
) -> ReminderOut:
    return service.update(reminder_id, body)


@router.delete(
    "/reminders/{reminder_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, NOT_FOUND, INTERNAL),
)
def delete_reminder(reminder_id: uuid.UUID, service: ReminderServiceDep) -> Response:
    service.delete(reminder_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/reminder-templates",
    response_model=ReminderTemplateList,
    responses=responses(UNAUTHENTICATED, INTERNAL),
)
def list_reminder_templates() -> ReminderTemplateList:
    """Read-only suggestions. Creates nothing; accepting means ordinary POST /reminders calls."""
    return get_templates()
