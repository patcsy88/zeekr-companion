"""Time-based one-time passwords (RFC 6238) and recovery codes for the owner login (ADR-013).

Pure functions, no HTTP types and no database. The TOTP maths uses the standard library only. The
parameters are the ones Google Authenticator supports: HMAC-SHA1, 6 digits, 30-second steps.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

from app import security

STEP_SECONDS = 30
DIGITS = 6
# One step either side of now is accepted, for a phone clock that is a little off.
DRIFT_STEPS = 1
SECRET_BYTES = 20

RECOVERY_COUNT = 8
# No 0/o, 1/l/i: easy to misread when copied from paper.
_RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
_RECOVERY_GROUPS = 2
_RECOVERY_GROUP_LENGTH = 5
RECOVERY_LENGTH = _RECOVERY_GROUPS * _RECOVERY_GROUP_LENGTH
# A recovery code carries about 49 bits, so it is stored scrypt-hashed. Cheaper than the password
# cost because up to RECOVERY_COUNT hashes are checked per attempt; tests lower it further.
RECOVERY_SCRYPT_N = 2**14


def new_secret() -> str:
    """A fresh random secret, base32 without padding (what authenticator apps expect)."""
    return base64.b32encode(secrets.token_bytes(SECRET_BYTES)).decode().rstrip("=")


def _key(secret: str) -> bytes:
    return base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)


def current_step(now: float | None = None) -> int:
    return int(time.time() if now is None else now) // STEP_SECONDS


def code_for_step(secret: str, step: int) -> str:
    digest = hmac.new(_key(secret), struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(value % 10**DIGITS).zfill(DIGITS)


def match_step(secret: str, code: str, *, after_step: int, now: float | None = None) -> int | None:
    """The time step `code` belongs to, or None.

    Only a step newer than `after_step` counts, so a code that was already accepted (or any older
    one) is refused. All steps in the window are compared, so timing does not show which matched.
    """
    if len(code) != DIGITS or not code.isascii() or not code.isdigit():
        return None
    current = current_step(now)
    matched: int | None = None
    for step in range(current - DRIFT_STEPS, current + DRIFT_STEPS + 1):
        if hmac.compare_digest(code_for_step(secret, step), code) and step > after_step:
            matched = step
    return matched


def provisioning_uri(secret: str, account: str, issuer: str) -> str:
    """The otpauth link an authenticator app reads from the QR code."""
    label = f"{quote(issuer, safe='')}:{quote(account, safe='')}"
    return (
        f"otpauth://totp/{label}?secret={secret}&issuer={quote(issuer, safe='')}"
        f"&algorithm=SHA1&digits={DIGITS}&period={STEP_SECONDS}"
    )


def new_recovery_codes() -> list[str]:
    """Codes shown to the owner once, as `xxxxx-xxxxx`."""
    return [
        "-".join(
            "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(_RECOVERY_GROUP_LENGTH))
            for _ in range(_RECOVERY_GROUPS)
        )
        for _ in range(RECOVERY_COUNT)
    ]


def normalise_recovery(raw: str) -> str:
    return raw.strip().lower().replace("-", "").replace(" ", "")


def looks_like_recovery(raw: str) -> bool:
    return len(normalise_recovery(raw)) == RECOVERY_LENGTH


def hash_recovery(code: str) -> str:
    return security.hash_password(normalise_recovery(code), n=RECOVERY_SCRYPT_N)


def find_recovery(raw: str, stored: list[str]) -> str | None:
    """The stored hash that `raw` matches, or None. Every hash is checked, so the position of a
    match does not show in the timing."""
    candidate = normalise_recovery(raw)
    if len(candidate) != RECOVERY_LENGTH:
        return None
    found: str | None = None
    for item in stored:
        if security.verify_password(candidate, item):
            found = item
    return found
