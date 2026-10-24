"""H1: placeholder and low-diversity secrets are rejected at startup; .env.example ships none."""

from __future__ import annotations

import pathlib

import pytest
from pydantic import SecretStr, ValidationError

from app.config import Settings

REPO = pathlib.Path(__file__).resolve().parents[3]
GOOD_SECRET = "Qx7vN2mPz9LrT4wYb8KcD1sFh6JgA3eU0oXiV5nM"  # test-only fixture, not a real secret


def _settings(database_url: str, **overrides: object) -> Settings:
    values: dict[str, object] = {
        "database_url": database_url,
        "token_secret": SecretStr(GOOD_SECRET),
    }
    values.update(overrides)
    return Settings(**values)  # type: ignore[arg-type]


def test_good_secret_accepted(database_url: str) -> None:
    assert _settings(database_url).token_secret.get_secret_value() == GOOD_SECRET


@pytest.mark.parametrize(
    "secret",
    [
        "change-me-to-a-long-random-string",  # the old .env.example value
        "xx-CHANGE-ME-xx" + "Qx7vN2mPz9LrT4wYb8KcD1sFh6",
        "a" * 40,
        "ab" * 20,
        "1234567890" * 4,
        "abcdabcdabcdabcdabcdabcdabcdabcd",
    ],
)
def test_weak_or_placeholder_token_secret_rejected(database_url: str, secret: str) -> None:
    with pytest.raises(ValidationError) as info:
        _settings(database_url, token_secret=SecretStr(secret))
    assert secret not in str(info.value)


def _env_example() -> dict[str, str]:
    values: dict[str, str] = {}
    for line in (REPO / "infra" / ".env.example").read_text().splitlines():
        if line.strip() and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip()
    return values


@pytest.mark.parametrize("key", ["TOKEN_SECRET", "POSTGRES_PASSWORD"])
def test_env_example_secrets_are_empty(key: str) -> None:
    assert _env_example()[key] == ""


def test_compose_requires_all_secrets() -> None:
    compose = (REPO / "infra" / "docker-compose.yml").read_text()
    for key in ("POSTGRES_PASSWORD", "TOKEN_SECRET"):
        assert f"${{{key}:?" in compose
    # DATABASE_URL interpolates POSTGRES_PASSWORD; it must use the required form too.
    assert "zeekr:${POSTGRES_PASSWORD}@" not in compose
