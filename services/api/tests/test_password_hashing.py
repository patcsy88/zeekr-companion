"""M2: scrypt cost meets the OWASP minimum; hashes made with older parameters still verify."""

from __future__ import annotations

import time

import pytest

from app import security
from app.cli import hash_password as cli


def test_default_cost_meets_owasp_minimum() -> None:
    assert security.SCRYPT_N >= 2**17
    assert security.SCRYPT_R >= 8
    assert security.SCRYPT_P >= 1


def test_default_hash_records_current_parameters() -> None:
    stored = security.hash_password("a-long-enough-password")
    parts = stored.split(":")
    assert parts[:4] == ["scrypt", str(2**17), "8", "1"]
    assert security.verify_password("a-long-enough-password", stored)
    assert not security.verify_password("a-long-enough-passworD", stored)


def test_legacy_parameters_still_verify() -> None:
    # Hash created by the first release (N=2**14), computed with fixed inputs.
    legacy = security.hash_password("legacy password 123", n=2**14, salt=bytes(range(16)))
    assert legacy.startswith("scrypt:16384:8:1:")
    assert security.verify_password("legacy password 123", legacy)
    assert not security.verify_password("legacy password 124", legacy)


def test_non_utf8_password_is_not_an_error() -> None:
    stored = security.hash_password("pw", n=2**4)
    assert security.verify_password("\ud800", stored) is False  # lone surrogate: UnicodeError


def test_cli_emits_current_cost_hash(monkeypatch: pytest.MonkeyPatch, capsys) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(cli.getpass, "getpass", lambda _prompt: "twelve chars ok!")
    assert cli.main() == 0
    out = capsys.readouterr().out.strip()
    assert out.startswith(f"scrypt:{2**17}:8:1:")
    assert security.verify_password("twelve chars ok!", out)


def test_verify_latency_is_acceptable() -> None:
    stored = security.hash_password("latency-check-pw")
    start = time.perf_counter()
    security.verify_password("latency-check-pw", stored)
    assert time.perf_counter() - start < 2.0
