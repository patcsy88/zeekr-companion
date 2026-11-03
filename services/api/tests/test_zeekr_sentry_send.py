"""The one command the app may send (ADR-010): no network, no database. The client is a fake."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pytest

import app
from app.adapters import zeekr_sentry_command as command
from app.cli import zeekr_sentry_send as send

CANARY = "CANARY-VALUE-9f3a"
ENV = {name: f"{CANARY}-{name}" for name in send.REQUIRED}
ENV[send.CONFIRM_VARIABLE] = send.CONFIRM_VALUE


class FakeVehicle:
    def __init__(self, states: list[Any], accept: Any = True) -> None:
        self.states = list(states)
        self.accept = accept
        self.sent: list[tuple[str, str, dict[str, Any]]] = []
        self.reads = 0

    def get_remote_control_state(self) -> dict[str, Any]:
        value = self.states[min(self.reads, len(self.states) - 1)]
        self.reads += 1
        if isinstance(value, Exception):
            raise value
        return {"vstdModeState": value, "gpsstate": CANARY, "vstdModeStatusEventId": CANARY}

    def do_remote_control(self, cmd: str, service_id: str, setting: dict[str, Any]) -> Any:
        self.sent.append((cmd, service_id, setting))
        if isinstance(self.accept, Exception):
            raise self.accept
        return self.accept


class FakeClient:
    def __init__(self, vehicle: FakeVehicle | None, login_error: bool = False, **kw: Any) -> None:
        self.vehicle = vehicle
        self.login_error = login_error
        self.logins = 0

    def login(self) -> None:
        self.logins += 1
        if self.login_error:
            raise RuntimeError(f"token {CANARY}")

    def get_vehicle_list(self) -> list[FakeVehicle]:
        return [] if self.vehicle is None else [self.vehicle]


def run(
    capsys: pytest.CaptureFixture[str],
    args: list[str],
    vehicle: FakeVehicle | None,
    env: dict[str, str] | None = None,
    login_error: bool = False,
) -> tuple[int, str, str, list[FakeClient], list[float]]:
    made: list[FakeClient] = []
    slept: list[float] = []

    def factory(**kw: Any) -> FakeClient:
        made.append(FakeClient(vehicle, login_error, **kw))
        return made[-1]

    code = send.main(args, ENV if env is None else env, factory, slept.append)
    out = capsys.readouterr()
    return code, out.out, out.err, made, slept


def test_the_payload_is_constant_and_only_on_or_off_is_accepted() -> None:
    on = command.build_request("on")
    off = command.build_request("off")
    assert on[0] == "start" and off[0] == "stop"
    assert on[1] == off[1] == "RSM"
    assert on[2] == off[2] == {"serviceParameters": [{"key": "rsm", "value": "6"}]}
    for bad in ("", "ON", "toggle", "start", "1", "true", None, 1, True, ["on"]):
        with pytest.raises(ValueError):
            command.build_request(bad)  # type: ignore[arg-type]


def test_send_is_true_only_on_an_explicit_true() -> None:
    for reply, expected in (
        (True, True),
        (False, False),
        (None, False),
        ("yes", False),
        (1, False),
    ):
        assert command.send_sentry(FakeVehicle(["0"], reply), "on") is expected
    assert command.send_sentry(FakeVehicle(["0"], RuntimeError(CANARY)), "on") is False


def test_a_bad_request_sends_nothing() -> None:
    vehicle = FakeVehicle(["0"])
    with pytest.raises(ValueError):
        command.send_sentry(vehicle, "dance")
    assert vehicle.sent == []


def test_only_this_module_names_the_write_method() -> None:
    root = Path(app.__file__).parent
    allowed = {"zeekr_sentry_command.py"}
    for path in root.rglob("*.py"):
        text = path.read_text()
        names = re.findall(r"\bdo_remote_control\b|\bset_charge_plan\b|\bset_travel_plan\b", text)
        if path.name in allowed:
            assert set(names) == {"do_remote_control"}, path
        else:
            assert not names, path


def test_only_the_send_cli_imports_the_command_module() -> None:
    root = Path(app.__file__).parent
    for path in root.rglob("*.py"):
        if path.name in {"zeekr_sentry_send.py", "zeekr_sentry_command.py"}:
            continue
        assert "zeekr_sentry_command" not in path.read_text(), path


@pytest.mark.parametrize("args", [[], ["--on", "--off"], ["--toggle"], ["on"]])
def test_exactly_one_of_on_or_off_is_needed(
    capsys: pytest.CaptureFixture[str], args: list[str]
) -> None:
    vehicle = FakeVehicle(["0"])
    code, _, err, made, _ = run(capsys, args, vehicle)
    assert code == 2 and "Nothing was sent" in err
    assert made == [] and vehicle.sent == []


def test_it_needs_its_own_confirm_value_and_the_login_checks_value_is_not_enough(
    capsys: pytest.CaptureFixture[str],
) -> None:
    for env in (
        {k: v for k, v in ENV.items() if k != send.CONFIRM_VARIABLE},
        {**ENV, send.CONFIRM_VARIABLE: "one-attempt"},
        {**ENV, "ZEEKR_LOGIN_CHECK_CONFIRM": "one-attempt", send.CONFIRM_VARIABLE: ""},
    ):
        vehicle = FakeVehicle(["0"])
        code, _, err, made, _ = run(capsys, ["--on"], vehicle, env)
        assert code == 2 and made == [] and vehicle.sent == []
        assert "Nothing was sent" in err


def test_missing_app_values_send_nothing(capsys: pytest.CaptureFixture[str]) -> None:
    env = {k: v for k, v in ENV.items() if k != "ZEEKR_VIN_KEY"}
    code, _, err, made, _ = run(capsys, ["--on"], FakeVehicle(["0"]), env)
    assert code == 2 and made == [] and "ZEEKR_VIN_KEY" in err
    assert CANARY not in err


def test_on_sends_one_command_and_reads_back(capsys: pytest.CaptureFixture[str]) -> None:
    vehicle = FakeVehicle(["0", "1"])
    code, out, err, made, slept = run(capsys, ["--on"], vehicle)
    assert code == 0
    assert vehicle.sent == [("start", "RSM", {"serviceParameters": [{"key": "rsm", "value": "6"}]})]
    assert made[0].logins == 1 and slept == [send.WAIT_SECONDS]
    assert "state before: off" in out and "accepted the call: yes" in out
    assert "state after 15 seconds: on" in out
    assert CANARY not in out + err


def test_off_sends_stop(capsys: pytest.CaptureFixture[str]) -> None:
    vehicle = FakeVehicle(["1", "0"])
    code, out, _, _, _ = run(capsys, ["--off"], vehicle)
    assert code == 0 and vehicle.sent[0][0] == "stop"
    assert "state after 15 seconds: off" in out


def test_already_in_the_wanted_state_sends_nothing(capsys: pytest.CaptureFixture[str]) -> None:
    vehicle = FakeVehicle(["1"])
    code, out, _, _, slept = run(capsys, ["--on"], vehicle)
    assert code == 0 and vehicle.sent == [] and slept == []
    assert "Nothing was sent" in out


def test_accepted_but_state_unchanged_is_a_failure(capsys: pytest.CaptureFixture[str]) -> None:
    vehicle = FakeVehicle(["0", "0"])
    code, out, _, _, _ = run(capsys, ["--on"], vehicle)
    assert code == 1 and "accepted the call: yes" in out and "state after 15 seconds: off" in out


def test_refused_is_a_failure_and_prints_no_server_text(
    capsys: pytest.CaptureFixture[str],
) -> None:
    for accept in (False, None, RuntimeError(f"secret {CANARY}")):
        vehicle = FakeVehicle(["0", "0"], accept)
        code, out, err, _, _ = run(capsys, ["--on"], vehicle)
        assert code == 1 and "accepted the call: no" in out
        assert CANARY not in out + err
        assert len(vehicle.sent) == 1  # no retry


@pytest.mark.parametrize("odd", ["2", "true", "", None, 1])
def test_an_odd_state_is_printed_as_other(capsys: pytest.CaptureFixture[str], odd: Any) -> None:
    vehicle = FakeVehicle([odd, odd])
    code, out, _, _, _ = run(capsys, ["--on"], vehicle)
    assert "state before: other" in out and "state after 15 seconds: other" in out
    assert code == 1
    assert CANARY not in out


def test_login_failure_sends_nothing_and_prints_only_the_class(
    capsys: pytest.CaptureFixture[str],
) -> None:
    vehicle = FakeVehicle(["0"])
    code, out, err, made, _ = run(capsys, ["--on"], vehicle, login_error=True)
    assert code == 1 and vehicle.sent == [] and made[0].logins == 1
    assert "RuntimeError" in err and CANARY not in out + err


def test_empty_vehicle_list_and_unreadable_state_send_nothing(
    capsys: pytest.CaptureFixture[str],
) -> None:
    code, _, err, _, _ = run(capsys, ["--on"], None)
    assert code == 1 and "empty" in err
    vehicle = FakeVehicle([RuntimeError(f"x {CANARY}")])
    code, out, err, _, _ = run(capsys, ["--on"], vehicle)
    assert code == 1 and vehicle.sent == [] and CANARY not in out + err


def test_a_failed_read_back_does_not_resend(capsys: pytest.CaptureFixture[str]) -> None:
    vehicle = FakeVehicle(["0", RuntimeError(f"x {CANARY}")])
    code, out, err, _, _ = run(capsys, ["--on"], vehicle)
    assert code == 1 and len(vehicle.sent) == 1 and CANARY not in out + err


def test_nothing_but_the_labels_is_printed(capsys: pytest.CaptureFixture[str]) -> None:
    vehicle = FakeVehicle(["0", "1"])
    _, out, err, _, _ = run(capsys, ["--on"], vehicle)
    assert "gpsstate" not in out + err and "EventId" not in out + err
