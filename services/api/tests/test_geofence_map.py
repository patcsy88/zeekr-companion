"""Geofence map (owner approved 2026-11-17, AC-92 to AC-95). Every position here is made up."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import text

from app.services.geofence import distance_km
from app.services.geofence_home import FILE_NAME, HomeResolver, _digest
from app.services.geofence_map import GeofenceMapService, offset_km
from tests.test_geofence_check import HOME, INSIDE, NOW, OUTSIDE, geo_input

URL = "/api/v1/geofence/map"
COUNTS = {
    "live_reading": "SELECT count(*) FROM live_reading",
    "advisory_proposal": "SELECT count(*) FROM advisory_proposal",
    "car_command_log": "SELECT count(*) FROM car_command_log",
    "geofence_settings": "SELECT count(*) FROM geofence_settings",
}


class Provider:
    """Holds a geofence input like the live provider, and fails the test if the car is read."""

    def __init__(self, reading: Any) -> None:
        self.geofence_input = reading
        self.stopped = False

    def __getattr__(self, name: str) -> Any:
        raise AssertionError(f"the map must not call the provider: {name}")


def setup(client: TestClient, tmp_path: Path, reading: Any = None, **kw: Any) -> None:
    values: dict[str, Any] = {
        "geofence_enabled": True,
        "geofence_home_lat": SecretStr(str(HOME.latitude)),
        "geofence_home_lon": SecretStr(str(HOME.longitude)),
        "geofence_state_dir": str(tmp_path),
    }
    values.update(kw)
    app: Any = client.app
    app.state.settings = app.state.settings.model_copy(update=values)
    app.state.live_telemetry = Provider(reading)


def get(client: TestClient, headers: dict[str, str]) -> dict[str, Any]:
    r = client.get(URL, headers=headers)
    assert r.status_code == 200
    body: dict[str, Any] = r.json()
    return body


def counts(client: TestClient) -> dict[str, int]:
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        return {name: conn.execute(text(sql)).scalar_one() for name, sql in COUNTS.items()}


# --- AC-92 ----------------------------------------------------------------------------------


def test_ac92_requires_a_token_and_is_no_store(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    assert client.get(URL).status_code == 401
    assert client.get(URL, headers={"Authorization": "Bearer nope"}).status_code == 401
    setup(client, tmp_path, geo_input())
    r = client.get(URL, headers=auth_headers)
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"


# --- AC-93 ----------------------------------------------------------------------------------


def test_ac93_off_when_the_geofence_is_off(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    setup(client, tmp_path, geo_input(), geofence_enabled=False)
    body = get(client, auth_headers)
    assert body == {
        "state": "off",
        "radius_km": 5.0,
        "car": None,
        "outside": None,
        "observed_at": None,
        "age_minutes": None,
        "stale": False,
    }


def test_ac93_off_when_live_readings_are_off(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    setup(client, tmp_path)
    client.app.state.live_telemetry = None  # type: ignore[attr-defined]
    assert get(client, auth_headers)["state"] == "off"


def test_ac93_home_not_set(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    setup(client, tmp_path, geo_input(), geofence_home_lat=None, geofence_home_lon=None)
    body = get(client, auth_headers)
    assert body["state"] == "home_not_set" and body["car"] is None


def test_ac93_a_query_with_no_saved_result_is_not_set_and_starts_no_lookup(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    calls: list[str] = []

    def boom(query: str) -> tuple[float, float] | None:
        calls.append(query)
        return (1.0, 2.0)

    setup(
        client,
        tmp_path,
        geo_input(),
        geofence_home_lat=None,
        geofence_home_lon=None,
        geofence_home_query=SecretStr("Example Street, Example Town"),
    )
    import app.services.geofence_home as home_module

    original = home_module.nominatim_lookup
    home_module.nominatim_lookup = boom  # type: ignore[assignment]
    try:
        assert get(client, auth_headers)["state"] == "home_not_set"
    finally:
        home_module.nominatim_lookup = original
    assert calls == []
    assert not (tmp_path / FILE_NAME).exists()


def test_ac93_a_saved_lookup_result_is_used(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    query = "Example Street, Example Town"
    (tmp_path / FILE_NAME).write_text(
        json.dumps({"query_sha256": _digest(query), "latitude": 10.0, "longitude": 20.0})
    )
    setup(
        client,
        tmp_path,
        geo_input(latitude=INSIDE[0], longitude=INSIDE[1], observed_at=dt.datetime.now(dt.UTC)),
        geofence_home_lat=None,
        geofence_home_lon=None,
        geofence_home_query=SecretStr(query),
    )
    body = get(client, auth_headers)
    assert body["state"] == "ok" and body["car"] == {"east_km": 0.0, "north_km": 3.3}


def test_ac93_no_reading(client: TestClient, auth_headers: dict[str, str], tmp_path: Path) -> None:
    setup(client, tmp_path, None)
    body = get(client, auth_headers)
    assert body["state"] == "no_reading" and body["car"] is None and body["outside"] is None


def test_ac93_incomplete_without_a_position(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    seen = dt.datetime.now(dt.UTC) - dt.timedelta(minutes=2)
    setup(client, tmp_path, geo_input(latitude=None, observed_at=seen))
    body = get(client, auth_headers)
    assert body["state"] == "incomplete" and body["car"] is None and body["outside"] is None
    assert body["age_minutes"] == 2


@pytest.mark.parametrize("seen", [None, "future"])
def test_ac93_incomplete_without_a_believable_time(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path, seen: Any
) -> None:
    at = dt.datetime.now(dt.UTC) + dt.timedelta(hours=1) if seen == "future" else None
    setup(client, tmp_path, geo_input(observed_at=at))
    body = get(client, auth_headers)
    assert body["state"] == "incomplete" and body["car"] is None and body["observed_at"] is None


def test_ac93_ok_inside(client: TestClient, auth_headers: dict[str, str], tmp_path: Path) -> None:
    seen = dt.datetime.now(dt.UTC) - dt.timedelta(minutes=4)
    setup(client, tmp_path, geo_input(latitude=INSIDE[0], longitude=INSIDE[1], observed_at=seen))
    body = get(client, auth_headers)
    assert body["state"] == "ok" and body["stale"] is False
    assert body["car"] == {"east_km": 0.0, "north_km": 3.3}
    assert body["outside"] is False and body["age_minutes"] == 4
    assert body["observed_at"] is not None


def test_ac93_stale_keeps_the_dot_and_flags_it(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    seen = dt.datetime.now(dt.UTC) - dt.timedelta(minutes=45)
    setup(client, tmp_path, geo_input(observed_at=seen))
    body = get(client, auth_headers)
    assert body["state"] == "stale" and body["stale"] is True
    assert body["car"] == {"east_km": 0.0, "north_km": 6.7} and body["outside"] is True


def test_ac93_uses_the_saved_radius_and_stale_limit(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    seen = dt.datetime.now(dt.UTC) - dt.timedelta(minutes=25)
    setup(client, tmp_path, geo_input(observed_at=seen))
    saved = {"radius_km": 8.5, "interval_minutes": 10, "stale_minutes": 20, "usage_mode_codes": [0]}
    put = client.put("/api/v1/geofence/settings", json=saved, headers=auth_headers)
    assert put.status_code == 200
    body = get(client, auth_headers)
    assert body["radius_km"] == 8.5 and body["outside"] is False
    assert body["state"] == "stale"


# --- AC-94 ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("where", "expected"),
    [
        ((10.03, 20.0), (0.0, 3.3)),
        ((9.97, 20.0), (0.0, -3.3)),
        ((10.0, 20.03), (3.3, 0.0)),
        ((10.0, 19.97), (-3.3, 0.0)),
        ((10.0, 20.0), (0.0, 0.0)),
        ((10.0001, 19.9999), (0.0, 0.0)),
    ],
)
def test_ac94_offset_signs_and_rounding(
    where: tuple[float, float], expected: tuple[float, float]
) -> None:
    east, north = offset_km(HOME, *where)
    assert (east, north) == expected
    assert str(east) != "-0.0" and str(north) != "-0.0"


def test_ac94_offset_is_in_tenths_and_close_to_the_true_distance() -> None:
    for lat, lon in [(10.2, 20.3), (9.6, 19.5), (10.71, 20.42), (10.0, 20.9)]:
        east, north = offset_km(HOME, lat, lon)
        for v in (east, north):
            assert round(v * 10) == pytest.approx(v * 10, abs=1e-9)
        flat = (east**2 + north**2) ** 0.5
        true = distance_km(HOME.latitude, HOME.longitude, lat, lon)
        assert abs(flat - true) <= true * 0.01 + 0.1


def test_ac94_offset_across_the_antimeridian_is_short() -> None:
    from app.services.geofence_home import HomePoint

    east, _ = offset_km(HomePoint(0.0, 179.99), 0.0, -179.99)
    assert east == pytest.approx(2.2, abs=0.05)


def test_ac94_outside_matches_the_alert_rule_at_the_boundary(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    d = distance_km(HOME.latitude, HOME.longitude, *OUTSIDE)
    seen = dt.datetime.now(dt.UTC)
    setup(client, tmp_path, geo_input(observed_at=seen))
    app: Any = client.app

    class Row:
        def __init__(self, radius: float) -> None:
            self.radius_km = radius
            self.interval_minutes = 5
            self.stale_minutes = 30
            self.usage_mode_codes = [0]

    class Repo:
        def __init__(self, radius: float) -> None:
            self.row = Row(radius)

        def get(self) -> Row:
            return self.row

    on_edge = GeofenceMapService(Repo(d), app.state.settings, app.state.live_telemetry)  # type: ignore[arg-type]
    assert on_edge.view().outside is False
    past = GeofenceMapService(Repo(d - 1e-6), app.state.settings, app.state.live_telemetry)  # type: ignore[arg-type]
    assert past.view().outside is True


def test_ac94_the_body_never_holds_a_coordinate(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    lat, lon = 10.0437, 20.0291
    setup(
        client,
        tmp_path,
        geo_input(latitude=lat, longitude=lon, observed_at=dt.datetime.now(dt.UTC)),
        geofence_home_lat=SecretStr("10.0123"),
        geofence_home_lon=SecretStr("20.0456"),
    )
    r = client.get(URL, headers=auth_headers)
    assert r.json()["state"] == "ok"
    for value in ("10.0437", "20.0291", "10.0123", "20.0456", "10.04", "20.02", "10.01", "20.04"):
        assert value not in r.text
    assert not {"latitude", "longitude", "home", "query", "lat", "lon"} & set(r.json())
    assert set(r.json()["car"]) == {"east_km", "north_km"}
    for word in ("usage", "gear", "sentry"):
        assert word not in r.text.lower()


# --- AC-95 ----------------------------------------------------------------------------------


def test_ac95_no_car_call_and_no_write(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    setup(client, tmp_path, geo_input(observed_at=dt.datetime.now(dt.UTC)))
    before = counts(client)
    for _ in range(3):
        assert get(client, auth_headers)["state"] == "ok"
    assert counts(client) == before
    assert list(tmp_path.iterdir()) == []


def test_ac95_known_never_calls_the_lookup(tmp_path: Path, client: TestClient) -> None:
    settings = client.app.state.settings.model_copy(  # type: ignore[attr-defined]
        update={
            "geofence_home_lat": None,
            "geofence_home_lon": None,
            "geofence_home_query": SecretStr("Example Street"),
            "geofence_state_dir": str(tmp_path),
        }
    )

    def boom(query: str) -> tuple[float, float] | None:
        raise AssertionError("lookup called")

    resolver = HomeResolver(settings, boom)
    assert resolver.known() is None
    query_empty = settings.model_copy(update={"geofence_home_query": SecretStr("  ")})
    assert HomeResolver(query_empty, boom).known() is None
    assert NOW.tzinfo is not None
