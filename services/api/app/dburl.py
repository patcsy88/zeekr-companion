"""DATABASE_URL validation that never echoes the URL.

SQLAlchemy's own parse errors quote fragments of the URL (for example the part of an un-encoded
password after an '@' or ':'). Every code path that parses DATABASE_URL goes through here so the
password cannot reach stderr, logs or a traceback.
"""

from __future__ import annotations

from sqlalchemy.engine import make_url

_SCHEME = "postgresql+psycopg://"

MALFORMED_MESSAGE = (
    "DATABASE_URL is malformed. If the password contains '@', ':', '/' or '%', "
    "percent-encode it (for example '@' as %40). The URL is not shown to protect the password."
)


def normalise_database_url(url: str) -> str:
    """Return a `postgresql+psycopg://` URL, or raise ValueError with a message free of the URL."""
    if url.startswith("postgresql://"):
        url = _SCHEME + url.removeprefix("postgresql://")
    if not url.startswith(_SCHEME):
        raise ValueError("DATABASE_URL must be a PostgreSQL URL (postgresql://...)")
    try:
        make_url(url)
    except Exception:
        raise ValueError(MALFORMED_MESSAGE) from None
    return url
