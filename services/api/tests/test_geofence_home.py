"""Piece B (approved 2026-11-05): how the home point is found. Fake lookup only, never the network.

The query and the coordinates used here are made up. Nothing here may reach a log line.
"""

from __future__ import annotations

import json
import logging
import os
import stat
from pathlib import Path
from typing import Any

import pytest
from pydantic import SecretStr

from app.config import Settings
from app.services import geofence_home
from app.services.geofence_home import HomeResolver, nominatim_lookup
from tests.conftest import make_settings

QUERY = "Jalan Contoh Canary, Bandar Fiksyen 99999"
LAT, LON = 10.123457, 20.654321


def settings_for(tmp_path: Path, **kw: Any) -> Settings:
    base = make_settings("postgresql+psycopg://u:p@localhost/db")
    return base.model_copy(update={"geofence_state_dir": str(tmp_path), **kw})


class Fetch:
    def __init__(self, result: Any = (LAT, LON)) -> None:
        self.result = result
        self.queries: list[str] = []

    def __call__(self, query: str) -> Any:
        self.queries.append(query)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def with_query(tmp_path: Path, query: str = QUERY) -> Settings:
    return settings_for(tmp_path, geofence_home_query=SecretStr(query))


def test_manual_coordinates_win_and_nothing_is_looked_up_or_saved(tmp_path: Path) -> None:
    fetch = Fetch()
    s = settings_for(
        tmp_path,
        geofence_home_query=SecretStr(QUERY),
        geofence_home_lat=SecretStr("1.5"),
        geofence_home_lon=SecretStr("2.5"),
    )
    point = HomeResolver(s, fetch).resolve()
    assert point is not None and (point.latitude, point.longitude) == (1.5, 2.5)
    assert fetch.queries == []
    assert list(tmp_path.iterdir()) == []


def test_one_lookup_then_the_saved_file_serves_every_later_call(tmp_path: Path) -> None:
    fetch = Fetch()
    resolver = HomeResolver(with_query(tmp_path), fetch)
    first = resolver.resolve()
    assert first is not None and (first.latitude, first.longitude) == (LAT, LON)
    assert resolver.resolve() == first
    assert fetch.queries == [QUERY]
    saved = tmp_path / "home.json"
    assert stat.S_IMODE(os.stat(saved).st_mode) == 0o600
    assert QUERY not in saved.read_text()


def test_a_restart_with_the_same_query_makes_no_request(tmp_path: Path) -> None:
    HomeResolver(with_query(tmp_path), Fetch()).resolve()
    again = Fetch()
    point = HomeResolver(with_query(tmp_path), again).resolve()
    assert point is not None and (point.latitude, point.longitude) == (LAT, LON)
    assert again.queries == []


def test_a_changed_query_is_looked_up_again(tmp_path: Path) -> None:
    HomeResolver(with_query(tmp_path), Fetch()).resolve()
    other = Fetch((1.25, 2.75))
    point = HomeResolver(with_query(tmp_path, QUERY + " 2"), other).resolve()
    assert point is not None and (point.latitude, point.longitude) == (1.25, 2.75)
    assert len(other.queries) == 1


def test_a_failed_lookup_is_not_retried_until_restart(tmp_path: Path) -> None:
    fetch = Fetch(None)
    resolver = HomeResolver(with_query(tmp_path), fetch)
    assert resolver.resolve() is None
    assert resolver.resolve() is None
    assert len(fetch.queries) == 1
    assert list(tmp_path.iterdir()) == []
    retry = Fetch()
    assert HomeResolver(with_query(tmp_path), retry).resolve() is not None
    assert len(retry.queries) == 1


def test_a_lookup_that_raises_is_a_failed_lookup(tmp_path: Path) -> None:
    resolver = HomeResolver(with_query(tmp_path), Fetch(RuntimeError(QUERY)))
    assert resolver.resolve() is None


def test_a_damaged_file_counts_as_absent(tmp_path: Path) -> None:
    (tmp_path / "home.json").write_text("{not json")
    fetch = Fetch()
    assert HomeResolver(with_query(tmp_path), fetch).resolve() is not None
    assert len(fetch.queries) == 1


def test_a_file_with_out_of_range_numbers_counts_as_absent(tmp_path: Path) -> None:
    HomeResolver(with_query(tmp_path), Fetch()).resolve()
    path = tmp_path / "home.json"
    data = json.loads(path.read_text())
    data["latitude"] = 123.0
    path.write_text(json.dumps(data))
    fetch = Fetch()
    assert HomeResolver(with_query(tmp_path), fetch).resolve() is not None
    assert len(fetch.queries) == 1


def test_neither_query_nor_coordinates_means_no_point(tmp_path: Path) -> None:
    fetch = Fetch()
    assert HomeResolver(settings_for(tmp_path), fetch).resolve() is None
    assert fetch.queries == []


def test_an_unwritable_folder_keeps_the_point_in_memory(tmp_path: Path) -> None:
    blocked = tmp_path / "file-not-folder"
    blocked.write_text("x")
    point = HomeResolver(settings_for(blocked, geofence_home_query=SecretStr(QUERY)), Fetch())
    assert point.resolve() is not None


def test_nothing_about_the_home_point_reaches_a_log(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    HomeResolver(with_query(tmp_path), Fetch()).resolve()
    HomeResolver(
        with_query(tmp_path / "x", "other canary query"), Fetch(RuntimeError(QUERY))
    ).resolve()
    HomeResolver(with_query(tmp_path / "y"), Fetch(None)).resolve()
    blocked = tmp_path / "blocked"
    blocked.write_text("x")
    HomeResolver(settings_for(blocked, geofence_home_query=SecretStr(QUERY)), Fetch()).resolve()
    for secret in (QUERY, "canary", "10.1234", "20.6543", str(LAT), str(LON)):
        assert secret not in caplog.text


def test_the_point_does_not_show_in_a_repr(tmp_path: Path) -> None:
    point = HomeResolver(with_query(tmp_path), Fetch()).resolve()
    assert point is not None
    assert "10.12" not in repr(point) and "20.65" not in repr(point)


class Response:
    def __init__(self, body: bytes) -> None:
        self.body = body
        self.limit: int | None = None

    def __enter__(self) -> Response:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def read(self, limit: int | None = None) -> bytes:
        self.limit = limit
        return self.body


class Opener:
    def __init__(self, body: bytes | Exception) -> None:
        self.body = body
        self.requests: list[Any] = []
        self.timeouts: list[float] = []
        self.response: Response | None = None

    def __call__(self, request: Any, timeout: float) -> Response:
        self.requests.append(request)
        self.timeouts.append(timeout)
        if isinstance(self.body, Exception):
            raise self.body
        self.response = Response(self.body)
        return self.response


def test_the_request_goes_to_the_public_service_over_https_with_an_identifying_agent() -> None:
    opener = Opener(b'[{"lat": "1.5", "lon": "2.5"}]')
    assert nominatim_lookup(QUERY, opener) == (1.5, 2.5)
    (request,) = opener.requests
    url = request.full_url
    assert url.startswith("https://nominatim.openstreetmap.org/search?")
    assert "limit=1" in url and "format=jsonv2" in url and "countrycodes=my" in url
    assert "q=Jalan+Contoh+Canary" in url
    agent = request.get_header("User-agent")
    assert agent.startswith("ZeekrCompanion/")
    assert opener.timeouts == [10.0]
    assert opener.response is not None and opener.response.limit == 65_536


@pytest.mark.parametrize(
    "body",
    [
        b"[]",
        b"not json",
        b"{}",
        b'[{"lat": "x", "lon": "2"}]',
        b'[{"lat": "95", "lon": "2"}]',
        b'[{"lat": "1", "lon": "181"}]',
        b'[{"lat": "nan", "lon": "2"}]',
        b'[{"lat": "1"}]',
        b"[1]",
    ],
)
def test_an_unusable_reply_is_no_result(body: bytes) -> None:
    assert nominatim_lookup(QUERY, Opener(body)) is None


def test_a_failing_request_is_no_result_and_logs_nothing(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    assert nominatim_lookup(QUERY, Opener(OSError(QUERY))) is None
    assert QUERY not in caplog.text


def test_tests_cannot_reach_the_real_service() -> None:
    with pytest.raises(AssertionError):
        geofence_home._urlopen("https://example.invalid", timeout=1)
