from __future__ import annotations

from fastapi import APIRouter, Request

from app.openapi_docs import BAD_REQUEST, INTERNAL, RATE_LIMITED, UNAUTHENTICATED, responses
from app.routers.deps import AuthServiceDep
from app.schemas import TokenRequest, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/token",
    response_model=TokenResponse,
    responses=responses(BAD_REQUEST, UNAUTHENTICATED, RATE_LIMITED, INTERNAL),
)
def create_token(body: TokenRequest, request: Request, auth: AuthServiceDep) -> TokenResponse:
    client = request.client.host if request.client else "unknown"
    return auth.login(body.username, body.password, client)
