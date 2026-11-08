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


@pytest.mark.parametrize("key", ["TOKEN_SECRET", "POSTGRES_PASSWORD", "TS_AUTHKEY", "TS_HOSTNAME"])
def test_env_example_secrets_are_empty(key: str) -> None:
    assert _env_example()[key] == ""


def test_compose_requires_all_secrets() -> None:
    compose = (REPO / "infra" / "docker-compose.yml").read_text()
    for key in ("POSTGRES_PASSWORD", "TOKEN_SECRET"):
        assert f"${{{key}:?" in compose
    # DATABASE_URL interpolates POSTGRES_PASSWORD; it must use the required form too.
    assert "zeekr:${POSTGRES_PASSWORD}@" not in compose


@pytest.mark.parametrize("name", ["docker-compose.yml", "docker-compose.release.yml"])
def test_tailscale_sidecar_is_opt_in_and_private(name: str) -> None:
    compose = (REPO / "infra" / name).read_text()
    block = compose.split("\n  tailscale:\n", 1)[1].split("\nnetworks:\n", 1)[0]
    assert '    profiles: ["tailscale"]' in block
    assert "    image: tailscale/tailscale:v" in block
    assert "TS_AUTHKEY: ${TS_AUTHKEY:-}" in block
    assert "    read_only: true" in block
    # A read-only service cannot take an inline compose config (owner's host, 2026-11-08).
    assert "\nconfigs:\n" not in compose and "    configs:" not in block
    for banned in ("ports:", "cap_add:", "devices:", "network_mode:", "backend", "/dev/net/tun"):
        assert banned not in block
    assert "    networks:\n      - edge\n" in block
    assert "TS_SERVE_CONFIG: /tmp/serve.json" in block
    assert '"Proxy": "http://web:8080"' in block
    assert '"AllowFunnel": { "$${TS_CERT_DOMAIN}:443": false }' in block
    assert "exec /usr/local/bin/containerboot" in block
