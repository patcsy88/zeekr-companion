"""Application factory."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import Settings
from app.db import create_db_engine, create_session_factory
from app.errors import AppError, Conflict, InvalidInput, NotFound, RateLimited, Unauthenticated
from app.middleware import BodyLimitMiddleware, NoStoreMiddleware
from app.openapi_docs import install as install_openapi_docs
from app.routers import auth, expenses, reminders, service_records, vehicle, warranty
from app.services.auth import AuthService

logger = logging.getLogger("zeekr.api")

_STATUS: dict[type[AppError], int] = {
    InvalidInput: 400,
    Unauthenticated: 401,
    NotFound: 404,
    Conflict: 409,
    RateLimited: 429,
}


def _error(
    status: int,
    code: str,
    message: str,
    details: list[dict[str, str]] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    body = {"error": {"code": code, "message": message, "details": details or []}}
    return JSONResponse(status_code=status, content=body, headers=headers)


def _field_name(loc: tuple[Any, ...]) -> str:
    parts = [str(p) for p in loc if p not in ("body", "query", "path")]
    return ".".join(parts) or "body"


async def _on_app_error(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, AppError):
        return await _on_unexpected(request, exc)
    headers: dict[str, str] = {}
    if isinstance(exc, Unauthenticated):
        headers["WWW-Authenticate"] = "Bearer"
    if isinstance(exc, RateLimited):
        headers["Retry-After"] = str(exc.retry_after_seconds)
    details = [{"field": d.field, "issue": d.issue} for d in exc.details]
    return _error(_STATUS.get(type(exc), 500), exc.code, exc.message, details, headers)


async def _on_validation_error(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, RequestValidationError):
        return await _on_unexpected(request, exc)
    details = []
    for e in exc.errors():
        if e["type"] == "json_invalid":
            # The loc is ("body", <character offset>); the offset is not a field name.
            details.append({"field": "body", "issue": "request body is not valid JSON"})
            continue
        details.append(
            {
                "field": _field_name(tuple(e["loc"])),
                "issue": str(e["msg"]).removeprefix("Value error, "),
            }
        )
    return _error(400, "validation_error", "Request failed validation.", details)


async def _on_http_error(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, StarletteHTTPException):
        return await _on_unexpected(request, exc)
    if exc.status_code == 400:
        # FastAPI raises a bare 400 when the body cannot be decoded (for example invalid UTF-8).
        # The contract's only 400 is validation_error.
        return _error(
            400,
            "validation_error",
            "Request failed validation.",
            [{"field": "body", "issue": "request body is not valid UTF-8 JSON"}],
        )
    if exc.status_code == 404:
        return _error(404, "not_found", "Resource not found.")
    if exc.status_code == 405:
        return _error(405, "method_not_allowed", "Method not allowed.")
    return _error(exc.status_code, "http_error", str(exc.detail))


async def _on_unexpected(_: Request, exc: Exception) -> JSONResponse:
    logger.error("unhandled error", exc_info=exc)
    return _error(500, "internal_error", "Internal server error.")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    engine = create_db_engine(settings.database_url.get_secret_value())

    app = FastAPI(
        title="Zeekr Companion API",
        version="0.1.0",
        # Docs and schema would be unauthenticated; the schema is exported by a CLI instead.
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = create_session_factory(engine)
    app.state.auth_service = AuthService(
        session_factory=app.state.session_factory,
        token_secret=settings.token_secret.get_secret_value(),
        token_ttl_seconds=settings.token_ttl_seconds,
        max_failures=settings.login_max_failures,
        window_seconds=settings.login_window_seconds,
    )

    app.add_middleware(BodyLimitMiddleware)

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            allow_headers=["Authorization", "Content-Type"],
            allow_credentials=False,
        )

    app.add_middleware(NoStoreMiddleware)  # outermost: covers CORS and error responses too

    app.add_exception_handler(AppError, _on_app_error)
    app.add_exception_handler(RequestValidationError, _on_validation_error)
    app.add_exception_handler(StarletteHTTPException, _on_http_error)
    app.add_exception_handler(Exception, _on_unexpected)

    @app.get("/health", tags=["health"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    install_openapi_docs(app)
    for router in (
        auth.router,
        vehicle.router,
        service_records.router,
        reminders.router,
        expenses.router,
        warranty.router,
    ):
        app.include_router(router, prefix="/api/v1")
    return app
