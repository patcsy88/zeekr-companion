"""Settings loaded from environment variables. No secrets have defaults."""

from __future__ import annotations

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.dburl import normalise_database_url

_MIN_DISTINCT_CHARS = 12


def _is_placeholder(value: str) -> bool:
    return "change-me" in value.lower() or "changeme" in value.lower()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore", hide_input_in_errors=True)

    database_url: SecretStr
    token_secret: SecretStr
    cors_allowed_origins: str = ""
    token_ttl_seconds: int = Field(default=3600, ge=60, le=86_400)
    login_max_failures: int = Field(default=5, ge=1, le=100)
    login_window_seconds: int = Field(default=900, ge=10, le=86_400)
    sentry_dsn: SecretStr | None = None
    sentry_environment: str = Field(default="production", max_length=32)

    @field_validator("sentry_dsn", mode="before")
    @classmethod
    def _empty_dsn_is_off(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value

    @field_validator("database_url")
    @classmethod
    def _normalise_database_url(cls, value: SecretStr) -> SecretStr:
        return SecretStr(normalise_database_url(value.get_secret_value()))

    @field_validator("token_secret")
    @classmethod
    def _check_secret(cls, value: SecretStr) -> SecretStr:
        secret = value.get_secret_value()
        if len(secret) < 32:
            raise ValueError("TOKEN_SECRET must be at least 32 characters")
        if _is_placeholder(secret):
            raise ValueError("TOKEN_SECRET is a placeholder; generate a real random secret")
        if len(set(secret)) < _MIN_DISTINCT_CHARS:
            raise ValueError("TOKEN_SECRET is too repetitive; generate a real random secret")
        return value

    @field_validator("cors_allowed_origins")
    @classmethod
    def _check_origins(cls, value: str) -> str:
        if "*" in value:
            raise ValueError("CORS_ALLOWED_ORIGINS must list explicit origins, not '*'")
        return value

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_allowed_origins.split(",") if o.strip()]
