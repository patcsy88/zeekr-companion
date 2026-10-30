"""The Zeekr login check: no network, no database. The client is a fake with canary values."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from app.cli import zeekr_login_check as check

CANARY = "CANARY-VALUE-9f3a"
ENV = {name: f"{CANARY}-{name}" for name in check.REQUIRED}
ENV[check.CONFIRM_VARIABLE] = check.CONFIRM_VALUE


class FakeVehicle:
    vin = f"{CANARY}-vin"

    def __init__(self, status_error: bool = False) -> None:
        self.data = {"vin": self.vin, "model": CANARY, "tags": [{"id": 1}], "n": 3, "flag": True}
        self.status_error = status_error
        self.status_calls = 0

    def get_status(self) -> dict[str, Any]:
        self.status_calls += 1
        if self.status_error:
            raise RuntimeError(f"token {CANARY}")
        return {"soc": 71.5, "tyres": {"fl": 2.4}, "note": CANARY}


class FakeClient:
    def __init__(
        self, login_error: bool = False, vehicles: list[FakeVehicle] | None = None, **kw: Any
    ) -> None:
        self.kwargs = kw
        self.login_error = login_error
        self.login_calls = 0
        self.vehicles = [FakeVehicle()] if vehicles is None else vehicles

    def login(self) -> None:
        self.login_calls += 1
        if self.login_error:
            raise RuntimeError(f"Login failed: {{'token': '{CANARY}'}}")

    def get_vehicle_list(self) -> list[FakeVehicle]:
        return self.vehicles


def run(
    capsys: pytest.CaptureFixture[str],
    args: list[str] | None = None,
    env: dict[str, str] | None = None,
    **client_options: Any,
) -> tuple[int, str, str, list[FakeClient]]:
    made: list[FakeClient] = []

    def factory(**kw: Any) -> FakeClient:
        client = FakeClient(**client_options, **kw)
        made.append(client)
        return client

    code = check.main(args or [], ENV if env is None else env, factory)
    out = capsys.readouterr()
    return code, out.out, out.err, made


def test_without_confirmation_nothing_is_built(capsys: pytest.CaptureFixture[str]) -> None:
    env = {k: v for k, v in ENV.items() if k != check.CONFIRM_VARIABLE}
    code, out, err, made = run(capsys, env=env)
    assert code == 2 and made == []
    assert "Nothing was sent" in err
    assert CANARY not in out + err


def test_missing_setting_names_it_and_builds_nothing(capsys: pytest.CaptureFixture[str]) -> None:
    env = {k: v for k, v in ENV.items() if k != "ZEEKR_VIN_IV"}
    code, _, err, made = run(capsys, env=env)
    assert code == 2 and made == []
    assert "ZEEKR_VIN_IV" in err
    assert CANARY not in err


def test_one_login_no_retry_silent_logger(capsys: pytest.CaptureFixture[str]) -> None:
    code, _, _, made = run(capsys)
    assert code == 0
    assert len(made) == 1 and made[0].login_calls == 1
    assert made[0].kwargs["max_retries"] == 0
    assert made[0].kwargs["logger"].propagate is False


def test_output_has_field_names_and_types_but_no_values(
    capsys: pytest.CaptureFixture[str],
) -> None:
    code, out, err, _ = run(capsys)
    assert code == 0
    assert "$.model: str" in out and "$.tags: list of 1" in out and "$.n: int" in out
    assert "$.flag: bool" in out
    assert CANARY not in out + err
    assert "71.5" not in out


def test_status_is_read_once_only_when_asked(capsys: pytest.CaptureFixture[str]) -> None:
    vehicle = FakeVehicle()
    code, out, _, _ = run(capsys, vehicles=[vehicle])
    assert code == 0 and vehicle.status_calls == 0
    vehicle = FakeVehicle()
    code, out, err, _ = run(capsys, args=["--status"], vehicles=[vehicle])
    assert code == 0 and vehicle.status_calls == 1
    assert "$.soc: float" in out and "$.tyres.fl: float" in out
    assert CANARY not in out + err and "71.5" not in out


def test_failed_login_prints_only_the_class(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, err, made = run(capsys, login_error=True)
    assert code == 1 and made[0].login_calls == 1
    assert "RuntimeError" in err
    assert CANARY not in out + err


def _bearer_login_stand_in() -> None:
    raise RuntimeError(f"Bearer login failed: {{'token': '{CANARY}'}}")


def test_failing_stage_names_the_library_function_and_no_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(check, "LIBRARY_PACKAGE", __name__)
    try:
        _bearer_login_stand_in()
    except RuntimeError as exc:
        stage = check.failing_stage(exc)
    assert stage.startswith("_bearer_login_stand_in (line ")
    assert CANARY not in stage


def test_failing_stage_is_unknown_outside_the_library() -> None:
    try:
        _bearer_login_stand_in()
    except RuntimeError as exc:
        assert check.failing_stage(exc) == "unknown"


def test_login_failure_line_has_the_stage_and_no_text(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(check, "LIBRARY_PACKAGE", __name__)
    code, out, err, _ = run(capsys, login_error=True)
    assert code == 1
    assert "RuntimeError in FakeClient.login (line " not in err  # co_name is the bare name
    assert "RuntimeError in login (line " in err
    assert CANARY not in out + err


def test_failed_read_prints_only_the_class(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, err, _ = run(capsys, args=["--status"], vehicles=[FakeVehicle(status_error=True)])
    assert code == 1
    assert "RuntimeError in unknown." in err
    assert CANARY not in out + err


def test_empty_vehicle_list_is_reported(capsys: pytest.CaptureFixture[str]) -> None:
    code, out, _, _ = run(capsys, vehicles=[])
    assert code == 0
    assert "list is empty" in out


def test_describe_never_returns_a_value() -> None:
    lines = check.describe({"a": CANARY, "b": [CANARY], "c": {"d": 1}, "x" * 60: 1})
    assert not any(CANARY in line for line in lines)
    assert "$.<long key>: int" in lines


def test_the_file_names_no_write_or_session_method() -> None:
    source = Path(check.__file__).read_text()
    for banned in ("do_remote_control", "set_charge_plan", "set_travel_plan"):
        assert banned not in source
    for banned in ("export_session", "load_session"):
        assert banned not in source


TOKEN = "fake-test-token-not-real-123456"


def _hint(text: str) -> str:
    return check.failure_hint(RuntimeError(text))


def test_hint_reports_a_code_after_a_code_key_and_a_known_phrase() -> None:
    text = "Bearer login failed: {'code': '079025', 'msg': 'Signature authentication failed'}"
    hint = _hint(text)
    assert "code 079025" in hint
    assert "Signature authentication failed" in hint


def test_hint_never_copies_a_token_or_unknown_text() -> None:
    text = (
        f"Bearer login failed: {{'code': 500, 'msg': 'secret {CANARY}', "
        f"'data': {{'accessToken': '{TOKEN}', 'id': 123456}}}}"
    )
    hint = _hint(text)
    assert "code 500" in hint
    assert CANARY not in hint and TOKEN not in hint and "123456" not in hint
    assert "secret" not in hint


def test_hint_ignores_digits_inside_a_token() -> None:
    hint = _hint("Bearer login failed: {'accessToken': 'abc-code=123456-xyz'}")
    assert "123456" not in hint


def test_hint_with_nothing_recognised() -> None:
    assert _hint(f"odd {CANARY}") == "no known code or message found"


def test_hint_is_printed_only_with_the_flag(capsys: pytest.CaptureFixture[str]) -> None:
    code, _, err, _ = run(capsys, login_error=True)
    assert code == 1 and "Server hint" not in err
    code, out, err, _ = run(capsys, args=["--show-code"], login_error=True)
    assert code == 1 and "Server hint: " in err
    assert CANARY not in out + err
