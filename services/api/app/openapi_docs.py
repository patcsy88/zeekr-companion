"""OpenAPI documentation of the contract's error responses and bearer auth.

The runtime error handlers (app.main) already return the contract's error shape. FastAPI would
otherwise document a `422 HTTPValidationError` that this API never returns, and nothing for
401/404/409/429. These helpers make the exported schema (source of packages/shared-types) match.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi

from app.schemas import ErrorResponse

_BEARER = "bearerAuth"
_PUBLIC = {("get", "/health"), ("post", "/api/v1/auth/token")}


def _err(description: str, headers: dict[str, Any] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"model": ErrorResponse, "description": description}
    if headers:
        out["headers"] = headers
    return out


BAD_REQUEST = {400: _err("validation_error: body or parameters failed validation")}
UNAUTHENTICATED = {401: _err("unauthenticated: missing or invalid token")}
NOT_FOUND = {404: _err("not_found: resource does not exist")}
CONFLICT = {409: _err("conflict: same id with different content")}
RATE_LIMITED = {
    429: _err(
        "rate_limited: too many failed login attempts (hard lockout, even with the right password)",
        {
            "Retry-After": {
                "description": "Seconds until another attempt is allowed",
                "required": True,
                "schema": {"type": "integer"},
            }
        },
    )
}
INTERNAL = {500: _err("internal_error: unexpected server error; details is empty")}


def responses(*groups: dict[int, dict[str, Any]]) -> dict[int | str, dict[str, Any]]:
    merged: dict[int | str, dict[str, Any]] = {}
    for group in groups:
        for status, body in group.items():
            merged[status] = body
    return merged


def install(app: FastAPI) -> None:
    """Replace app.openapi with a version that follows the contract."""

    def build() -> dict[str, Any]:
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(
            title=app.title, version=app.version, routes=app.routes, summary=app.summary
        )
        components = schema.setdefault("components", {})
        components.setdefault("securitySchemes", {})[_BEARER] = {
            "type": "http",
            "scheme": "bearer",
            "description": "Access token from POST /api/v1/auth/token",
        }
        for path, item in schema["paths"].items():
            for method, op in item.items():
                # Validation failures are 400 validation_error in this API, never 422.
                op["responses"].pop("422", None)
                if (method, path) not in _PUBLIC:
                    op["security"] = [{_BEARER: []}]
        schemas = components.get("schemas", {})
        schemas.pop("HTTPValidationError", None)
        schemas.pop("ValidationError", None)
        app.openapi_schema = schema
        return schema

    app.openapi = build  # type: ignore[method-assign]
