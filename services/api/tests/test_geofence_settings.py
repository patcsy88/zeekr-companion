"""Piece C (approved 2026-11-05): the Geofence settings API and the check reading them.

Every position here is made up. Nothing about the home point is stored or returned."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.services.geofence import GeofenceCheck, evaluate
from tests.test_geofence_check import HOME, NOW, geo_input

URL = "/api/v1/geofence/settings"
GOOD: dict[str, Any] = {
    "radius_km": 8.5,
    "interval_minutes": 10,
    "stale_minutes": 20,
    "gear_codes": [0, 3],
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
        "gear_codes": [0],
        "usage_mode_codes": [0],
    }
    assert set(body["sources"].values()) == {"env"}
    assert body["enabled"] is False
    assert body["home_set"] is False
    assert body["limits"]["stale_minutes_max"] == 30
    assert body["limits"]["gear_options"][0] == {"code": 0, "label": "P", "verified": True}
    assert body["limits"]["usage_mode_options"][-1]["code"] == 13
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
        {"gear_codes": []},
        {"gear_codes": [0, 0]},
        {"gear_codes": [4]},
        {"gear_codes": [0, 1, 2, 3, 3]},
        {"usage_mode_codes": [5]},
        {"usage_mode_codes": [0, 1, 2, 3, 4, 13]},
        {"usage_mode_codes": ["0"]},
        {"gear_codes": [True]},
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


def test_evaluate_uses_the_code_sets() -> None:
    kw: dict[str, Any] = {"radius_km": 5.0, "stale_minutes": 30, "now": NOW}
    awake = geo_input(gear="3", usage_mode="1")
    assert evaluate(awake, HOME, **kw).result == "clear"
    both = evaluate(
        awake, HOME, gear_codes=frozenset({"0", "3"}), usage_mode_codes=frozenset({"1"}), **kw
    )
    assert both.result == "alert"
    only_gear = evaluate(awake, HOME, gear_codes=frozenset({"3"}), **kw)
    assert only_gear.result == "clear"


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
