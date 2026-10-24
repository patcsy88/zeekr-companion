"""M1/D3: the login rate limit keys on the real client address behind the reverse proxy.

These tests run a real uvicorn server (the same ProxyHeadersMiddleware that production uses),
because Starlette's TestClient bypasses it. The "trusted" proxy here is 127.0.0.1, which is the
test client itself.
A compose-level check with real distinct client containers is in infra/smoke.sh.
"""

from __future__ import annotations

import pathlib
import socket
import subprocess
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager

import httpx
import pytest
import uvicorn

from app.main import create_app
from tests.conftest import API_ROOT, PASSWORD, USERNAME, make_settings, seed_owner

ENTRYPOINT = API_ROOT / "docker-entrypoint.sh"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port: int = s.getsockname()[1]
        return port


@contextmanager
def _server(database_url: str, password_hash: str, trusted: str) -> Iterator[str]:
    seed_owner(database_url, password_hash)
    app = create_app(make_settings(database_url, login_max_failures=3))
    port = _free_port()
    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=port,
        forwarded_allow_ips=trusted,
        proxy_headers=True,
        log_level="warning",
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.02)
    assert server.started, "uvicorn did not start"
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=10)
        app.state.engine.dispose()


def _login(base: str, password: str, forwarded_for: str | None) -> httpx.Response:
    headers = {"X-Forwarded-For": forwarded_for} if forwarded_for else {}
    return httpx.post(
        f"{base}/api/v1/auth/token",
        json={"username": USERNAME, "password": password},
        headers=headers,
        timeout=10,
    )


def test_spoofed_forwarded_for_from_untrusted_source_is_ignored(
    database_url: str, password_hash: str
) -> None:
    """The caller (127.0.0.1) is not a trusted proxy, so rotating X-Forwarded-For buys nothing."""
    with _server(database_url, password_hash, trusted="10.99.99.99") as base:
        for i in range(3):
            assert _login(base, "wrong", f"198.51.100.{i + 1}").status_code == 401
        # A fresh spoofed address with the CORRECT password is still locked out: one real bucket.
        blocked = _login(base, PASSWORD, "198.51.100.200")
        assert blocked.status_code == 429
        assert blocked.json()["error"]["code"] == "rate_limited"
        assert int(blocked.headers["retry-after"]) >= 1


def test_distinct_clients_behind_trusted_proxy_get_separate_buckets(
    database_url: str, password_hash: str
) -> None:
    with _server(database_url, password_hash, trusted="127.0.0.1") as base:
        for _ in range(3):
            assert _login(base, "wrong", "198.51.100.1").status_code == 401
        assert _login(base, PASSWORD, "198.51.100.1").status_code == 429  # client A locked out
        assert _login(base, PASSWORD, "198.51.100.2").status_code == 200  # client B unaffected


def test_trusted_proxy_chain_uses_rightmost_untrusted_address(
    database_url: str, password_hash: str
) -> None:
    """A client-supplied leading entry in X-Forwarded-For must not choose the bucket."""
    with _server(database_url, password_hash, trusted="127.0.0.1") as base:
        for i in range(3):
            # The proxy appends the real peer (198.51.100.1) after whatever the client sent.
            assert _login(base, "wrong", f"203.0.113.{i + 1}, 198.51.100.1").status_code == 401
        assert _login(base, PASSWORD, "203.0.113.99, 198.51.100.1").status_code == 429


@pytest.mark.parametrize("value", ["*", "10.0.0.1,*", " * "])
def test_entrypoint_refuses_wildcard_trust(value: str, tmp_path: pathlib.Path) -> None:
    result = subprocess.run(  # noqa: S603
        ["/bin/sh", str(ENTRYPOINT)],
        env={"PATH": "/usr/bin:/bin", "FORWARDED_ALLOW_IPS": value},
        capture_output=True,
        text=True,
        timeout=30,
        cwd=tmp_path,
        check=False,
    )
    assert result.returncode != 0
    assert "FORWARDED_ALLOW_IPS" in result.stderr


def test_entrypoint_passes_explicit_trust_and_never_wildcard() -> None:
    text = ENTRYPOINT.read_text()
    assert "--forwarded-allow-ips" in text
    assert "--proxy-headers" in text
    assert "forwarded-allow-ips '*'" not in text
    assert 'forwarded-allow-ips "*"' not in text
