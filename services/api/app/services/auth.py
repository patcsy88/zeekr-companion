from __future__ import annotations

import functools
import hmac
import logging

from sqlalchemy.orm import Session, sessionmaker

from app import security
from app.errors import RateLimited, Unauthenticated
from app.repositories.owner_account import OwnerAccountRepository
from app.schemas import TokenResponse
from app.services.rate_limit import FailureLimiter

logger = logging.getLogger("zeekr.auth")

# The global limiter stops an attacker rotating client addresses from bypassing the per-client one.
_GLOBAL_KEY = "*"
_GLOBAL_MULTIPLIER = 4


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

    def login(self, username: str, password: str, client: str) -> TokenResponse:
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
        # Never trust a stored username that is missing or differs: the dummy path above still ran.
        if (
            account is None
            or not password_ok
            or not hmac.compare_digest(account.username.encode(), username.encode())
        ):
            count = self._per_client.record_failure(client)
            self._global.record_failure(_GLOBAL_KEY)
            logger.warning("failed login attempt client=%s failures_in_window=%d", client, count)
            raise Unauthenticated("Invalid credentials.")

        self._per_client.reset(client)
        token = security.issue_token(self._token_secret, self._ttl)
        logger.info("login succeeded client=%s", client)
        return TokenResponse(access_token=token, expires_in=self._ttl)

    def is_valid_token(self, token: str) -> bool:
        return security.verify_token(self._token_secret, token)
