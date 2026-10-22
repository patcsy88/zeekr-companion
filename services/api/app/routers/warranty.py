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
from app.routers.deps import WarrantyClaimServiceDep, WarrantyCoverageServiceDep, require_auth
from app.schemas import (
    StrictDate,
    WarrantyClaimCreate,
    WarrantyClaimList,
    WarrantyClaimOut,
    WarrantyClaimPatch,
    WarrantyCoverageCreate,
    WarrantyCoverageList,
    WarrantyCoverageOut,
    WarrantyCoveragePatch,
    WarrantyTemplateList,
)
from app.services.warranty_templates import get_templates

router = APIRouter(tags=["warranty"], dependencies=[Depends(require_auth)])

Today = Annotated[
    StrictDate | None,
    Query(description="Date (YYYY-MM-DD) used for status; defaults to KL today"),
]


@router.post(
    "/warranty-coverages",
    response_model=WarrantyCoverageOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        200: {"model": WarrantyCoverageOut, "description": "Identical replay of an existing one"},
        **responses(BAD_REQUEST, UNAUTHENTICATED, CONFLICT, INTERNAL),
    },
)
def create_coverage(
    body: WarrantyCoverageCreate, response: Response, service: WarrantyCoverageServiceDep
) -> WarrantyCoverageOut:
    coverage, created = service.create(body)
    if not created:
        response.status_code = status.HTTP_200_OK
    return coverage


@router.get(
    "/warranty-coverages",
    response_model=WarrantyCoverageList,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, INTERNAL),
)
def list_coverages(
    service: WarrantyCoverageServiceDep, today: Today = None
) -> WarrantyCoverageList:
    return service.list(today)


@router.get(
    "/warranty-coverages/{coverage_id}",
    response_model=WarrantyCoverageOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, NOT_FOUND, INTERNAL),
)
def get_coverage(
    coverage_id: uuid.UUID, service: WarrantyCoverageServiceDep, today: Today = None
) -> WarrantyCoverageOut:
    return service.get(coverage_id, today)


@router.patch(
    "/warranty-coverages/{coverage_id}",
    response_model=WarrantyCoverageOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, NOT_FOUND, INTERNAL),
)
def patch_coverage(
    coverage_id: uuid.UUID, body: WarrantyCoveragePatch, service: WarrantyCoverageServiceDep
) -> WarrantyCoverageOut:
    return service.update(coverage_id, body)


@router.delete(
    "/warranty-coverages/{coverage_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, NOT_FOUND, INTERNAL),
)
def delete_coverage(coverage_id: uuid.UUID, service: WarrantyCoverageServiceDep) -> Response:
    service.delete(coverage_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/warranty-claims",
    response_model=WarrantyClaimOut,
    status_code=status.HTTP_201_CREATED,
    responses={
        200: {"model": WarrantyClaimOut, "description": "Identical replay of an existing claim"},
        **responses(BAD_REQUEST, UNAUTHENTICATED, CONFLICT, INTERNAL),
    },
)
def create_claim(
    body: WarrantyClaimCreate, response: Response, service: WarrantyClaimServiceDep
) -> WarrantyClaimOut:
    claim, created = service.create(body)
    if not created:
        response.status_code = status.HTTP_200_OK
    return claim


@router.get(
    "/warranty-claims",
    response_model=WarrantyClaimList,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, INTERNAL),
)
def list_claims(
    service: WarrantyClaimServiceDep, coverage_id: uuid.UUID | None = None
) -> WarrantyClaimList:
    return service.list(coverage_id)


@router.get(
    "/warranty-claims/{claim_id}",
    response_model=WarrantyClaimOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, NOT_FOUND, INTERNAL),
)
def get_claim(claim_id: uuid.UUID, service: WarrantyClaimServiceDep) -> WarrantyClaimOut:
    return service.get(claim_id)


@router.patch(
    "/warranty-claims/{claim_id}",
    response_model=WarrantyClaimOut,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, NOT_FOUND, INTERNAL),
)
def patch_claim(
    claim_id: uuid.UUID, body: WarrantyClaimPatch, service: WarrantyClaimServiceDep
) -> WarrantyClaimOut:
    return service.update(claim_id, body)


@router.delete(
    "/warranty-claims/{claim_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, NOT_FOUND, INTERNAL),
)
def delete_claim(claim_id: uuid.UUID, service: WarrantyClaimServiceDep) -> Response:
    service.delete(claim_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/warranty-templates",
    response_model=WarrantyTemplateList,
    response_model_exclude_unset=True,
    responses=responses(UNAUTHENTICATED, INTERNAL),
)
def list_warranty_templates() -> WarrantyTemplateList:
    """Read-only suggestions. Creates nothing; accepting means ordinary POST calls."""
    return get_templates()
