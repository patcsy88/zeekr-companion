"""The model_check command: no network, no database. The chat model is a fake."""

from __future__ import annotations

import json
from typing import Any

import pytest
from pydantic import SecretStr

from app.cli import model_check
from app.services.reasoning import AnthropicReasoningModel
from tests.conftest import make_settings
from tests.test_reasoning import GOOD, FakeChat


def patch_settings(monkeypatch: pytest.MonkeyPatch, database_url: str, **over: Any) -> None:
    monkeypatch.setattr(model_check, "Settings", lambda: make_settings(database_url, **over))


def test_off_sends_nothing(
    monkeypatch: pytest.MonkeyPatch, database_url: str, capsys: pytest.CaptureFixture[str]
) -> None:
    patch_settings(monkeypatch, database_url)
    assert model_check.main() == 2
    assert "Nothing was sent" in capsys.readouterr().err


def test_missing_key_sends_nothing(
    monkeypatch: pytest.MonkeyPatch, database_url: str, capsys: pytest.CaptureFixture[str]
) -> None:
    patch_settings(monkeypatch, database_url, advisory_model_enabled=True)
    assert model_check.main() == 2
    assert "not set" in capsys.readouterr().err


@pytest.mark.parametrize(("reply", "code"), [(GOOD, 0), ("junk", 1)])
def test_reports_the_outcome_and_never_the_key(
    monkeypatch: pytest.MonkeyPatch,
    database_url: str,
    capsys: pytest.CaptureFixture[str],
    reply: str,
    code: int,
) -> None:
    chat = FakeChat(reply)
    patch_settings(
        monkeypatch,
        database_url,
        advisory_model_enabled=True,
        anthropic_api_key=SecretStr("sk-fake-key-value"),
        advisory_model_id="model-x",
        advisory_model_base_url="http://proxy.invalid:1",
    )
    monkeypatch.setattr(
        model_check,
        "build_reasoning_model",
        lambda _s: AnthropicReasoningModel("k", "model-x", chat_factory=lambda: chat),
    )
    assert model_check.main() == code
    out = capsys.readouterr().out
    assert "sk-fake-key-value" not in out
    assert "Tokens: in=12 out=7" in out
    sent = json.dumps([[m.content for m in call] for call in chat.calls])
    assert "km_to_limit: 1200" in sent
