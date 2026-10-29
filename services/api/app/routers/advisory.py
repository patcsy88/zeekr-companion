from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query

from app.openapi_docs import (
    BAD_REQUEST,
    CONFLICT,
    INTERNAL,
    NOT_FOUND,
    UNAUTHENTICATED,
    responses,
)
from app.routers.deps import AdvisoryServiceDep, require_auth
from app.schemas import (
    AdvisoryDecision,
    AdvisoryModelCallList,
    AdvisoryProposalList,
    AdvisoryProposalOut,
    AdvisoryRunOut,
    AdvisoryStatusOut,
    ModelCallLimit,
    ProposalLimit,
)

router = APIRouter(tags=["advisory"], dependencies=[Depends(require_auth)])

StatusFilter = Annotated[Literal["proposed", "accepted", "dismissed", "all"], Query()]


@router.post(
    "/advisory/checks",
    response_model=AdvisoryRunOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, INTERNAL),
)
def run_checks(service: AdvisoryServiceDep) -> AdvisoryRunOut:
    """Runs both checks now. Reads records and stores proposals; changes nothing else."""
    return service.run()


@router.get(
    "/advisory/proposals",
    response_model=AdvisoryProposalList,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, INTERNAL),
)
def list_proposals(
    service: AdvisoryServiceDep,
    status: StatusFilter = "proposed",
    limit: Annotated[ProposalLimit, Query(json_schema_extra={"minimum": 1, "maximum": 200})] = 50,
) -> AdvisoryProposalList:
    return service.list(status, limit)


@router.get(
    "/advisory/proposals/{proposal_id}",
    response_model=AdvisoryProposalOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, NOT_FOUND, INTERNAL),
)
def get_proposal(proposal_id: uuid.UUID, service: AdvisoryServiceDep) -> AdvisoryProposalOut:
    return service.get(proposal_id)


@router.patch(
    "/advisory/proposals/{proposal_id}",
    response_model=AdvisoryProposalOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, NOT_FOUND, CONFLICT, INTERNAL),
)
def decide_proposal(
    proposal_id: uuid.UUID, body: AdvisoryDecision, service: AdvisoryServiceDep
) -> AdvisoryProposalOut:
    """Records the owner's decision on the proposal only. It creates no reminder."""
    return service.decide(proposal_id, body)


@router.get(
    "/advisory/model-calls",
    response_model=AdvisoryModelCallList,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, INTERNAL),
)
def list_model_calls(
    service: AdvisoryServiceDep,
    limit: Annotated[ModelCallLimit, Query(json_schema_extra={"minimum": 1, "maximum": 100})] = 20,
) -> AdvisoryModelCallList:
    return service.model_calls(limit)


@router.get(
    "/advisory/status",
    response_model=AdvisoryStatusOut,
    responses=responses(UNAUTHENTICATED, INTERNAL),
)
def advisory_status(service: AdvisoryServiceDep) -> AdvisoryStatusOut:
    return service.status()
