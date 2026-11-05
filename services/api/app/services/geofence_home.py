"""The geofence home point (Piece B, owner-approved 2026-11-05).

The home point is either set by hand (`GEOFENCE_HOME_LAT` and `GEOFENCE_HOME_LON`) or found once
from `GEOFENCE_HOME_QUERY` with the public Nominatim service. The lookup runs at most once per
query: the result is kept in a small file on the host volume with a hash of the query, so a restart
makes no request, and a changed query makes one. A failed lookup is not retried until the API
restarts, and leaves the geofence off.

Nothing here logs the query or the coordinates, and nothing here raises with them.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import urllib.parse
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.config import Settings

log = logging.getLogger("app.geofence_home")

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "ZeekrCompanion/0.1 (self-hosted personal app, one lookup)"
TIMEOUT_S = 10.0
MAX_REPLY_BYTES = 65_536
FILE_NAME = "home.json"
_urlopen = urllib.request.urlopen  # looked up at call time, so a test can replace it


@dataclass(frozen=True)
class HomePoint:
    latitude: float = field(repr=False)
    longitude: float = field(repr=False)


Fetch = Callable[[str], tuple[float, float] | None]


def _valid(lat: object, lon: object) -> tuple[float, float] | None:
    try:
        a, b = float(lat), float(lon)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if not (math.isfinite(a) and math.isfinite(b)):
        return None
    if not (-90.0 <= a <= 90.0 and -180.0 <= b <= 180.0):
        return None
    return a, b


def nominatim_lookup(query: str, opener: Any = None) -> tuple[float, float] | None:
    """One request to the public Nominatim API. Returns (lat, lon), or None for any failure.
    The query is sent as the `q` parameter and is never logged."""
    params = urllib.parse.urlencode(
        {"q": query, "format": "jsonv2", "limit": "1", "countrycodes": "my"}
    )
    request = urllib.request.Request(  # noqa: S310  (constant https URL)
        f"{NOMINATIM_URL}?{params}", headers={"User-Agent": USER_AGENT}
    )
    open_url = opener if opener is not None else _urlopen
    try:
        with open_url(request, timeout=TIMEOUT_S) as response:
            body = response.read(MAX_REPLY_BYTES)
        data = json.loads(body)
    except Exception:
        return None
    if not isinstance(data, list) or not data or not isinstance(data[0], dict):
        return None
    return _valid(data[0].get("lat"), data[0].get("lon"))


def _digest(query: str) -> str:
    return hashlib.sha256(b"zeekr-companion-geofence:" + query.strip().encode()).hexdigest()


class HomeResolver:
    def __init__(self, settings: Settings, fetch: Fetch | None = None) -> None:
        self._settings = settings
        self._fetch: Fetch = fetch if fetch is not None else nominatim_lookup
        self._point: HomePoint | None = None
        self._done = False

    @property
    def _path(self) -> Path:
        return Path(self._settings.geofence_state_dir) / FILE_NAME

    def resolve(self) -> HomePoint | None:
        if self._done:
            return self._point
        self._point = self._find()
        self._done = True
        return self._point

    def _find(self) -> HomePoint | None:
        s = self._settings
        if s.geofence_home_lat is not None and s.geofence_home_lon is not None:
            manual = _valid(
                s.geofence_home_lat.get_secret_value(), s.geofence_home_lon.get_secret_value()
            )
            return HomePoint(*manual) if manual else None
        if s.geofence_home_query is None:
            return None
        query = s.geofence_home_query.get_secret_value().strip()
        if not query:
            return None
        digest = _digest(query)
        saved = self._read_saved(digest)
        if saved is not None:
            return saved
        try:
            found = self._fetch(query)
        except Exception:
            found = None
        checked = _valid(*found) if found else None
        if checked is None:
            log.warning("Geofence home lookup gave no result")
            return None
        self._save(digest, checked)
        return HomePoint(*checked)

    def _read_saved(self, digest: str) -> HomePoint | None:
        try:
            data = json.loads(self._path.read_text())
        except (OSError, ValueError):
            return None
        if not isinstance(data, dict) or data.get("query_sha256") != digest:
            return None
        point = _valid(data.get("latitude"), data.get("longitude"))
        return HomePoint(*point) if point else None

    def _save(self, digest: str, point: tuple[float, float]) -> None:
        folder = self._path.parent
        temp = folder / (FILE_NAME + ".tmp")
        try:
            folder.mkdir(mode=0o700, parents=True, exist_ok=True)
            payload = json.dumps(
                {"query_sha256": digest, "latitude": point[0], "longitude": point[1]}
            )
            fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as handle:
                handle.write(payload)
            os.replace(temp, self._path)
        except OSError:
            log.warning("Geofence home point could not be saved; it is kept in memory only")
