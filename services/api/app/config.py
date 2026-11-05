"""Settings loaded from environment variables. No secrets have defaults."""

from __future__ import annotations

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.dburl import normalise_database_url

_MIN_DISTINCT_CHARS = 12

ZEEKR_LIVE_FIELDS = (
    "zeekr_username",
    "zeekr_password",
    "zeekr_country_code",
    "zeekr_hmac_access_key",
    "zeekr_hmac_secret_key",
    "zeekr_password_public_key",
    "zeekr_prod_secret",
    "zeekr_vin_key",
    "zeekr_vin_iv",
)


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
    advisory_model_enabled: bool = False
    advisory_model_id: str | None = Field(default=None, max_length=100)
    advisory_monthly_call_limit: int = Field(default=60, ge=1, le=1000)

    anthropic_api_key: SecretStr | None = None
    # Optional Anthropic-compatible endpoint (host `.env` only). Empty means api.anthropic.com.
    advisory_model_base_url: str | None = Field(default=None, max_length=200)
    # Deliberately not named LANGSMITH_*: the library reads those itself and would trace unscrubbed.
    advisory_tracing_enabled: bool = False
    advisory_tracing_api_key: SecretStr | None = None
    advisory_tracing_api_url: str | None = Field(default=None, max_length=200)

    # Live Zeekr readings (ADR-009). Off by default. The values live in the host `infra/.env` only.
    zeekr_live_enabled: bool = False
    # Spacing between real Zeekr reads and the page's refresh interval. Below 5 refuses to start.
    zeekr_live_interval_minutes: int = Field(default=5, ge=5, le=1440)
    # Seconds from the Sentry command to the read-back (ADR-010). Outside 5 to 30 refuses to start.
    sentry_confirm_wait_seconds: int = Field(default=15, ge=5, le=30)
    zeekr_username: SecretStr | None = None
    zeekr_password: SecretStr | None = None
    zeekr_country_code: str | None = Field(default=None, max_length=8)
    zeekr_hmac_access_key: SecretStr | None = None
    zeekr_hmac_secret_key: SecretStr | None = None
    zeekr_password_public_key: SecretStr | None = None
    zeekr_prod_secret: SecretStr | None = None
    zeekr_vin_key: SecretStr | None = None
    zeekr_vin_iv: SecretStr | None = None

    # Geofence alert (Piece B, owner-approved 2026-11-05). Off by default. The home query and the
    # coordinates live in the host `infra/.env` only, and are never logged or returned by the API.
    geofence_enabled: bool = False
    geofence_home_query: SecretStr | None = None
    geofence_home_lat: SecretStr | None = None
    geofence_home_lon: SecretStr | None = None
    geofence_radius_km: float = Field(default=5.0, gt=0, le=100)
    geofence_interval_minutes: int = Field(default=5, ge=5, le=1440)
    geofence_stale_minutes: int = Field(default=30, ge=1, le=1440)
    # Where the one-time lookup result is kept. A writable volume on the host (see compose).
    geofence_state_dir: str = Field(default="/var/lib/zeekr-geofence", max_length=200)

    @field_validator(
        "anthropic_api_key",
        "advisory_model_base_url",
        "advisory_tracing_api_key",
        "advisory_tracing_api_url",
        "zeekr_username",
        "zeekr_password",
        "zeekr_country_code",
        "zeekr_hmac_access_key",
        "zeekr_hmac_secret_key",
        "zeekr_password_public_key",
        "zeekr_prod_secret",
        "zeekr_vin_key",
        "zeekr_vin_iv",
        "geofence_home_query",
        "geofence_home_lat",
        "geofence_home_lon",
        mode="before",
    )
    @classmethod
    def _empty_is_unset(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value

    @model_validator(mode="after")
    def _live_zeekr_needs_all_its_settings(self) -> Settings:
        if self.zeekr_live_enabled:
            missing = [name.upper() for name in ZEEKR_LIVE_FIELDS if getattr(self, name) is None]
            if missing:
                raise ValueError("ZEEKR_LIVE_ENABLED is true but not set: " + ", ".join(missing))
        return self

    @model_validator(mode="after")
    def _geofence_needs_its_settings(self) -> Settings:
        lat, lon = self.geofence_home_lat, self.geofence_home_lon
        if (lat is None) != (lon is None):
            raise ValueError("GEOFENCE_HOME_LAT and GEOFENCE_HOME_LON must be set together")
        if lat is not None and lon is not None:
            for name, secret, limit in (
                ("GEOFENCE_HOME_LAT", lat, 90.0),
                ("GEOFENCE_HOME_LON", lon, 180.0),
            ):
                try:
                    number = float(secret.get_secret_value())
                except ValueError:
                    raise ValueError(f"{name} must be a number") from None
                if not -limit <= number <= limit:
                    raise ValueError(f"{name} is out of range")
        if self.geofence_enabled:
            if not self.zeekr_live_enabled:
                raise ValueError("GEOFENCE_ENABLED needs ZEEKR_LIVE_ENABLED to be true")
            if self.geofence_home_query is None and lat is None:
                raise ValueError(
                    "GEOFENCE_ENABLED is true but neither GEOFENCE_HOME_QUERY nor "
                    "GEOFENCE_HOME_LAT and GEOFENCE_HOME_LON is set"
                )
        return self

    @field_validator("advisory_model_base_url")
    @classmethod
    def _check_base_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        url = value.strip().rstrip("/")
        if not url.startswith(("http://", "https://")):
            raise ValueError("ADVISORY_MODEL_BASE_URL must start with http:// or https://")
        # The Anthropic SDK adds /v1/messages itself, so a trailing /v1 would double up.
        return url.removesuffix("/v1")

    @field_validator("advisory_model_id", mode="before")
    @classmethod
    def _empty_model_id_is_none(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value

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
