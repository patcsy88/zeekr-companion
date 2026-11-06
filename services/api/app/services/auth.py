from __future__ import annotations

import functools
import hmac
import logging
from typing import Literal, NamedTuple

from sqlalchemy.orm import Session, sessionmaker

from app import security, totp
from app.errors import RateLimited, Unauthenticated
from app.repositories.owner_account import OwnerAccountRepository
from app.repositories.owner_mfa import OwnerMfaRepository
from app.schemas import TokenResponse
from app.services.rate_limit import FailureLimiter

logger = logging.getLogger("zeekr.auth")

# The global limiter stops an attacker rotating client addresses from bypassing the per-client one.
_GLOBAL_KEY = "*"
_GLOBAL_MULTIPLIER = 4


class _Factor(NamedTuple):
    """How a code was valid: no MFA, an app code for time step `value`, or a recovery hash."""

    kind: Literal["off", "step", "recovery"]
    value: int | str | None


@functools.cache
def _dummy_hash() -> str:
    """A real hash at default cost, so an unknown user takes as long as a wrong password."""
    return security.hash_password("not-a-real-password")


class AuthService:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        token_secret: str,
        token_ttl_seconds: int,
        max_failures: int,
        window_seconds: int,
    ) -> None:
        self._sessions = session_factory
        self._token_secret = token_secret
        self._ttl = token_ttl_seconds
        self._per_client = FailureLimiter(max_failures, window_seconds)
        self._global = FailureLimiter(max_failures * _GLOBAL_MULTIPLIER, window_seconds)
        _dummy_hash()  # built at startup so the first unknown-user login is not slower

    def login(
        self, username: str, password: str, client: str, code: str | None = None
    ) -> TokenResponse:
        retry = self._per_client.retry_after(client) or self._global.retry_after(_GLOBAL_KEY)
        if retry:
            logger.warning("login blocked by rate limit client=%s retry_after=%ss", client, retry)
            raise RateLimited("Too many failed attempts. Try again later.", retry)

        with self._sessions() as session:
            account = OwnerAccountRepository(session).get()
        if account is None:
            logger.warning("no owner account exists; run `python -m app.cli.set_owner`")
        stored = account.password_hash if account else _dummy_hash()
        password_ok = security.verify_password(password, stored)
        # Always checked, whatever the password did, so a slower answer never shows that the
        # password was right (ADR-013). Checking does not spend the code; that happens below.
        factor = self._check_second_factor(code)
        # Never trust a stored username that is missing or differs: the dummy path above still ran.
        if (
            account is None
            or not password_ok
            or not hmac.compare_digest(account.username.encode(), username.encode())
            or factor is None
            or not self._spend(factor)
        ):
            count = self._per_client.record_failure(client)
            self._global.record_failure(_GLOBAL_KEY)
            logger.warning("failed login attempt client=%s failures_in_window=%d", client, count)
            raise Unauthenticated("Invalid credentials.")

        self._per_client.reset(client)
        token = security.issue_token(self._token_secret, self._ttl)
        logger.info("login succeeded client=%s", client)
        return TokenResponse(access_token=token, expires_in=self._ttl)

    def _check_second_factor(self, code: str | None) -> _Factor | None:
        """The way `code` is valid, or None. MFA off is always valid. Spends nothing."""
        with self._sessions() as session:
            mfa = OwnerMfaRepository(session).get()
        if mfa is None:
            return _Factor("off", None)
        supplied = (code or "").strip()
        if totp.looks_like_recovery(supplied):
            match = totp.find_recovery(supplied, list(mfa.recovery_hashes))
            return None if match is None else _Factor("recovery", match)
        step = totp.match_step(mfa.secret, supplied, after_step=mfa.last_step)
        return None if step is None else _Factor("step", step)

    def _spend(self, factor: _Factor) -> bool:
        """Use up the code once the whole login is otherwise right. False if a parallel request
        used it first, so one code can never sign in twice."""
        if factor.kind == "off":
            return True
        with self._sessions() as session:
            repo = OwnerMfaRepository(session)
            if factor.kind == "step":
                return repo.accept_step(int(factor.value or 0))
            return repo.use_recovery(str(factor.value))

    def is_valid_token(self, token: str) -> bool:
        return security.verify_token(self._token_secret, token)
