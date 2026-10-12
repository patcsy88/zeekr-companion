"""I4: FORWARDED_ALLOW_IPS may name only single hosts or small networks, never a wide range.

Anything wider lets arbitrary callers choose their own login rate-limit bucket via X-Forwarded-For.
"""

from __future__ import annotations

import os
import subprocess
import sys

import pytest

from app.cli.check_trusted_proxies import parse_trusted_proxies
from tests.test_proxy_trust import ENTRYPOINT

ACCEPTED = [
    "127.0.0.1",
    "172.28.77.10",
    "172.28.77.10/32",
    "172.28.77.0/24",
    "172.28.77.10, 127.0.0.1",
    "::1",
    "fd00::10/128",
    "fd00::/120",
]

REJECTED = [
    "*",
    " * ",
    "10.0.0.1,*",
    "0.0.0.0",  # noqa: S104 - rejected value under test
    "0.0.0.0/0",
    "0.0.0.0/32",
    "::",
    "::/0",
    "::/128",
    "0.0.0.0/1",
    "128.0.0.0/1",
    "10.0.0.0/8",
    "172.16.0.0/12",
    "172.28.0.0/16",
    "172.28.77.0/23",
    "fd00::/64",
    "fd00::/8",
    "10.0.0.1, 0.0.0.0/0",  # one bad entry poisons the list
    "",
    " ",
    ",",
    "proxy.local",
    "web",
    "172.28.77.10/33",
    "not-an-ip/24",
]


@pytest.mark.parametrize("value", ACCEPTED)
def test_accepts_single_hosts_and_small_networks(value: str) -> None:
    assert parse_trusted_proxies(value)


@pytest.mark.parametrize("value", REJECTED)
def test_rejects_wide_or_unspecified_ranges(value: str) -> None:
    with pytest.raises(ValueError, match="FORWARDED_ALLOW_IPS"):
        parse_trusted_proxies(value)


def test_error_names_the_offending_entry_only() -> None:
    with pytest.raises(ValueError, match=r"0\.0\.0\.0/0"):
        parse_trusted_proxies("172.28.77.10,0.0.0.0/0")


def _run_entrypoint(value: str | None) -> subprocess.CompletedProcess[str]:
    env = {"PATH": f"{os.path.dirname(sys.executable)}:/usr/bin:/bin"}
    if value is not None:
        env["FORWARDED_ALLOW_IPS"] = value
    return subprocess.run(  # noqa: S603
        ["/bin/sh", str(ENTRYPOINT)],
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        cwd=ENTRYPOINT.parent,
        check=False,
    )


WIDE = ["0.0.0.0/0", "0.0.0.0", "::/0", "10.0.0.0/8", "172.28.0.0/16"]  # noqa: S104


@pytest.mark.parametrize("value", WIDE)
def test_entrypoint_refuses_wide_ranges_before_migrations(value: str) -> None:
    result = _run_entrypoint(value)
    assert result.returncode == 64
    assert "FORWARDED_ALLOW_IPS" in result.stderr
    # It must stop before alembic or uvicorn start.
    assert "alembic" not in result.stderr.lower()
    assert "Running upgrade" not in result.stderr
