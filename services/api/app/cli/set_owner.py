"""Create the owner account, or reset its username and password (ADR-006).

Usage (inside the api container):  python -m app.cli.set_owner
The password is prompted for, never taken as an argument, and is never printed or stored in plain
text. A reset takes effect on the next login with no restart. Tokens already issued stay valid
until they expire (one hour); rotate TOKEN_SECRET and restart to revoke them at once.
"""

from __future__ import annotations

import getpass
import sys

from app import security
from app.config import Settings
from app.db import create_db_engine, create_session_factory
from app.repositories.owner_account import OwnerAccountRepository

MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 1024  # the sign-in form and API accept no more than this


def main() -> int:
    try:
        return _run()
    except (KeyboardInterrupt, EOFError):
        print("\nCancelled. Nothing was changed.", file=sys.stderr)
        return 1


def _run() -> int:
    raw = input("Owner username: ")
    try:
        username = security.normalise_username(raw)
    except ValueError as exc:
        print(f"Username not accepted: {exc}.", file=sys.stderr)
        return 1
    password = getpass.getpass("Owner password: ")
    if len(password) < MIN_PASSWORD_LENGTH:
        print(f"Use at least {MIN_PASSWORD_LENGTH} characters.", file=sys.stderr)
        return 1
    if len(password) > MAX_PASSWORD_LENGTH:
        print(f"Use at most {MAX_PASSWORD_LENGTH} characters.", file=sys.stderr)
        return 1
    if password.lower() == username:
        print("The password must not be the username.", file=sys.stderr)
        return 1
    if getpass.getpass("Repeat password: ") != password:
        print("Passwords do not match.", file=sys.stderr)
        return 1

    engine = create_db_engine(Settings().database_url.get_secret_value())
    try:
        with create_session_factory(engine)() as session:
            existed = OwnerAccountRepository(session).get() is not None
            OwnerAccountRepository(session).upsert(username, security.hash_password(password))
    finally:
        engine.dispose()
    if existed:
        print("Owner account updated. Sessions already signed in last up to an hour.")
        print("To end them now, change TOKEN_SECRET in .env and run `docker compose up -d`.")
    else:
        print("Owner account created.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
