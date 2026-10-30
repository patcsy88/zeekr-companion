"""The hosted-model call for advisory explanations (ADR-008 step 4).

Only derived values leave the host. `build_prompt` accepts exactly the owner-approved fields for a
condition and refuses anything else, so a free-text value cannot reach the model by accident. The
model returns `{explanation, urgency}` only; code builds every suggestion.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from app.config import Settings

logger = logging.getLogger("app.advisory.model")

PROMPT_VERSION = 1
MAX_EXPLANATION_CHARS = 500
URGENCIES = ("low", "normal", "high")
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

_DATE_VS_KM = {"km_to_limit": int, "days_to_expiry": int, "projected_limit_date": str}
ALLOWED_FIELDS: dict[str, dict[str, type]] = {
    "date_vs_km_warranty": _DATE_VS_KM,
    "date_vs_km_service": _DATE_VS_KM,
    "charging_cost_drift": {
        "latest_cost_per_kwh_sen": int,
        "average_cost_per_kwh_sen": int,
        "latest_date": str,
    },
}
_DATE_FIELDS = ("projected_limit_date", "latest_date")

SYSTEM_PROMPT = (
    "You help the owner of an electric car understand a maintenance or cost observation. "
    "You are given a few numbers only. Write a short, plain explanation (at most 500 characters) "
    "and rate the urgency as low, normal or high. Do not invent facts about the car. "
    'Reply with raw JSON only, exactly {"explanation": "...", "urgency": "low|normal|high"}.'
)


@dataclass(frozen=True)
class Explanation:
    explanation: str
    urgency: Literal["low", "normal", "high"]


@dataclass(frozen=True)
class ModelResult:
    """One call, ready to audit. `explanation` is None unless the reply was valid."""

    request_text: str
    response_text: str | None
    input_tokens: int | None
    output_tokens: int | None
    outcome: Literal["ok", "error", "invalid_output"]
    explanation: Explanation | None


class ReasoningModel(Protocol):
    model_id: str

    def explain(self, condition: str, inputs: dict[str, int | str]) -> ModelResult: ...


def build_prompt(condition: str, inputs: dict[str, int | str]) -> str:
    allowed = ALLOWED_FIELDS.get(condition)
    if allowed is None:
        raise ValueError("unknown condition")
    if set(inputs) != set(allowed):
        raise ValueError("inputs do not match the approved fields")
    lines = [f"condition: {condition}"]
    for name, kind in allowed.items():
        value = inputs[name]
        if isinstance(value, bool) or not isinstance(value, kind):
            raise ValueError("input has the wrong type")
        if name in _DATE_FIELDS and not _ISO_DATE.match(str(value)):
            raise ValueError("date input is not an ISO date")
        lines.append(f"{name}: {value}")
    return "\n".join(lines)


def parse_reply(text: str) -> Explanation | None:
    try:
        data = json.loads(text)
    except ValueError:
        return None
    if not isinstance(data, dict) or set(data) != {"explanation", "urgency"}:
        return None
    explanation, urgency = data["explanation"], data["urgency"]
    if not isinstance(explanation, str) or not isinstance(urgency, str):
        return None
    explanation = explanation.strip()
    if not explanation or len(explanation) > MAX_EXPLANATION_CHARS or urgency not in URGENCIES:
        return None
    return Explanation(explanation, urgency)  # type: ignore[arg-type]


def reply_text(content: Any) -> str:
    """Plain text of a reply: a string, or the text blocks of a list (thinking is ignored)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            b if isinstance(b, str) else b.get("text", "")
            for b in content
            if isinstance(b, str) or (isinstance(b, dict) and b.get("type") == "text")
        ]
        return "".join(p for p in parts if isinstance(p, str))
    return ""


def _hide_everything(_: Any) -> dict[str, Any]:
    """LangSmith privacy hook: traces keep timing and status, never content."""
    return {}


def make_langsmith_client(api_key: str, api_url: str, **extra: Any) -> Any:
    from langsmith import Client

    return Client(
        api_url=api_url,
        api_key=api_key,
        hide_inputs=_hide_everything,
        hide_outputs=_hide_everything,
        hide_metadata=_hide_everything,
        **extra,
    )


class AnthropicReasoningModel:
    def __init__(
        self,
        api_key: str,
        model_id: str,
        *,
        langsmith_client: Any | None = None,
        chat_factory: Callable[[], Any] | None = None,
        base_url: str | None = None,
    ) -> None:
        self.model_id = model_id
        self._langsmith_client = langsmith_client
        if chat_factory is not None:
            self._chat = chat_factory()
        else:
            from langchain_anthropic import ChatAnthropic

            extra: dict[str, Any] = {"base_url": base_url} if base_url else {}
            self._chat = ChatAnthropic(
                model=model_id,
                api_key=api_key,
                max_tokens=1024,
                timeout=30,
                max_retries=1,
                **extra,
            )

    def _invoke(self, system: str, user: str) -> Any:
        from langchain_core.messages import HumanMessage, SystemMessage
        from langsmith import tracing_context

        messages = [SystemMessage(content=system), HumanMessage(content=user)]
        if self._langsmith_client is None:
            with tracing_context(enabled=False):
                return self._chat.invoke(messages)
        with tracing_context(enabled=True, client=self._langsmith_client):
            return self._chat.invoke(messages)

    def explain(self, condition: str, inputs: dict[str, int | str]) -> ModelResult:
        user = build_prompt(condition, inputs)
        request_text = f"{SYSTEM_PROMPT}\n\n{user}"
        logger.info("advisory model request: %s", request_text)
        try:
            reply = self._invoke(SYSTEM_PROMPT, user)
        except Exception as exc:
            logger.warning("advisory model call failed: %s", type(exc).__name__)
            return ModelResult(request_text, None, None, None, "error", None)
        text = reply_text(reply.content)
        usage = getattr(reply, "usage_metadata", None) or {}
        tokens_in, tokens_out = usage.get("input_tokens"), usage.get("output_tokens")
        logger.info("advisory model reply: %s", text)
        parsed = parse_reply(text)
        return ModelResult(
            request_text,
            text,
            tokens_in if isinstance(tokens_in, int) else None,
            tokens_out if isinstance(tokens_out, int) else None,
            "ok" if parsed else "invalid_output",
            parsed,
        )


def build_reasoning_model(settings: Settings) -> ReasoningModel | None:
    """None unless the switch is on and the key and model id are set (host `.env` only)."""
    if not settings.advisory_model_enabled:
        return None
    if settings.anthropic_api_key is None or not settings.advisory_model_id:
        return None
    client = None
    if (
        settings.advisory_tracing_enabled
        and settings.advisory_tracing_api_key is not None
        and settings.advisory_tracing_api_url
    ):
        client = make_langsmith_client(
            settings.advisory_tracing_api_key.get_secret_value(),
            settings.advisory_tracing_api_url,
        )
    return AnthropicReasoningModel(
        settings.anthropic_api_key.get_secret_value(),
        settings.advisory_model_id,
        langsmith_client=client,
        base_url=settings.advisory_model_base_url,
    )
