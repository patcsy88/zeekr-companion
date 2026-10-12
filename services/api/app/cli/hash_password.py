"""Create a value for OWNER_PASSWORD_HASH.

Usage: python -m app.cli.hash_password   (prompts; the password is never echoed or stored)
"""

from __future__ import annotations

import getpass
import sys

from app.security import hash_password


def main() -> int:
    password = getpass.getpass("Owner password: ")
    if len(password) < 12:
        print("Use at least 12 characters.", file=sys.stderr)
        return 1
    if getpass.getpass("Repeat password: ") != password:
        print("Passwords do not match.", file=sys.stderr)
        return 1
    print(hash_password(password))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
