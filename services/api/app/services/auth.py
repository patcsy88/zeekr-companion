from __future__ import annotations

import logging

from app import security
from app.errors import RateLimited, Unauthenticated
from app.schemas import TokenResponse
from app.services.rate_limit import FailureLimiter

logger = logging.getLogger("zeekr.auth")

# The global limiter stops an attacker rotating client addresses from bypassing the per-client one.
_GLOBAL_KEY = "*"
_GLOBAL_MULTIPLIER = 4


class AuthService:
    def __init__(
        self,
        *,
        password_hash: str,
        token_secret: str,
        token_ttl_seconds: int,
        max_failures: int,
        window_seconds: int,
    ) -> None:
        self._password_hash = password_hash
        self._token_secret = token_secret
        self._ttl = token_ttl_seconds
        self._per_client = FailureLimiter(max_failures, window_seconds)
        self._global = FailureLimiter(max_failures * _GLOBAL_MULTIPLIER, window_seconds)

    def login(self, password: str, client: str) -> TokenResponse:
        retry = self._per_client.retry_after(client) or self._global.retry_after(_GLOBAL_KEY)
        if retry:
            logger.warning("login blocked by rate limit client=%s retry_after=%ss", client, retry)
            raise RateLimited("Too many failed attempts. Try again later.", retry)

        if not security.verify_password(password, self._password_hash):
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
