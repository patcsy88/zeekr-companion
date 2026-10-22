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
from app.routers.deps import ExpenseServiceDep, require_auth
from app.schemas import (
    ExpenseCategory,
    ExpenseCreate,
    ExpenseOut,
    ExpensePage,
    ExpensePatch,
    ExpenseSummary,
    StrictDate,
)

router = APIRouter(prefix="/expenses", tags=["expenses"], dependencies=[Depends(require_auth)])

CategoryFilter = Annotated[ExpenseCategory | None, Query(description="One category")]
FromDate = Annotated[StrictDate | None, Query(alias="from", description="Inclusive YYYY-MM-DD")]
ToDate = Annotated[StrictDate | None, Query(alias="to", description="Inclusive YYYY-MM-DD")]


@router.post(
    "",
    response_model=ExpenseOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        200: {"model": ExpenseOut, "description": "Identical replay of an existing expense"},
        **responses(BAD_REQUEST, UNAUTHENTICATED, CONFLICT, INTERNAL),
    },
)
def create_expense(
    body: ExpenseCreate, response: Response, service: ExpenseServiceDep
) -> ExpenseOut:
    expense, created = service.create(body)
    if not created:
        response.status_code = status.HTTP_200_OK
    return expense


@router.get(
    "",
    response_model=ExpensePage,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, INTERNAL),
)
def list_expenses(
    service: ExpenseServiceDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query(max_length=512)] = None,
    category: CategoryFilter = None,
    date_from: FromDate = None,
    date_to: ToDate = None,
) -> ExpensePage:
    return service.list(limit, cursor, category, date_from, date_to)


@router.get(
    "/summary",
    response_model=ExpenseSummary,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, INTERNAL),
)
def expense_summary(
    service: ExpenseServiceDep,
    category: CategoryFilter = None,
    date_from: FromDate = None,
    date_to: ToDate = None,
) -> ExpenseSummary:
    return service.summary(category, date_from, date_to)


@router.get(
    "/{expense_id}",
    response_model=ExpenseOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, NOT_FOUND, INTERNAL),
)
def get_expense(expense_id: uuid.UUID, service: ExpenseServiceDep) -> ExpenseOut:
    return service.get(expense_id)


@router.patch(
    "/{expense_id}",
    response_model=ExpenseOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, NOT_FOUND, INTERNAL),
)
def patch_expense(
    expense_id: uuid.UUID, body: ExpensePatch, service: ExpenseServiceDep
) -> ExpenseOut:
    return service.update(expense_id, body)


@router.delete(
    "/{expense_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, NOT_FOUND, INTERNAL),
)
def delete_expense(expense_id: uuid.UUID, service: ExpenseServiceDep) -> Response:
    service.delete(expense_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
