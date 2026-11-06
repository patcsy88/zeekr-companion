"""Set up, replace or remove two-step sign-in for the owner (ADR-013).

Usage (inside the api container):
    python -m app.cli.set_mfa          set up, or replace an existing setup
    python -m app.cli.set_mfa --off    remove it (the password alone signs in again)

Setup prints a QR code for an authenticator app (Google Authenticator and others), the same secret
as text for an app that cannot scan, and 8 one-time recovery codes. The codes are shown once and
only their hashes are kept. Nothing is saved until a current code from the app has been entered, so
a bad scan cannot lock the owner out. Run it on the host, in a private terminal: the output holds
the secret, so do not paste it into chat or a ticket and do not save the terminal log.

Setting up needs an owner account (`python -m app.cli.set_owner`). Sessions already signed in last
up to an hour; rotate TOKEN_SECRET and restart to end them at once.
"""

from __future__ import annotations

import sys

import segno

from app import totp
from app.config import Settings
from app.db import create_db_engine, create_session_factory
from app.repositories.owner_account import OwnerAccountRepository
from app.repositories.owner_mfa import OwnerMfaRepository

ISSUER = "Zeekr Companion"
MAX_TRIES = 3


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if args not in ([], ["--off"]):
        print("Usage: python -m app.cli.set_mfa [--off]", file=sys.stderr)
        return 2
    try:
        return _off() if args == ["--off"] else _setup()
    except (KeyboardInterrupt, EOFError):
        print("\nCancelled. Nothing was changed.", file=sys.stderr)
        return 1


def _off() -> int:
    engine = create_db_engine(Settings().database_url.get_secret_value())
    try:
        with create_session_factory(engine)() as session:
            removed = OwnerMfaRepository(session).remove()
    finally:
        engine.dispose()
    if removed:
        print("Two-step sign-in is off. The password alone signs in again.")
        print("Sessions already signed in last up to an hour.")
    else:
        print("Two-step sign-in was not set up. Nothing changed.")
    return 0


def _setup() -> int:
    engine = create_db_engine(Settings().database_url.get_secret_value())
    try:
        factory = create_session_factory(engine)
        with factory() as session:
            account = OwnerAccountRepository(session).get()
            replacing = OwnerMfaRepository(session).get() is not None
        if account is None:
            print(
                "There is no owner account. Run `python -m app.cli.set_owner` first.",
                file=sys.stderr,
            )
            return 1

        secret = totp.new_secret()
        uri = totp.provisioning_uri(secret, account.username, ISSUER)
        print("Scan this QR code with your authenticator app:\n")
        segno.make(uri, error="m").terminal(compact=True)
        print(f"\nCannot scan? Add it by hand. Account: {account.username}")
        print(f"Key (time-based, 6 digits): {secret}\n")

        step = _confirm(secret)
        if step is None:
            print("Not confirmed. Nothing was changed.", file=sys.stderr)
            return 1

        codes = totp.new_recovery_codes()
        with factory() as session:
            OwnerMfaRepository(session).replace(
                secret, step, [totp.hash_recovery(code) for code in codes]
            )
    finally:
        engine.dispose()

    print(
        "Two-step sign-in is on."
        + (" The earlier setup and its recovery codes are void." if replacing else "")
    )
    print("\nRecovery codes. Each works once, instead of the app code. Keep them off this phone.")
    print("They are not shown again:\n")
    for code in codes:
        print(f"  {code}")
    print(
        "\nSessions already signed in last up to an hour. To end them now, change TOKEN_SECRET"
        " and restart."
    )
    return 0


def _confirm(secret: str) -> int | None:
    """Ask for a current code up to MAX_TRIES times; return its time step if one is right."""
    for _ in range(MAX_TRIES):
        entered = input("Enter the 6-digit code now shown in the app: ").strip()
        step = totp.match_step(secret, entered, after_step=-1)
        if step is not None:
            return step
        print(
            "That code did not match. Check the phone clock and try the next code.", file=sys.stderr
        )
    return None


if __name__ == "__main__":
    raise SystemExit(main())
