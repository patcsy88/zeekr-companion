"""D1: a malformed DATABASE_URL must never echo the password (startup, alembic, tracebacks)."""

from __future__ import annotations

import os
import subprocess
import sys
import traceback
from urllib.parse import quote

import pytest
from pydantic import SecretStr, ValidationError

from app.config import Settings
from app.security import hash_password
from tests.conftest import API_ROOT, TOKEN_SECRET

# Contains both '@' and ':' (and is not percent-encoded, which is how the mistake happens).
PASSWORD = "p@ss:w0rd!Zq9"
FRAGMENTS = ("w0rd", "Zq9", "p@ss", quote(PASSWORD, safe=""))

MALFORMED = [
    f"postgresql+psycopg://zeekr:{PASSWORD}@db:5432/zeekr",
    f"postgresql+psycopg://zeekr:{PASSWORD}@db:notaport/zeekr",
    f"postgresql://zeekr:{PASSWORD}@db/zeekr",
    f"postgresql+psycopg://zeekr:{PASSWORD}@db:99999999999999999999/zeekr",
]


def _assert_clean(text: str) -> None:
    for fragment in FRAGMENTS:
        assert fragment not in text, f"password fragment {fragment!r} leaked"


def _env(**extra: str) -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k != "DATABASE_URL"}
    env.update(extra)
    return env


@pytest.mark.parametrize("url", MALFORMED)
def test_settings_error_does_not_echo_password(url: str) -> None:
    with pytest.raises(ValidationError) as info:
        Settings(
            database_url=SecretStr(url),
            owner_password_hash=SecretStr(hash_password("pw-for-tests", n=2**4)),
            token_secret=SecretStr(TOKEN_SECRET),
        )
    exc = info.value
    _assert_clean(str(exc))
    _assert_clean(repr(exc))
    _assert_clean("".join(traceback.format_exception(exc)))  # includes chained causes
    assert "DATABASE_URL" in str(exc)


@pytest.mark.parametrize("url", MALFORMED)
def test_app_startup_does_not_echo_password(url: str) -> None:
    code = "import app.asgi"
    result = subprocess.run(  # noqa: S603
        [sys.executable, "-c", code],
        cwd=API_ROOT,
        env=_env(
            DATABASE_URL=url,
            OWNER_PASSWORD_HASH=hash_password("pw-for-tests", n=2**4),
            TOKEN_SECRET=TOKEN_SECRET,
        ),
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert result.returncode != 0
    _assert_clean(result.stdout + result.stderr)


@pytest.mark.parametrize("url", MALFORMED)
def test_alembic_does_not_echo_password(url: str) -> None:
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=API_ROOT,
        env=_env(DATABASE_URL=url),
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert result.returncode != 0
    _assert_clean(result.stdout + result.stderr)
    assert "DATABASE_URL" in result.stdout + result.stderr


def test_alembic_connection_failure_does_not_echo_password() -> None:
    """A well-formed URL that cannot connect (closed port) must not print the password either."""
    url = f"postgresql+psycopg://zeekr:{quote(PASSWORD, safe='')}@127.0.0.1:1/zeekr"
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=API_ROOT,
        env=_env(DATABASE_URL=url),
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert result.returncode != 0
    _assert_clean(result.stdout + result.stderr)


def test_percent_encoded_password_is_accepted() -> None:
    url = f"postgresql://zeekr:{quote(PASSWORD, safe='')}@db:5432/zeekr"
    settings = Settings(
        database_url=SecretStr(url),
        owner_password_hash=SecretStr(hash_password("pw-for-tests", n=2**4)),
        token_secret=SecretStr(TOKEN_SECRET),
    )
    assert settings.database_url.get_secret_value().startswith("postgresql+psycopg://")
