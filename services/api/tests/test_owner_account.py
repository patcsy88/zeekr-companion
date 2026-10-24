"""ADR-006: owner account login, reset command and the no-account state."""

from __future__ import annotations

import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DataError, IntegrityError

from app import security
from app.cli import set_owner
from tests.conftest import PASSWORD, TOKEN_SECRET, USERNAME, seed_owner

URL = "/api/v1/auth/token"


def _login(client: TestClient, username: object, password: object) -> object:
    return client.post(URL, json={"username": username, "password": password})


def test_login_succeeds_with_username_and_password(client: TestClient) -> None:
    response = _login(client, USERNAME, PASSWORD)
    assert response.status_code == 200  # type: ignore[attr-defined]


@pytest.mark.parametrize("username", ["OWNER-TEST", "  owner-test  ", "Owner-Test"])
def test_username_is_trimmed_and_case_insensitive(client: TestClient, username: str) -> None:
    assert _login(client, username, PASSWORD).status_code == 200  # type: ignore[attr-defined]


def test_password_only_body_is_rejected(client: TestClient) -> None:
    response = client.post(URL, json={"password": PASSWORD})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "validation_error"


@pytest.mark.parametrize("username", ["ab", "a" * 65, "   ", "", "own\x00er", "own\ter", "own\nr"])
def test_invalid_username_is_a_validation_error(client: TestClient, username: str) -> None:
    response = _login(client, username, PASSWORD)
    assert response.status_code == 400  # type: ignore[attr-defined]
    assert response.json()["error"]["code"] == "validation_error"  # type: ignore[attr-defined]


def test_unknown_username_and_wrong_password_look_identical(client: TestClient) -> None:
    unknown = _login(client, "someone-else", PASSWORD)
    wrong = _login(client, USERNAME, "not the password")
    assert unknown.status_code == wrong.status_code == 401  # type: ignore[attr-defined]
    assert unknown.json() == wrong.json()  # type: ignore[attr-defined]


def test_unknown_username_still_runs_one_scrypt_check(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []
    real = security.verify_password

    def spy(password: str, stored: str) -> bool:
        calls.append(stored)
        return real(password, stored)

    monkeypatch.setattr(security, "verify_password", spy)
    _login(client, "someone-else", PASSWORD)
    assert len(calls) == 1
    # The right password for the wrong username must not log in, even though the hash matches.
    assert _login(client, "someone-else", PASSWORD).status_code == 401  # type: ignore[attr-defined]


def test_failed_login_does_not_log_the_username(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    typed_by_mistake = "my-secret-typed-in-username-box"
    with caplog.at_level(logging.INFO):
        _login(client, typed_by_mistake, "wrong password")
        _login(client, USERNAME, "wrong password")
    assert "failed login attempt" in caplog.text
    assert typed_by_mistake not in caplog.text
    assert USERNAME not in caplog.text


def test_unknown_usernames_count_towards_the_lockout(client: TestClient) -> None:
    for _ in range(3):  # login_max_failures is 3 in the test settings
        assert _login(client, "someone-else", "x").status_code == 401  # type: ignore[attr-defined]
    blocked = _login(client, USERNAME, PASSWORD)
    assert blocked.status_code == 429  # type: ignore[attr-defined]


def test_no_account_gives_the_same_401_and_logs_a_warning(
    client: TestClient, database_url: str, caplog: pytest.LogCaptureFixture
) -> None:
    engine = create_engine(database_url)
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE owner_account"))
    engine.dispose()
    with caplog.at_level(logging.WARNING):
        response = _login(client, USERNAME, PASSWORD)
    assert response.status_code == 401  # type: ignore[attr-defined]
    assert response.json()["error"]["code"] == "unauthenticated"  # type: ignore[attr-defined]
    assert "set_owner" in caplog.text
    assert PASSWORD not in caplog.text


def test_reset_applies_without_a_restart(client: TestClient, database_url: str) -> None:
    assert _login(client, USERNAME, PASSWORD).status_code == 200  # type: ignore[attr-defined]
    new_hash = security.hash_password("a brand new password", n=2**4)
    seed_owner(database_url, new_hash, username="new-name")
    assert _login(client, USERNAME, PASSWORD).status_code == 401  # type: ignore[attr-defined]
    assert _login(client, "new-name", "a brand new password").status_code == 200  # type: ignore[attr-defined]


def test_issued_token_stays_valid_after_reset_until_it_expires(
    client: TestClient, database_url: str
) -> None:
    token = _login(client, USERNAME, PASSWORD).json()["access_token"]  # type: ignore[attr-defined]
    seed_owner(database_url, security.hash_password("another password!", n=2**4), "other-name")
    ok = client.get("/api/v1/vehicle", headers={"Authorization": f"Bearer {token}"})
    assert ok.status_code == 404  # authenticated (no vehicle yet), as ADR-006 documents


def test_token_does_not_carry_the_username(client: TestClient) -> None:
    token = _login(client, USERNAME, PASSWORD).json()["access_token"]  # type: ignore[attr-defined]
    payload = security._unb64(token.split(".")[0]).decode()
    assert USERNAME not in payload
    assert '"sub":"owner"' in payload


def test_token_secret_helper_still_verifies(client: TestClient) -> None:
    token = _login(client, USERNAME, PASSWORD).json()["access_token"]  # type: ignore[attr-defined]
    assert security.verify_token(TOKEN_SECRET, token)


# --- the table -----------------------------------------------------------------------------


def test_only_one_owner_account_row_can_exist(database_url: str, password_hash: str) -> None:
    seed_owner(database_url, password_hash)
    engine = create_engine(database_url)
    try:
        with pytest.raises(IntegrityError), engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO owner_account (id, username, password_hash) "
                    "VALUES (gen_random_uuid(), 'second-owner', 'x')"
                )
            )
    finally:
        engine.dispose()


@pytest.mark.parametrize("username", ["Upper-Case", "ab", "a" * 65])
# 65 characters is stopped by varchar(64) (DataError); the others by the check constraint.
def test_table_rejects_a_bad_username(database_url: str, username: str) -> None:
    engine = create_engine(database_url)
    try:
        with pytest.raises((IntegrityError, DataError)), engine.begin() as conn:
            conn.execute(text("TRUNCATE owner_account"))
            conn.execute(
                text(
                    "INSERT INTO owner_account (id, username, password_hash) "
                    "VALUES (gen_random_uuid(), :u, 'x')"
                ),
                {"u": username},
            )
    finally:
        engine.dispose()


# --- set_owner -----------------------------------------------------------------------------


@pytest.fixture
def cli_env(database_url: str, monkeypatch: pytest.MonkeyPatch) -> str:
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setenv("TOKEN_SECRET", TOKEN_SECRET)
    engine = create_engine(database_url)
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE owner_account"))
    engine.dispose()
    return database_url


def _feed(monkeypatch: pytest.MonkeyPatch, username: str, *passwords: str) -> None:
    monkeypatch.setattr("builtins.input", lambda _prompt="": username)
    answers = iter(passwords)
    monkeypatch.setattr(set_owner.getpass, "getpass", lambda _prompt="": next(answers))


def _row(url: str) -> tuple[str, str] | None:
    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            row = conn.execute(text("SELECT username, password_hash FROM owner_account")).first()
            return (row[0], row[1]) if row else None
    finally:
        engine.dispose()


def test_set_owner_creates_then_resets(
    cli_env: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _feed(monkeypatch, "  Boss-Name ", "first password 123", "first password 123")
    assert set_owner.main() == 0
    assert "created" in capsys.readouterr().out
    username, stored = _row(cli_env)  # type: ignore[misc]
    assert username == "boss-name"
    assert security.verify_password("first password 123", stored)
    assert "first password 123" not in stored
    assert stored.startswith(f"scrypt:{2**17}:8:1:")  # default cost, not the test cost

    _feed(monkeypatch, "boss-name", "second password 456", "second password 456")
    assert set_owner.main() == 0
    assert "updated" in capsys.readouterr().out
    username, stored = _row(cli_env)  # type: ignore[misc]
    assert security.verify_password("second password 456", stored)
    assert not security.verify_password("first password 123", stored)


def test_set_owner_never_prints_the_password(
    cli_env: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _feed(monkeypatch, "boss-name", "never-print-this-1", "never-print-this-1")
    set_owner.main()
    captured = capsys.readouterr()
    assert "never-print-this-1" not in captured.out + captured.err


@pytest.mark.parametrize(
    ("username", "first", "second", "message"),
    [
        ("boss-name", "short", "short", "at least 12"),
        ("boss-name", "long enough pw 1", "long enough pw 2", "do not match"),
        ("ab", "long enough pw 1", "long enough pw 1", "Username not accepted"),
    ],
)
def test_set_owner_refuses_bad_input_and_changes_nothing(
    cli_env: str,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    username: str,
    first: str,
    second: str,
    message: str,
) -> None:
    _feed(monkeypatch, username, first, second)
    assert set_owner.main() == 1
    assert message in capsys.readouterr().err
    assert _row(cli_env) is None


def test_login_works_for_an_account_made_by_set_owner(
    cli_env: str, monkeypatch: pytest.MonkeyPatch, client: TestClient, database_url: str
) -> None:
    _feed(monkeypatch, "cli-owner", "cli made password 1", "cli made password 1")
    assert set_owner.main() == 0
    assert _login(client, "CLI-Owner", "cli made password 1").status_code == 200  # type: ignore[attr-defined]


def test_non_ascii_username_is_rejected(client: TestClient) -> None:
    for name in ("ownér-name", "İowner"):
        response = _login(client, name, PASSWORD)
        assert response.status_code == 400  # type: ignore[attr-defined]


def test_set_owner_refuses_long_password_or_password_equal_to_username(
    cli_env: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    long_pw = "x" * 1025
    _feed(monkeypatch, "boss-name", long_pw, long_pw)
    assert set_owner.main() == 1
    assert "at most" in capsys.readouterr().err
    _feed(monkeypatch, "boss-name-long", "boss-name-long", "boss-name-long")
    assert set_owner.main() == 1
    assert "must not be the username" in capsys.readouterr().err
    assert _row(cli_env) is None


def test_set_owner_cancel_is_clean(
    cli_env: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def boom(_prompt: str = "") -> str:
        raise EOFError

    monkeypatch.setattr("builtins.input", boom)
    assert set_owner.main() == 1
    assert "Nothing was changed" in capsys.readouterr().err
    assert _row(cli_env) is None


def test_set_owner_reset_mentions_existing_sessions(
    cli_env: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _feed(monkeypatch, "boss-name", "first password 123", "first password 123")
    set_owner.main()
    capsys.readouterr()
    _feed(monkeypatch, "boss-name", "second password 456", "second password 456")
    set_owner.main()
    assert "TOKEN_SECRET" in capsys.readouterr().out
