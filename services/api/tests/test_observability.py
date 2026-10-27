"""Sentry reporting is off by default and its scrubber keeps owner data out of events."""

from __future__ import annotations

import json
from typing import Any

import pytest
import sentry_sdk

from app.config import Settings
from app.observability import init_sentry, scrub_event
from tests.conftest import TOKEN_SECRET

FAKE_DSN = "https://publickey@o0.ingest.example.invalid/1"
SECRETS = ["hunter2-password", "Bearer abc.def.ghi", "owner-test", "12345.67", "WXY1234"]


def _event() -> dict[str, Any]:
    return {
        "event_id": "e1",
        "timestamp": "2026-10-28T00:00:00Z",
        "level": "error",
        "platform": "python",
        "release": "r1",
        "environment": "production",
        "server_name": "private-host-name",
        "user": {"username": "owner-test", "ip_address": "192.168.1.5"},
        "extra": {"amount": "12345.67"},
        "tags": {"plate": "WXY1234"},
        "contexts": {"runtime": {"name": "x"}},
        "breadcrumbs": {"values": [{"message": "login hunter2-password"}]},
        "request": {
            "method": "POST",
            "url": "http://host/api/v1/expenses?note=WXY1234",
            "headers": {"Authorization": "Bearer abc.def.ghi"},
            "cookies": {"s": "x"},
            "data": {"password": "hunter2-password", "amount": "12345.67"},
            "query_string": "note=WXY1234",
        },
        "exception": {
            "values": [
                {
                    "type": "DataError",
                    "module": "psycopg.errors",
                    "value": "invalid input: owner-test 12345.67",
                    "stacktrace": {
                        "frames": [
                            {
                                "filename": "app/x.py",
                                "function": "f",
                                "lineno": 3,
                                "module": "app.x",
                                "in_app": True,
                                "vars": {"password": "hunter2-password"},
                                "context_line": "pw = 'hunter2-password'",
                                "abs_path": "/home/someone/zeekr/app/x.py",
                            }
                        ]
                    },
                }
            ]
        },
    }


def test_scrub_removes_every_secret() -> None:
    out = json.dumps(scrub_event(_event()))
    for secret in [*SECRETS, "private-host-name", "192.168.1.5", "/home/someone"]:
        assert secret not in out


def test_scrub_keeps_what_is_needed_to_debug() -> None:
    out = scrub_event(_event())
    assert out["request"] == {"method": "POST", "url": "/api/v1/expenses"}
    exc = out["exception"]["values"][0]
    assert exc["type"] == "DataError"
    assert exc["stacktrace"]["frames"][0]["function"] == "f"
    assert exc["stacktrace"]["frames"][0]["lineno"] == 3
    assert "value" not in exc


def test_scrub_withholds_log_messages() -> None:
    out = scrub_event({"level": "error", "logentry": {"message": "bad value 12345.67"}})
    assert "12345.67" not in json.dumps(out)


def test_off_without_dsn(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[object] = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: called.append(kw))
    assert init_sentry(None) is False
    assert init_sentry("") is False
    assert called == []


def test_init_options_are_privacy_safe(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, Any] = {}
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: seen.update(kw))
    assert init_sentry(FAKE_DSN, "test") is True
    assert seen["send_default_pii"] is False
    assert seen["include_local_variables"] is False
    assert seen["traces_sample_rate"] == 0.0
    assert seen["max_breadcrumbs"] == 0
    assert seen["before_send"] is scrub_event


def test_empty_dsn_setting_means_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@localhost/db")
    monkeypatch.setenv("TOKEN_SECRET", TOKEN_SECRET)
    monkeypatch.setenv("SENTRY_DSN", "")
    assert Settings().sentry_dsn is None
    monkeypatch.setenv("SENTRY_DSN", FAKE_DSN)
    s = Settings()
    assert s.sentry_dsn is not None
    assert FAKE_DSN not in repr(s)
