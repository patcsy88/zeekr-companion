"""Print the OpenAPI schema (source for generated shared types).

The live API does not serve /openapi.json because every endpoint except /health needs auth.
Usage: python -m app.cli.export_openapi > openapi.json
"""

from __future__ import annotations

import json
from typing import Any

from pydantic import SecretStr

from app.config import Settings
from app.main import create_app
from app.security import hash_password


def build_schema() -> dict[str, Any]:
    settings = Settings(
        database_url=SecretStr("postgresql+psycopg://unused:unused@localhost/unused"),
        owner_password_hash=SecretStr(hash_password("unused", n=2**4)),
        token_secret=SecretStr("Unused0Schema1Export2Only3Key4Zz"),
    )
    return create_app(settings).openapi()


def main() -> int:
    print(json.dumps(build_schema(), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
