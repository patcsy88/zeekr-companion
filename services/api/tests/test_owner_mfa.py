"""ADR-013: second factor on the owner login, and the set_mfa command."""

from __future__ import annotations

import logging
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app import security, totp
from app.cli import set_mfa
from tests.conftest import PASSWORD, TOKEN_SECRET, USERNAME

URL = "/api/v1/auth/token"
SECRET = totp.new_secret()


@pytest.fixture(autouse=True)
def cheap_recovery_hashes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(totp, "RECOVERY_SCRYPT_N", 2**4)


def _db(client: TestClient) -> object:
    return client.app.state.engine  # type: ignore[attr-defined]


def _turn_on(client: TestClient, *, last_step: int = 0, recovery: list[str] | None = None) -> None:
    hashes = [totp.hash_recovery(c) for c in (recovery or [])]
    with _db(client).begin() as conn:  # type: ignore[attr-defined]
        conn.execute(text("DELETE FROM owner_mfa"))
        conn.execute(
            text(
                "INSERT INTO owner_mfa (id, secret, last_step, recovery_hashes, created_at, "
                "updated_at) VALUES (1, :s, :l, :r, now(), now())"
            ),
            {"s": SECRET, "l": last_step, "r": hashes},
        )


def _clear(client: TestClient) -> None:
    with _db(client).begin() as conn:  # type: ignore[attr-defined]
        conn.execute(text("DELETE FROM owner_mfa"))


def _login(client: TestClient, code: object = None, password: str = PASSWORD) -> object:
    body: dict[str, object] = {"username": USERNAME, "password": password}
    if code is not None:
        body["code"] = code
    return client.post(URL, json=body)


def _code(offset: int = 0) -> str:
    return totp.code_for_step(SECRET, totp.current_step() + offset)


@pytest.fixture(autouse=True)
def _reset_mfa(client: TestClient) -> None:
    _clear(client)


# --- MFA off: nothing changes ---------------------------------------------------------------


def test_without_mfa_the_password_alone_signs_in(client: TestClient) -> None:
    assert _login(client).status_code == 200  # type: ignore[attr-defined]


@pytest.mark.parametrize("code", ["123456", "garbage", "", "x" * 64])
def test_without_mfa_a_supplied_code_is_ignored(client: TestClient, code: str) -> None:
    assert _login(client, code).status_code == 200  # type: ignore[attr-defined]


def test_an_overlong_code_is_a_validation_error(client: TestClient) -> None:
    response = _login(client, "x" * 65)
    assert response.status_code == 400  # type: ignore[attr-defined]
    assert response.json()["error"]["code"] == "validation_error"  # type: ignore[attr-defined]


# --- MFA on ---------------------------------------------------------------------------------


def test_right_password_and_right_code_signs_in(client: TestClient) -> None:
    _turn_on(client)
    response = _login(client, _code())
    assert response.status_code == 200  # type: ignore[attr-defined]
    assert response.json()["access_token"]  # type: ignore[attr-defined]


def test_the_code_may_have_spaces_around_it(client: TestClient) -> None:
    _turn_on(client)
    assert _login(client, f" {_code()} ").status_code == 200  # type: ignore[attr-defined]


@pytest.mark.parametrize("code", [None, "", "000000", "abcdef", "12345", "1234567"])
def test_missing_or_wrong_code_is_the_same_401_as_a_wrong_password(
    client: TestClient, code: str | None
) -> None:
    _turn_on(client)
    wrong_password = _login(client, _code(), password="not the password")
    wrong_code = _login(client, code)
    assert wrong_code.status_code == wrong_password.status_code == 401  # type: ignore[attr-defined]
    assert wrong_code.json() == wrong_password.json()  # type: ignore[attr-defined]


def test_a_right_code_with_a_wrong_password_is_refused_and_not_spent(client: TestClient) -> None:
    _turn_on(client)
    code = _code()
    assert _login(client, code, password="not the password").status_code == 401  # type: ignore[attr-defined]
    assert _login(client, code).status_code == 200  # type: ignore[attr-defined]


def test_a_code_works_only_once(client: TestClient) -> None:
    _turn_on(client)
    code = _code()
    assert _login(client, code).status_code == 200  # type: ignore[attr-defined]
    assert _login(client, code).status_code == 401  # type: ignore[attr-defined]


def test_an_older_code_is_refused_after_a_newer_one_is_used(client: TestClient) -> None:
    _turn_on(client)
    assert _login(client, _code(+1)).status_code == 200  # type: ignore[attr-defined]
    assert _login(client, _code(0)).status_code == 401  # type: ignore[attr-defined]


def test_a_code_from_the_past_beyond_drift_is_refused(client: TestClient) -> None:
    _turn_on(client)
    assert _login(client, _code(-2)).status_code == 401  # type: ignore[attr-defined]


def test_the_step_is_remembered_in_the_database(client: TestClient) -> None:
    _turn_on(client)
    _login(client, _code())
    with _db(client).connect() as conn:  # type: ignore[attr-defined]
        step = conn.execute(text("SELECT last_step FROM owner_mfa")).scalar_one()
    assert abs(step - totp.current_step()) <= 1


def test_two_parallel_logins_cannot_both_spend_one_code(client: TestClient) -> None:
    """The second request passes the read check but loses the update."""
    _turn_on(client)
    step = totp.current_step()
    from app.repositories.owner_mfa import OwnerMfaRepository

    with client.app.state.session_factory() as session:  # type: ignore[attr-defined]
        repo = OwnerMfaRepository(session)
        assert repo.accept_step(step) is True
        assert repo.accept_step(step) is False


# --- Recovery codes -------------------------------------------------------------------------


def test_a_recovery_code_signs_in_once(client: TestClient) -> None:
    _turn_on(client, recovery=["abcde-fghjk", "mnpqr-stuvw"])
    assert _login(client, "abcde-fghjk").status_code == 200  # type: ignore[attr-defined]
    assert _login(client, "abcde-fghjk").status_code == 401  # type: ignore[attr-defined]
    assert _login(client, "MNPQR-STUVW").status_code == 200  # type: ignore[attr-defined]
    with _db(client).connect() as conn:  # type: ignore[attr-defined]
        left = conn.execute(text("SELECT cardinality(recovery_hashes) FROM owner_mfa")).scalar_one()
    assert left == 0


def test_a_wrong_recovery_code_is_refused_and_uses_nothing_up(client: TestClient) -> None:
    _turn_on(client, recovery=["abcde-fghjk"])
    assert _login(client, "abcde-fghjm").status_code == 401  # type: ignore[attr-defined]
    assert _login(client, "abcde-fghjk").status_code == 200  # type: ignore[attr-defined]


def test_a_recovery_code_with_a_wrong_password_is_not_spent(client: TestClient) -> None:
    _turn_on(client, recovery=["abcde-fghjk"])
    assert _login(client, "abcde-fghjk", password="not the password").status_code == 401  # type: ignore[attr-defined]
    assert _login(client, "abcde-fghjk").status_code == 200  # type: ignore[attr-defined]


# --- Lockout --------------------------------------------------------------------------------


def test_wrong_codes_count_toward_the_lockout(client: TestClient) -> None:
    _turn_on(client)  # the test app allows 3 failures
    for _ in range(3):
        assert _login(client, "000000").status_code == 401  # type: ignore[attr-defined]
    locked = _login(client, _code())
    assert locked.status_code == 429  # type: ignore[attr-defined]
    assert int(locked.headers["Retry-After"]) > 0  # type: ignore[attr-defined]


def test_a_missing_code_counts_toward_the_lockout(client: TestClient) -> None:
    _turn_on(client)
    for _ in range(3):
        assert _login(client).status_code == 401  # type: ignore[attr-defined]
    assert _login(client, _code()).status_code == 429  # type: ignore[attr-defined]


# --- Nothing leaks --------------------------------------------------------------------------


def test_failed_attempts_log_neither_the_code_nor_the_secret(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    _turn_on(client, recovery=["abcde-fghjk"])
    with caplog.at_level(logging.DEBUG):
        _login(client, "654321")
        _login(client, "abcde-fghjm")
        _login(client, _code(), password="not the password")
        _login(client, _code())
    text_out = caplog.text
    for secret in ("654321", "abcde-fghjm", "abcdefghjm", SECRET, PASSWORD, "not the password"):
        assert secret not in text_out


def test_the_response_never_contains_mfa_material(client: TestClient) -> None:
    _turn_on(client)
    body = _login(client, _code()).text  # type: ignore[attr-defined]
    assert SECRET not in body and "recovery" not in body


# --- The other endpoints are unchanged ------------------------------------------------------


def test_a_token_from_an_mfa_login_works_like_any_other(client: TestClient) -> None:
    _turn_on(client)
    token = _login(client, _code()).json()["access_token"]  # type: ignore[attr-defined]
    ok = client.get("/api/v1/vehicle", headers={"Authorization": f"Bearer {token}"})
    assert ok.status_code == 404  # signed in; no vehicle yet
    assert security.verify_token(TOKEN_SECRET, token)


def test_timing_does_not_depend_on_whether_the_password_was_right(client: TestClient) -> None:
    """The code is checked whatever the password did, so a wrong password costs the same work."""
    _turn_on(client)
    calls: list[str] = []
    real = totp.match_step

    def spy(secret: str, code: str, **kwargs: object) -> int | None:
        calls.append(code)
        return real(secret, code, **kwargs)  # type: ignore[arg-type]

    totp.match_step = spy  # type: ignore[assignment]
    try:
        _login(client, "111111", password="not the password")
        _login(client, "222222")
    finally:
        totp.match_step = real
    assert calls == ["111111", "222222"]
    time.sleep(0)


# --- set_mfa --------------------------------------------------------------------------------


@pytest.fixture
def cli_env(database_url: str, monkeypatch: pytest.MonkeyPatch, client: TestClient) -> str:
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("TOKEN_SECRET", TOKEN_SECRET)
    return database_url


def _mfa_row(url: str) -> tuple[str, int, list[str]] | None:
    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT secret, last_step, recovery_hashes FROM owner_mfa")
            ).first()
            return (row[0], row[1], list(row[2])) if row else None
    finally:
        engine.dispose()


def _feed_codes(monkeypatch: pytest.MonkeyPatch, *answers: str) -> list[str]:
    """Answer the confirmation prompt; each answer may be a function of the printed secret."""
    prompts: list[str] = []
    queue = iter(answers)

    def fake_input(prompt: str = "") -> str:
        prompts.append(prompt)
        return next(queue)

    monkeypatch.setattr("builtins.input", fake_input)
    return prompts


def _printed_secret(out: str) -> str:
    line = next(ln for ln in out.splitlines() if ln.startswith("Key (time-based"))
    return line.split(": ", 1)[1].strip()


def test_set_mfa_saves_only_after_a_right_code(
    cli_env: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    captured: dict[str, str] = {}
    real = totp.new_secret

    def fixed() -> str:
        captured["secret"] = real()
        return captured["secret"]

    monkeypatch.setattr(totp, "new_secret", fixed)

    def answer(_prompt: str = "") -> str:
        return totp.code_for_step(captured["secret"], totp.current_step())

    monkeypatch.setattr("builtins.input", answer)
    assert set_mfa.main([]) == 0
    out = capsys.readouterr().out
    row = _mfa_row(cli_env)
    assert row is not None
    secret, last_step, hashes = row
    assert secret == captured["secret"] == _printed_secret(out)
    assert abs(last_step - totp.current_step()) <= 1
    assert len(hashes) == totp.RECOVERY_COUNT and all(h.startswith("scrypt:") for h in hashes)
    assert "otpauth://" not in out  # the link is drawn as a QR code, not printed
    assert "Two-step sign-in is on." in out
    printed = [ln.strip() for ln in out.splitlines() if len(ln.strip()) == 11 and "-" in ln]
    assert len(printed) == totp.RECOVERY_COUNT
    for code, stored in zip(printed, hashes, strict=True):
        assert totp.find_recovery(code, [stored]) == stored  # printed codes match what is kept
        assert code.replace("-", "") not in stored


def test_set_mfa_saves_nothing_if_the_code_is_never_right(
    cli_env: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _feed_codes(monkeypatch, "000000", "111111", "222222")
    assert set_mfa.main([]) == 1
    assert _mfa_row(cli_env) is None
    assert "Nothing was changed" in capsys.readouterr().err


def test_set_mfa_replacing_voids_the_old_secret_and_codes(
    cli_env: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    secrets_seen: list[str] = []
    real = totp.new_secret

    def fixed() -> str:
        secrets_seen.append(real())
        return secrets_seen[-1]

    monkeypatch.setattr(totp, "new_secret", fixed)
    monkeypatch.setattr(
        "builtins.input",
        lambda _p="": totp.code_for_step(secrets_seen[-1], totp.current_step() + 1),
    )
    assert set_mfa.main([]) == 0
    first = _mfa_row(cli_env)
    capsys.readouterr()
    assert set_mfa.main([]) == 0
    second = _mfa_row(cli_env)
    assert first and second and first[0] != second[0] and first[2] != second[2]
    assert "void" in capsys.readouterr().out


def test_set_mfa_needs_an_owner_account(
    cli_env: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    engine = create_engine(cli_env)
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE owner_account"))
    engine.dispose()
    assert set_mfa.main([]) == 1
    assert "set_owner" in capsys.readouterr().err
    assert _mfa_row(cli_env) is None


def test_set_mfa_off_removes_it_and_is_safe_to_repeat(
    cli_env: str, client: TestClient, capsys: pytest.CaptureFixture[str]
) -> None:
    _turn_on(client)
    assert _mfa_row(cli_env) is not None
    assert set_mfa.main(["--off"]) == 0
    assert _mfa_row(cli_env) is None
    assert "off" in capsys.readouterr().out
    assert _login(client).status_code == 200  # type: ignore[attr-defined]
    assert set_mfa.main(["--off"]) == 0
    assert "not set up" in capsys.readouterr().out


def test_set_mfa_rejects_unknown_arguments(capsys: pytest.CaptureFixture[str]) -> None:
    assert set_mfa.main(["--nope"]) == 2
    assert "Usage" in capsys.readouterr().err


def test_set_mfa_cancelled_changes_nothing(
    cli_env: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def interrupt(_prompt: str = "") -> str:
        raise KeyboardInterrupt

    monkeypatch.setattr("builtins.input", interrupt)
    assert set_mfa.main([]) == 1
    assert _mfa_row(cli_env) is None
    assert "Cancelled" in capsys.readouterr().err
