"""The exported OpenAPI schema (source of packages/shared-types) documents the contract's errors."""

from __future__ import annotations

from typing import Any

import pytest

from app.cli.export_openapi import build_schema


@pytest.fixture(scope="module")
def schema() -> dict[str, Any]:
    return build_schema()


def test_no_422_and_no_fastapi_validation_models(schema: dict[str, Any]) -> None:
    for item in schema["paths"].values():
        for op in item.values():
            assert "422" not in op["responses"]
    assert "HTTPValidationError" not in schema["components"]["schemas"]


def test_login_documents_401_429_with_retry_after(schema: dict[str, Any]) -> None:
    responses = schema["paths"]["/api/v1/auth/token"]["post"]["responses"]
    assert {"200", "400", "401", "429", "500"} <= set(responses)
    header = responses["429"]["headers"]["Retry-After"]
    assert header["required"] is True
    assert header["schema"]["type"] == "integer"
    ref = responses["429"]["content"]["application/json"]["schema"]["$ref"]
    assert ref.endswith("/ErrorResponse")


def test_error_code_enum_matches_contract(schema: dict[str, Any]) -> None:
    codes = schema["components"]["schemas"]["ErrorBody"]["properties"]["code"]["enum"]
    assert set(codes) == {
        "validation_error",
        "unauthenticated",
        "not_found",
        "method_not_allowed",
        "conflict",
        "rate_limited",
        "internal_error",
    }


def test_only_health_and_login_are_unauthenticated(schema: dict[str, Any]) -> None:
    open_ops = {
        (method, path)
        for path, item in schema["paths"].items()
        for method, op in item.items()
        if "security" not in op
    }
    assert open_ops == {("get", "/health"), ("post", "/api/v1/auth/token")}


REMINDER_ROUTES = {
    ("post", "/api/v1/reminders"),
    ("get", "/api/v1/reminders"),
    ("get", "/api/v1/reminders/{reminder_id}"),
    ("patch", "/api/v1/reminders/{reminder_id}"),
    ("delete", "/api/v1/reminders/{reminder_id}"),
    ("get", "/api/v1/reminder-templates"),
}


def test_reminder_routes_exist_need_auth_and_document_errors(schema: dict[str, Any]) -> None:
    found = {
        (method, path)
        for path, item in schema["paths"].items()
        for method in item
        if "reminder" in path
    }
    assert found == REMINDER_ROUTES
    for method, path in REMINDER_ROUTES:
        op = schema["paths"][path][method]
        assert op["security"] == [{"bearerAuth": []}]
        assert "401" in op["responses"]
        assert "422" not in op["responses"]
    assert "200" in schema["paths"]["/api/v1/reminders"]["post"]["responses"]
    assert "201" in schema["paths"]["/api/v1/reminders"]["post"]["responses"]
    assert "409" in schema["paths"]["/api/v1/reminders"]["post"]["responses"]
    assert "204" in schema["paths"]["/api/v1/reminders/{reminder_id}"]["delete"]["responses"]


def test_reminder_input_models_forbid_extra_fields(schema: dict[str, Any]) -> None:
    for name in ("ReminderCreate", "ReminderPatch"):
        assert schema["components"]["schemas"][name]["additionalProperties"] is False
    props = schema["components"]["schemas"]["ReminderCreate"]["properties"]
    assert "status" not in props
    assert "completed_on" not in props
