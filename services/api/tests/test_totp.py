"""ADR-013: the TOTP maths and recovery codes (pure functions, no database)."""

from __future__ import annotations

import base64

import pytest

from app import totp

# RFC 6238 appendix B, SHA-1 secret "12345678901234567890". The RFC lists 8 digits; 6 digits are the
# last six of those, because both are the same 31-bit value taken modulo 10**digits.
RFC_SECRET = base64.b32encode(b"12345678901234567890").decode().rstrip("=")
RFC_VECTORS = [
    (59, "287082"),
    (1111111109, "081804"),
    (1111111111, "050471"),
    (1234567890, "005924"),
    (2000000000, "279037"),
    (20000000000, "353130"),
]


@pytest.mark.parametrize(("when", "expected"), RFC_VECTORS)
def test_matches_the_rfc_6238_vectors(when: int, expected: str) -> None:
    assert totp.code_for_step(RFC_SECRET, totp.current_step(when)) == expected


def test_new_secret_is_random_base32_that_apps_accept() -> None:
    first, second = totp.new_secret(), totp.new_secret()
    assert first != second
    assert len(first) == 32
    assert set(first) <= set("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
    assert len(base64.b32decode(first + "=" * (-len(first) % 8))) == totp.SECRET_BYTES


def test_a_current_code_matches_and_reports_its_step() -> None:
    now = 1_700_000_000
    step = totp.current_step(now)
    code = totp.code_for_step(RFC_SECRET, step)
    assert totp.match_step(RFC_SECRET, code, after_step=-1, now=now) == step


@pytest.mark.parametrize("offset", [-1, 1])
def test_one_step_of_clock_drift_is_accepted(offset: int) -> None:
    now = 1_700_000_000
    step = totp.current_step(now)
    code = totp.code_for_step(RFC_SECRET, step + offset)
    assert totp.match_step(RFC_SECRET, code, after_step=-1, now=now) == step + offset


@pytest.mark.parametrize("offset", [-3, -2, 2, 3])
def test_more_than_one_step_of_drift_is_refused(offset: int) -> None:
    now = 1_700_000_000
    code = totp.code_for_step(RFC_SECRET, totp.current_step(now) + offset)
    assert totp.match_step(RFC_SECRET, code, after_step=-1, now=now) is None


def test_a_step_already_used_or_older_is_refused() -> None:
    now = 1_700_000_000
    step = totp.current_step(now)
    code = totp.code_for_step(RFC_SECRET, step)
    assert totp.match_step(RFC_SECRET, code, after_step=step, now=now) is None
    assert totp.match_step(RFC_SECRET, code, after_step=step + 5, now=now) is None
    assert totp.match_step(RFC_SECRET, code, after_step=step - 1, now=now) == step


@pytest.mark.parametrize("bad", ["", "12345", "1234567", "12345a", "١٢٣٤٥٦", " 123456", "12 3456"])
def test_malformed_codes_never_match(bad: str) -> None:
    assert totp.match_step(RFC_SECRET, bad, after_step=-1, now=59) is None


def test_provisioning_uri_has_what_google_authenticator_reads() -> None:
    uri = totp.provisioning_uri("ABCDEFGHIJKLMNOP", "owner name", "Zeekr Companion")
    assert uri.startswith("otpauth://totp/Zeekr%20Companion:owner%20name?")
    assert "secret=ABCDEFGHIJKLMNOP" in uri
    assert "issuer=Zeekr%20Companion" in uri
    assert "algorithm=SHA1" in uri and "digits=6" in uri and "period=30" in uri


def test_recovery_codes_are_distinct_and_easy_to_read() -> None:
    codes = totp.new_recovery_codes()
    assert len(codes) == len(set(codes)) == totp.RECOVERY_COUNT
    for code in codes:
        assert len(code) == 11 and code[5] == "-"
        assert not set(code.replace("-", "")) & set("0o1li")
        assert totp.looks_like_recovery(code)


def test_recovery_codes_match_however_they_are_typed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(totp, "RECOVERY_SCRYPT_N", 2**4)
    code = "abcde-fghjk"
    stored = [totp.hash_recovery("zzzzz-zzzzz"), totp.hash_recovery(code)]
    for typed in ("abcde-fghjk", "ABCDE-FGHJK", " abcdefghjk ", "abcde fghjk"):
        assert totp.find_recovery(typed, stored) == stored[1]
    assert totp.find_recovery("abcde-fghjm", stored) is None
    assert totp.find_recovery("short", stored) is None


def test_recovery_codes_are_stored_hashed() -> None:
    stored = totp.hash_recovery("abcde-fghjk")
    assert stored.startswith("scrypt:") and "abcdefghjk" not in stored
