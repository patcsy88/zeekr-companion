"""Password hashing and signed, short-lived access tokens. Pure functions, no HTTP types."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import threading
import time
import unicodedata

# OWASP minimum for scrypt: N=2^17, r=8, p=1 (about 128 MiB per hash).
SCRYPT_N = 2**17
SCRYPT_R = 8
SCRYPT_P = 1
# hashlib needs headroom above 128 * N * r (128 MiB at the default cost).
_SCRYPT_MAXMEM = 256 * 1024 * 1024
# Each verification holds ~128 MiB; cap parallel ones so a burst of logins cannot exhaust memory.
_scrypt_slots = threading.BoundedSemaphore(2)
_DKLEN = 32
_PREFIX = "scrypt"


def hash_password(
    password: str,
    *,
    n: int = SCRYPT_N,
    r: int = SCRYPT_R,
    p: int = SCRYPT_P,
    salt: bytes | None = None,
) -> str:
    """Return `scrypt:N:r:p:<salt hex>:<hash hex>` (no `$`, safe in .env and Compose)."""
    salt = salt if salt is not None else secrets.token_bytes(16)
    with _scrypt_slots:
        digest = hashlib.scrypt(
            password.encode(), salt=salt, n=n, r=r, p=p, maxmem=_SCRYPT_MAXMEM, dklen=_DKLEN
        )
    return f"{_PREFIX}:{n}:{r}:{p}:{salt.hex()}:{digest.hex()}"


def _parse_hash(stored: str) -> tuple[int, int, int, bytes, bytes]:
    parts = stored.split(":")
    if len(parts) != 6 or parts[0] != _PREFIX:
        raise ValueError("unsupported password hash format")
    n, r, p = int(parts[1]), int(parts[2]), int(parts[3])
    salt, digest = bytes.fromhex(parts[4]), bytes.fromhex(parts[5])
    if n < 2 or n & (n - 1) or r < 1 or p < 1 or not salt or not digest:
        raise ValueError("invalid password hash parameters")
    return n, r, p, salt, digest


def is_valid_hash(stored: str) -> bool:
    try:
        _parse_hash(stored)
    except ValueError:
        return False
    return True


def verify_password(password: str, stored: str) -> bool:
    """Check a password. Parameters come from the stored hash, so older hashes keep working.

    A password that cannot be encoded (e.g. a lone surrogate) simply does not match.
    """
    n, r, p, salt, expected = _parse_hash(stored)
    try:
        encoded = password.encode()
    except UnicodeError:
        return False
    with _scrypt_slots:
        actual = hashlib.scrypt(
            encoded, salt=salt, n=n, r=r, p=p, maxmem=_SCRYPT_MAXMEM, dklen=len(expected)
        )
    return hmac.compare_digest(actual, expected)


USERNAME_MIN = 3
USERNAME_MAX = 64


def normalise_username(raw: str) -> str:
    """Trim and lower-case a username (ADR-006). Raises ValueError when it is not acceptable."""
    name = raw.strip().lower()
    if not USERNAME_MIN <= len(name) <= USERNAME_MAX:
        raise ValueError(f"username must be {USERNAME_MIN} to {USERNAME_MAX} characters")
    if not name.isascii() or any(unicodedata.category(ch).startswith("C") for ch in name):
        raise ValueError("username must use plain ASCII characters, no control characters")
    return name


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(secret: str, payload: str) -> str:
    return _b64(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest())


def issue_token(secret: str, ttl_seconds: int, *, now: int | None = None) -> str:
    issued = int(time.time()) if now is None else now
    body = json.dumps(
        {"sub": "owner", "iat": issued, "exp": issued + ttl_seconds}, separators=(",", ":")
    )
    payload = _b64(body.encode())
    return f"{payload}.{_sign(secret, payload)}"


def verify_token(secret: str, token: str, *, now: int | None = None) -> bool:
    try:
        payload, signature = token.split(".")
        if not hmac.compare_digest(signature, _sign(secret, payload)):
            return False
        claims = json.loads(_unb64(payload))
        expires = int(claims["exp"])
    except (ValueError, KeyError, TypeError):
        return False
    current = int(time.time()) if now is None else now
    return current < expires
