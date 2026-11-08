"""PASSWORD_HASH_CONCURRENCY: how many scrypt hashes run at once (512 MB hosts set it to 1)."""

from __future__ import annotations

import threading
import time
from collections.abc import Iterator

import pytest
from pydantic import ValidationError

from app import security
from app.main import create_app
from tests.conftest import make_settings


@pytest.fixture(autouse=True)
def _restore_default() -> Iterator[None]:
    yield
    security.set_hash_concurrency(security.DEFAULT_HASH_CONCURRENCY)


def _peak_parallel_hashes(monkeypatch: pytest.MonkeyPatch, callers: int) -> int:
    """Run `callers` hashes at once with a slow fake scrypt and return the most seen together."""
    lock = threading.Lock()
    state = {"now": 0, "peak": 0}

    def slow_scrypt(*args: object, **kwargs: object) -> bytes:
        with lock:
            state["now"] += 1
            state["peak"] = max(state["peak"], state["now"])
        time.sleep(0.05)
        with lock:
            state["now"] -= 1
        return b"\0" * 32

    monkeypatch.setattr(security.hashlib, "scrypt", slow_scrypt)
    threads = [
        threading.Thread(target=security.hash_password, args=("pw",)) for _ in range(callers)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return state["peak"]


def test_default_allows_two_at_once(database_url: str, monkeypatch: pytest.MonkeyPatch) -> None:
    assert make_settings(database_url).password_hash_concurrency == 2
    assert _peak_parallel_hashes(monkeypatch, 6) == 2


def test_one_runs_hashes_one_at_a_time(monkeypatch: pytest.MonkeyPatch) -> None:
    security.set_hash_concurrency(1)
    assert _peak_parallel_hashes(monkeypatch, 6) == 1


def test_create_app_applies_the_setting(database_url: str, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[int] = []
    monkeypatch.setattr(security, "set_hash_concurrency", seen.append)
    create_app(make_settings(database_url, password_hash_concurrency=1))
    assert seen == [1]


@pytest.mark.parametrize("value", [0, -1, 5, 100])
def test_out_of_range_is_rejected(database_url: str, value: int) -> None:
    with pytest.raises(ValidationError):
        make_settings(database_url, password_hash_concurrency=value)


def test_set_hash_concurrency_refuses_zero() -> None:
    with pytest.raises(ValueError):
        security.set_hash_concurrency(0)
