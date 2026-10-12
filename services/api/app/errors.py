"""Domain errors. HTTP-agnostic: the routers package maps these onto the contract's error shape."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FieldIssue:
    field: str
    issue: str


class AppError(Exception):
    code = "internal_error"

    def __init__(self, message: str, details: list[FieldIssue] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or []


class InvalidInput(AppError):
    code = "validation_error"


class Unauthenticated(AppError):
    code = "unauthenticated"


class NotFound(AppError):
    code = "not_found"


class Conflict(AppError):
    code = "conflict"


class RateLimited(AppError):
    code = "rate_limited"

    def __init__(self, message: str, retry_after_seconds: int) -> None:
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds
