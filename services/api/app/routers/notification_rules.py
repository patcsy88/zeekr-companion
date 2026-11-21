from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status

from app.openapi_docs import (
    BAD_REQUEST,
    CONFLICT,
    INTERNAL,
    NOT_FOUND,
    UNAUTHENTICATED,
    responses,
)
from app.routers.deps import NotificationRuleServiceDep, require_auth
from app.schemas import NotificationRuleIn, NotificationRuleOptionsOut, NotificationRuleOut

router = APIRouter(tags=["notification-rules"], dependencies=[Depends(require_auth)])


@router.get(
    "/notification-rules/options",
    response_model=NotificationRuleOptionsOut,
    responses=responses(UNAUTHENTICATED, INTERNAL),
)
def get_options(
    service: NotificationRuleServiceDep, response: Response
) -> NotificationRuleOptionsOut:
    """The fields, codes, labels and limits the screen offers, and whether push is set up."""
    response.headers["Cache-Control"] = "no-store"
    return service.options()


@router.get(
    "/notification-rules",
    response_model=list[NotificationRuleOut],
    responses=responses(UNAUTHENTICATED, INTERNAL),
)
def list_rules(
    service: NotificationRuleServiceDep, response: Response
) -> list[NotificationRuleOut]:
    response.headers["Cache-Control"] = "no-store"
    return service.list()


@router.post(
    "/notification-rules",
    response_model=NotificationRuleOut,
    status_code=status.HTTP_201_CREATED,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, CONFLICT, INTERNAL),
)
def create_rule(
    body: NotificationRuleIn, service: NotificationRuleServiceDep, response: Response
) -> NotificationRuleOut:
    """Saves a rule (201). 409 when 5 rules already exist."""
    response.headers["Cache-Control"] = "no-store"
    return service.create(body)


@router.put(
    "/notification-rules/{rule_id}",
    response_model=NotificationRuleOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, NOT_FOUND, INTERNAL),
)
def replace_rule(
    rule_id: uuid.UUID,
    body: NotificationRuleIn,
    service: NotificationRuleServiceDep,
    response: Response,
) -> NotificationRuleOut:
    response.headers["Cache-Control"] = "no-store"
    return service.replace(rule_id, body)


@router.delete(
    "/notification-rules/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, NOT_FOUND, INTERNAL),
)
def delete_rule(rule_id: uuid.UUID, service: NotificationRuleServiceDep) -> Response:
    service.delete(rule_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
