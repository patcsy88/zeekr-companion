"""Piece C (approved 2026-11-05): the Geofence settings API and the check reading them.

Every position here is made up. Nothing about the home point is stored or returned."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import text

from app.services.geofence import GeofenceCheck, evaluate
from tests.test_geofence_check import HOME, NOW, geo_input

URL = "/api/v1/geofence/settings"
GOOD: dict[str, Any] = {
    "radius_km": 8.5,
    "interval_minutes": 10,
    "stale_minutes": 20,
    "usage_mode_codes": [1, 0],
}


def test_requires_a_token(client: TestClient) -> None:
    assert client.get(URL).status_code == 401
    assert client.put(URL, json=GOOD).status_code == 401
    assert client.delete(URL).status_code == 401


def test_defaults_come_from_env_and_never_show_the_home(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    r = client.get(URL, headers=auth_headers)
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-store"
    body = r.json()
    assert body["settings"] == {
        "radius_km": 5.0,
        "interval_minutes": 5,
        "stale_minutes": 30,
        "usage_mode_codes": [0],
    }
    assert set(body["sources"].values()) == {"env"}
    assert body["enabled"] is False
    assert body["home_set"] is False
    assert body["limits"]["stale_minutes_max"] == 30
    # Gear is not a setting, and only the two vehicle states can be picked (owner, 2026-11-08).
    assert "gear" not in r.text
    assert body["limits"]["usage_mode_options"] == [
        {"code": 0, "label": "Deep Sleep", "verified": False},
        {"code": 1, "label": "Parked", "verified": False},
    ]
    assert body["limits"]["max_codes"] == 2
    assert not {"latitude", "longitude", "home", "query"} & set(r.text.lower().split('"'))


def test_save_reads_back_and_reset_is_repeatable(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    r = client.put(URL, json=GOOD, headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["settings"]["usage_mode_codes"] == [0, 1]
    assert set(r.json()["sources"].values()) == {"saved"}
    assert client.get(URL, headers=auth_headers).json()["settings"]["radius_km"] == 8.5
    client.put(URL, json={**GOOD, "radius_km": 2}, headers=auth_headers)
    assert client.get(URL, headers=auth_headers).json()["settings"]["radius_km"] == 2.0
    for _ in range(2):
        d = client.delete(URL, headers=auth_headers)
        assert d.status_code == 200
        assert d.json()["settings"]["radius_km"] == 5.0
        assert set(d.json()["sources"].values()) == {"env"}


@pytest.mark.parametrize(
    "change",
    [
        {"radius_km": 0},
        {"radius_km": 100.5},
        {"radius_km": "5"},
        {"interval_minutes": 4},
        {"interval_minutes": 1441},
        {"stale_minutes": 0},
        {"stale_minutes": 31},
        {"stale_minutes": 1440},
        {"gear_codes": [0]},
        {"usage_mode_codes": []},
        {"usage_mode_codes": [0, 0]},
        {"usage_mode_codes": [2]},
        {"usage_mode_codes": [3]},
        {"usage_mode_codes": [4]},
        {"usage_mode_codes": [13]},
        {"usage_mode_codes": [0, 13]},
        {"usage_mode_codes": [5]},
        {"usage_mode_codes": ["0"]},
        {"usage_mode_codes": [True]},
        {"home": "x"},
    ],
)
def test_bad_values_are_400_never_422(
    client: TestClient, auth_headers: dict[str, str], change: dict[str, Any]
) -> None:
    r = client.put(URL, json={**GOOD, **change}, headers=auth_headers)
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "validation_error"
    assert client.get(URL, headers=auth_headers).json()["sources"]["radius_km"] == "env"


def test_missing_field_is_400(client: TestClient, auth_headers: dict[str, str]) -> None:
    body = {k: v for k, v in GOOD.items() if k != "stale_minutes"}
    assert client.put(URL, json=body, headers=auth_headers).status_code == 400


def test_env_stale_above_the_limit_still_starts_and_is_shown(
    database_url: str, password_hash: str
) -> None:
    from app.main import create_app
    from tests.conftest import PASSWORD, USERNAME, make_settings, seed_owner

    seed_owner(database_url, password_hash)
    app = create_app(make_settings(database_url, geofence_stale_minutes=1440))
    with TestClient(app) as c:
        token = c.post("/api/v1/auth/token", json={"username": USERNAME, "password": PASSWORD})
        headers = {"Authorization": f"Bearer {token.json()['access_token']}"}
        c.delete(URL, headers=headers)
        body = c.get(URL, headers=headers).json()
        assert body["settings"]["stale_minutes"] == 1440
        assert body["sources"]["stale_minutes"] == "env"
        assert c.put(URL, json={**GOOD, "stale_minutes": 1440}, headers=headers).status_code == 400
        assert c.put(URL, json=GOOD, headers=headers).status_code == 200
        c.delete(URL, headers=headers)
    app.state.engine.dispose()


KW: dict[str, Any] = {"radius_km": 5.0, "stale_minutes": 30, "now": NOW}
EVERY_MODE = frozenset({"0", "1", "2", "3", "4", "13"})


@pytest.mark.parametrize(
    ("chosen", "mode", "result"),
    [
        (frozenset({"0"}), "0", "alert"),
        (frozenset({"0"}), "1", "clear"),
        (frozenset({"1"}), "1", "alert"),
        (frozenset({"1"}), "0", "clear"),
        (frozenset({"0", "1"}), "0", "alert"),
        (frozenset({"0", "1"}), "1", "alert"),
    ],
)
def test_vehicle_states_deep_sleep_parked_or_both(
    chosen: frozenset[str], mode: str, result: str
) -> None:
    assert (
        evaluate(geo_input(usage_mode=mode), HOME, usage_mode_codes=chosen, **KW).result == result
    )


@pytest.mark.parametrize("mode", ["2", "3", "4", "13"])
def test_other_vehicle_states_never_alert_even_if_passed_in(mode: str) -> None:
    assert evaluate(geo_input(usage_mode=mode), HOME, usage_mode_codes=EVERY_MODE, **KW).result == (
        "clear"
    )


@pytest.mark.parametrize("gear", ["1", "2", "3"])
def test_only_park_counts(gear: str) -> None:
    for chosen in (frozenset({"0"}), frozenset({"0", "1"}), EVERY_MODE):
        for mode in ("0", "1"):
            inp = geo_input(gear=gear, usage_mode=mode)
            assert evaluate(inp, HOME, usage_mode_codes=chosen, **KW).result == "clear"


def _write_row(client: TestClient, gear: list[int], usage: list[int]) -> None:
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        conn.execute(text("DELETE FROM geofence_settings"))
        conn.execute(
            text(
                "INSERT INTO geofence_settings (id, radius_km, interval_minutes, stale_minutes, "
                "gear_codes, usage_mode_codes, updated_at) VALUES (1, 5, 5, 30, :g, :u, now())"
            ),
            {"g": gear, "u": usage},
        )


def _gear_in_row(client: TestClient) -> list[int]:
    with client.app.state.engine.connect() as conn:  # type: ignore[attr-defined]
        return list(conn.execute(text("SELECT gear_codes FROM geofence_settings")).scalar_one())


def test_an_older_row_with_other_gears_and_states_is_narrowed(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    _write_row(client, [0, 3], [0, 1, 2, 13])
    body = client.get(URL, headers=auth_headers).json()
    assert body["settings"]["usage_mode_codes"] == [0, 1]
    _write_row(client, [3], [2, 13])
    assert client.get(URL, headers=auth_headers).json()["settings"]["usage_mode_codes"] == [0]
    check = _app_with_reading(client)
    assert check._effective().usage_mode_codes == frozenset({"0"})
    client.put(URL, json=GOOD, headers=auth_headers)
    assert _gear_in_row(client) == [0]
    client.delete(URL, headers=auth_headers)


def _app_with_reading(client: TestClient, **over: Any) -> GeofenceCheck:
    app = client.app
    app.state.settings = app.state.settings.model_copy(  # type: ignore[attr-defined]
        update={
            "geofence_enabled": True,
            "geofence_home_lat": SecretStr(str(HOME.latitude)),
            "geofence_home_lon": SecretStr(str(HOME.longitude)),
            **over,
        }
    )
    return GeofenceCheck(app)  # type: ignore[arg-type]


def test_interval_follows_the_saved_row(client: TestClient, auth_headers: dict[str, str]) -> None:
    check = _app_with_reading(client)
    assert check.interval_seconds == 300.0
    client.put(URL, json={**GOOD, "interval_minutes": 15}, headers=auth_headers)
    assert check.interval_seconds == 900.0
    client.delete(URL, headers=auth_headers)
    assert check.interval_seconds == 300.0
