"""ADR-008 step 4: the model call. No network: the chat model is a fake."""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import text

from app.services import reasoning
from app.services.reasoning import (
    AnthropicReasoningModel,
    build_prompt,
    build_reasoning_model,
    parse_reply,
)
from tests.conftest import make_settings
from tests.test_advisory_api import CHECKS, seed_charges, seed_pace, seed_warranty

DATE_INPUTS: dict[str, int | str] = {
    "km_to_limit": 900,
    "days_to_expiry": 40,
    "projected_limit_date": "2026-12-01",
}
CHARGE_INPUTS: dict[str, int | str] = {
    "latest_cost_per_kwh_sen": 120,
    "average_cost_per_kwh_sen": 80,
    "latest_date": "2026-10-01",
}
GOOD = json.dumps({"explanation": "Limit comes first.", "urgency": "high"})


class FakeReply:
    def __init__(self, content: str) -> None:
        self.content = content
        self.usage_metadata = {"input_tokens": 12, "output_tokens": 7}


class FakeChat:
    def __init__(self, reply: str | Exception = GOOD) -> None:
        self.reply = reply
        self.calls: list[Any] = []

    def invoke(self, messages: Any) -> FakeReply:
        self.calls.append(messages)
        if isinstance(self.reply, Exception):
            raise self.reply
        return FakeReply(self.reply)


def model_with(chat: FakeChat) -> AnthropicReasoningModel:
    return AnthropicReasoningModel("k", "model-x", chat_factory=lambda: chat)


def test_prompt_contains_only_approved_fields() -> None:
    text = build_prompt("date_vs_km_warranty", DATE_INPUTS)
    assert text == (
        "condition: date_vs_km_warranty\nkm_to_limit: 900\ndays_to_expiry: 40\n"
        "projected_limit_date: 2026-12-01"
    )
    assert "average_cost_per_kwh_sen" in build_prompt("charging_cost_drift", CHARGE_INPUTS)


@pytest.mark.parametrize(
    ("condition", "inputs"),
    [
        ("date_vs_km_warranty", {**DATE_INPUTS, "name": "Private warranty name"}),
        ("date_vs_km_warranty", {"km_to_limit": 1, "days_to_expiry": 2}),
        ("date_vs_km_warranty", {**DATE_INPUTS, "projected_limit_date": "see notes: secret"}),
        ("date_vs_km_warranty", {**DATE_INPUTS, "km_to_limit": "900"}),
        ("date_vs_km_warranty", {**DATE_INPUTS, "km_to_limit": True}),
        ("charging_cost_drift", DATE_INPUTS),
        ("something_else", DATE_INPUTS),
    ],
)
def test_prompt_refuses_anything_else(condition: str, inputs: dict[str, Any]) -> None:
    with pytest.raises(ValueError):
        build_prompt(condition, inputs)


@pytest.mark.parametrize(
    "text",
    [
        "not json",
        "[]",
        '{"explanation": "x"}',
        '{"explanation": "x", "urgency": "high", "extra": 1}',
        '{"explanation": 5, "urgency": "high"}',
        '{"explanation": "x", "urgency": "urgent"}',
        '{"explanation": "", "urgency": "low"}',
        json.dumps({"explanation": "y" * 501, "urgency": "low"}),
    ],
)
def test_bad_replies_are_invalid(text: str) -> None:
    assert parse_reply(text) is None


def test_good_reply_parses_and_exactly_500_chars_is_allowed() -> None:
    assert parse_reply(GOOD) is not None
    edge = json.dumps({"explanation": "y" * 500, "urgency": "low"})
    assert parse_reply(edge) is not None


def test_model_result_ok_error_and_invalid() -> None:
    ok = model_with(FakeChat()).explain("date_vs_km_warranty", DATE_INPUTS)
    assert ok.outcome == "ok"
    assert ok.explanation is not None and ok.explanation.urgency == "high"
    assert (ok.input_tokens, ok.output_tokens) == (12, 7)
    assert "km_to_limit: 900" in ok.request_text

    bad = model_with(FakeChat("nope")).explain("date_vs_km_warranty", DATE_INPUTS)
    assert bad.outcome == "invalid_output" and bad.explanation is None
    assert bad.response_text == "nope"

    err = model_with(FakeChat(RuntimeError("secret-in-message"))).explain(
        "date_vs_km_warranty", DATE_INPUTS
    )
    assert err.outcome == "error" and err.response_text is None


def test_factory_returns_none_unless_fully_configured(database_url: str) -> None:
    assert build_reasoning_model(make_settings(database_url)) is None
    on = make_settings(database_url, advisory_model_enabled=True)
    assert build_reasoning_model(on) is None
    no_id = make_settings(
        database_url, advisory_model_enabled=True, anthropic_api_key=SecretStr("k")
    )
    assert build_reasoning_model(no_id) is None
    full = make_settings(
        database_url,
        advisory_model_enabled=True,
        anthropic_api_key=SecretStr("k"),
        advisory_model_id="model-x",
    )
    assert build_reasoning_model(full) is not None


def test_reply_text_reads_only_text_blocks() -> None:
    blocks = [
        {"type": "thinking", "thinking": "hidden"},
        {"type": "text", "text": GOOD},
    ]
    assert reasoning.reply_text(blocks) == GOOD
    assert reasoning.reply_text(GOOD) == GOOD
    assert reasoning.reply_text(None) == ""
    assert reasoning.reply_text([{"type": "thinking", "thinking": "x"}]) == ""
    chat = FakeChat()
    chat.reply = GOOD
    reply = FakeReply(blocks)  # type: ignore[arg-type]
    chat.invoke = lambda _m: reply  # type: ignore[method-assign]
    assert model_with(chat).explain("date_vs_km_warranty", DATE_INPUTS).outcome == "ok"


def test_base_url_is_cleaned_and_reaches_the_client(database_url: str) -> None:
    s = make_settings(database_url, advisory_model_base_url="http://proxy.invalid:1234/v1/")
    assert s.advisory_model_base_url == "http://proxy.invalid:1234"
    assert make_settings(database_url, advisory_model_base_url=" ").advisory_model_base_url is None
    with pytest.raises(ValueError):
        make_settings(database_url, advisory_model_base_url="proxy.invalid:1234")
    model = AnthropicReasoningModel("k", "model-x", base_url="http://proxy.invalid:1234")
    assert str(model._chat.anthropic_api_url) == "http://proxy.invalid:1234"
    assert model._chat.temperature is None


def test_empty_env_values_are_unset(database_url: str) -> None:
    s = make_settings(
        database_url,
        anthropic_api_key="",
        advisory_tracing_api_key=" ",
        advisory_tracing_api_url="",
    )
    assert s.anthropic_api_key is None
    assert s.advisory_tracing_api_key is None
    assert s.advisory_tracing_api_url is None


def test_trace_hooks_drop_content_and_metadata() -> None:
    fake_secret = "sk-ant-FAKE-0000000000"
    client = reasoning.make_langsmith_client(
        "ls-fake", "http://127.0.0.1:9", auto_batch_tracing=False
    )
    payload = {"messages": [fake_secret], "password": fake_secret}
    for hook in (client._hide_inputs, client._hide_outputs, client._hide_metadata):
        assert hook(payload) == {}
    assert fake_secret not in json.dumps(reasoning._hide_everything(payload))


def test_tracing_is_off_unless_a_client_is_given() -> None:
    seen: list[Any] = []

    class Chat(FakeChat):
        def invoke(self, messages: Any) -> FakeReply:
            from langsmith.run_helpers import get_tracing_context

            seen.append(get_tracing_context().get("enabled"))
            return super().invoke(messages)

    model_with(Chat()).explain("date_vs_km_warranty", DATE_INPUTS)
    assert seen == [False]


def make_client_with_model(
    database_url: str, password_hash: str, chat: FakeChat, **over: Any
) -> tuple[Any, dict[str, str]]:
    from app.main import create_app
    from tests.conftest import PASSWORD, USERNAME, seed_owner

    seed_owner(database_url, password_hash)
    settings = make_settings(
        database_url,
        advisory_model_enabled=True,
        anthropic_api_key=SecretStr("k"),
        advisory_model_id="model-x",
        **over,
    )
    app = create_app(settings)
    with app.state.engine.begin() as conn:
        conn.execute(
            text(
                "TRUNCATE service_record, vehicle, reminder, expense, "
                "warranty_claim, warranty_coverage, advisory_model_call, advisory_proposal"
            )
        )
    app.state.reasoning_model = model_with(chat)
    c = TestClient(app)
    c.__enter__()
    token = c.post("/api/v1/auth/token", json={"username": USERNAME, "password": PASSWORD}).json()[
        "access_token"
    ]
    return c, {"Authorization": f"Bearer {token}"}


def test_run_with_model_stores_explanation_and_audit(database_url: str, password_hash: str) -> None:
    chat = FakeChat()
    c, h = make_client_with_model(database_url, password_hash, chat)
    try:
        seed_pace(c, h)
        seed_warranty(c, h)
        seed_charges(c, h)
        body = c.post(CHECKS, headers=h).json()
        assert len(body["created"]) == 2 and body["model"]["status"] == "used"
        for p in body["created"]:
            assert p["explanation_status"] == "model" and p["urgency"] == "high"
            assert p["provenance"] == {
                "rule_version": 1,
                "prompt_version": 1,
                "model_id": "model-x",
            }
        assert len(chat.calls) == 2
        sent = json.dumps([[m.content for m in call] for call in chat.calls])
        assert "Private warranty name" not in sent and "private note" not in sent
        calls = c.get("/api/v1/advisory/model-calls", headers=h).json()["items"]
        assert len(calls) == 2 and {x["outcome"] for x in calls} == {"ok"}
        assert body["model"]["calls_this_month"] == 2
        again = c.post(CHECKS, headers=h).json()
        assert again["created"] == [] and len(chat.calls) == 2  # known findings: no new call
    finally:
        c.__exit__(None, None, None)
        c.app.state.engine.dispose()  # type: ignore[attr-defined]


def test_monthly_limit_stops_calls(database_url: str, password_hash: str) -> None:
    chat = FakeChat()
    c, h = make_client_with_model(database_url, password_hash, chat, advisory_monthly_call_limit=1)
    try:
        seed_pace(c, h)
        seed_warranty(c, h)
        seed_charges(c, h)
        body = c.post(CHECKS, headers=h).json()
        assert len(chat.calls) == 1 and body["model"]["status"] == "limit_reached"
        assert sorted(p["explanation_status"] for p in body["created"]) == [
            "limit_reached",
            "model",
        ]
    finally:
        c.__exit__(None, None, None)
        c.app.state.engine.dispose()  # type: ignore[attr-defined]


@pytest.mark.parametrize(
    ("reply", "status", "outcome"),
    [("junk", "invalid_output", "invalid_output"), (RuntimeError("x"), "unavailable", "error")],
)
def test_failed_calls_keep_the_proposal(
    database_url: str, password_hash: str, reply: str | Exception, status: str, outcome: str
) -> None:
    c, h = make_client_with_model(database_url, password_hash, FakeChat(reply))
    try:
        seed_pace(c, h)
        seed_warranty(c, h)
        body = c.post(CHECKS, headers=h).json()
        assert [p["explanation_status"] for p in body["created"]] == [status]
        assert body["created"][0]["explanation"] is None
        calls = c.get("/api/v1/advisory/model-calls", headers=h).json()["items"]
        assert [x["outcome"] for x in calls] == [outcome]
    finally:
        c.__exit__(None, None, None)
        c.app.state.engine.dispose()  # type: ignore[attr-defined]
