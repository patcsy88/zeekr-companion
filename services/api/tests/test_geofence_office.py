"""Office geofence (owner approved 2026-11-20): a second safe place. Every place here is made up.

Home is (10.0, 20.0). The office is (10.0, 20.1), about 11 km east of home.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from app.services import geofence_home
from app.services.auto_sentry import AutoSentrySender
from app.services.geofence import GeofenceCheck, evaluate
from app.services.geofence_home import HomePoint, HomeResolver
from tests.conftest import make_settings
from tests.test_geofence_check import (
    HOME,
    INSIDE,
    NOW,
    OUTSIDE,
    geo_input,
    make,
)
from tests.test_geofence_map import get, setup

OFFICE = HomePoint(10.0, 20.1)
AT_OFFICE = (10.0, 20.1)
NEAR_OFFICE = (10.01, 20.1)  # about 1.1 km from the office
FAR_FROM_BOTH = (10.06, 20.0)
OFFICE_ENV: dict[str, Any] = {
    "geofence_office_lat": SecretStr("10.0"),
    "geofence_office_lon": SecretStr("20.1"),
}


def verdict(where: tuple[float, float], **kw: Any) -> str:
    args: dict[str, Any] = {
        "radius_km": 5.0,
        "stale_minutes": 30,
        "now": NOW,
        "office": OFFICE,
        "office_radius_km": 2.0,
    }
    args.update(kw)
    return evaluate(geo_input(latitude=where[0], longitude=where[1]), HOME, **args).result


# --- the rule -------------------------------------------------------------------------------


def test_inside_home_is_clear() -> None:
    assert verdict(INSIDE) == "clear"


def test_inside_the_office_is_clear() -> None:
    assert verdict(AT_OFFICE) == "clear"
    assert verdict(NEAR_OFFICE) == "clear"


def test_outside_both_is_an_alert() -> None:
    assert verdict(FAR_FROM_BOTH) == "alert"
    assert verdict(OUTSIDE) == "alert"


def test_just_outside_the_office_radius_is_an_alert() -> None:
    assert verdict((10.025, 20.1)) == "alert"  # about 2.8 km from the office
    assert verdict((10.025, 20.1), office_radius_km=3.0) == "clear"


def test_without_an_office_the_office_spot_alerts() -> None:
    assert verdict(AT_OFFICE, office=None) == "alert"


# --- configuration --------------------------------------------------------------------------


def test_the_office_radius_defaults_to_two_km(database_url: str) -> None:
    assert make_settings(database_url).geofence_office_radius_km == 2.0


@pytest.mark.parametrize("radius", [0, -1, 100.1])
def test_a_bad_office_radius_refuses_to_start(database_url: str, radius: float) -> None:
    with pytest.raises(ValidationError):
        make_settings(database_url, geofence_office_radius_km=radius)


@pytest.mark.parametrize(
    "values",
    [
        {"geofence_office_lat": SecretStr("10.0")},
        {"geofence_office_lon": SecretStr("20.0")},
        {"geofence_office_lat": SecretStr("91"), "geofence_office_lon": SecretStr("20")},
        {"geofence_office_lat": SecretStr("10"), "geofence_office_lon": SecretStr("181")},
        {"geofence_office_lat": SecretStr("x"), "geofence_office_lon": SecretStr("20")},
    ],
)
def test_half_set_or_bad_office_coordinates_refuse_to_start(
    database_url: str, values: dict[str, Any]
) -> None:
    with pytest.raises(ValidationError) as err:
        make_settings(database_url, **values)
    assert "OFFICE" in str(err.value)


def test_the_office_is_optional_and_empty_values_mean_unset(database_url: str) -> None:
    s = make_settings(
        database_url,
        geofence_office_query="  ",
        geofence_office_lat="",
        geofence_office_lon="",
    )
    assert s.geofence_office_query is None and s.geofence_office_lat is None


# --- the resolver ---------------------------------------------------------------------------


def test_the_office_lookup_is_saved_in_its_own_file(client: TestClient, tmp_path: Path) -> None:
    base = client.app.state.settings  # type: ignore[attr-defined]
    s = base.model_copy(
        update={
            "geofence_home_query": SecretStr("Home Street"),
            "geofence_home_lat": None,
            "geofence_home_lon": None,
            "geofence_office_query": SecretStr("Office Street"),
            "geofence_state_dir": str(tmp_path),
        }
    )
    asked: list[str] = []

    def fetch(query: str) -> tuple[float, float] | None:
        asked.append(query)
        return (10.0, 20.1) if query == "Office Street" else (10.0, 20.0)

    assert HomeResolver(s, fetch).resolve() == HOME
    assert HomeResolver(s, fetch, "office").resolve() == OFFICE
    assert sorted(p.name for p in tmp_path.iterdir()) == ["home.json", "office.json"]
    saved = json.loads((tmp_path / "office.json").read_text())
    assert "Office Street" not in json.dumps(saved)
    again = HomeResolver(s, lambda q: pytest.fail("looked up twice"), "office")
    assert again.resolve() == OFFICE
    assert asked == ["Home Street", "Office Street"]
    assert geofence_home.OFFICE_FILE_NAME == "office.json"


def test_a_failed_office_lookup_logs_once_without_the_query(
    client: TestClient, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    s = client.app.state.settings.model_copy(  # type: ignore[attr-defined]
        update={
            "geofence_office_query": SecretStr("Secret Office"),
            "geofence_state_dir": str(tmp_path),
        }
    )
    with caplog.at_level(logging.WARNING, logger="app.geofence_home"):
        assert HomeResolver(s, lambda q: None, "office").resolve() is None
    assert [r.getMessage() for r in caplog.records] == ["Geofence office lookup gave no result"]
    assert "Secret Office" not in caplog.text


# --- the background check -------------------------------------------------------------------


def test_an_alert_does_not_open_at_the_office(client: TestClient, tmp_path: Path) -> None:
    rig = make(client, tmp_path, {"where": AT_OFFICE}, **OFFICE_ENV)
    assert rig.run() == "clear"
    assert rig.rows() == []


def test_an_open_alert_closes_when_the_car_reaches_the_office(
    client: TestClient, tmp_path: Path
) -> None:
    rig = make(client, tmp_path, {}, {"where": AT_OFFICE}, **OFFICE_ENV)
    assert rig.run() == "alert opened"
    assert rig.run() == "alert closed"
    assert [r[1] for r in rig.rows()] == ["closed"]


def test_without_an_office_the_same_spot_opens_an_alert(client: TestClient, tmp_path: Path) -> None:
    rig = make(client, tmp_path, {"where": AT_OFFICE})
    assert rig.run() == "alert opened"


def test_no_automatic_send_inside_the_office(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    sent: list[object] = []

    def fake(self: AutoSentrySender, now: object) -> str:
        sent.append(now)
        return "sent"

    monkeypatch.setattr(AutoSentrySender, "after_alert_opened", fake)
    rig = make(client, tmp_path, {"where": AT_OFFICE}, {"where": FAR_FROM_BOTH}, **OFFICE_ENV)
    assert rig.run() == "clear"
    assert sent == []
    assert rig.run() == "alert opened; automatic send: sent"
    assert len(sent) == 1


def test_a_failed_office_lookup_keeps_home_working(
    client: TestClient, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    rig = make(
        client,
        tmp_path,
        {"where": INSIDE},
        {"where": AT_OFFICE},
        geofence_office_query=SecretStr("Nowhere Street"),
    )
    job = GeofenceCheck(client.app, lambda q: None)  # type: ignore[arg-type]
    with caplog.at_level(logging.WARNING, logger="app.geofence_home"):
        assert rig.run(job) == "clear"  # inside home
        assert rig.run(job) == "alert opened"  # the office is treated as not set
    assert "Nowhere Street" not in caplog.text


def fresh(**kw: Any) -> Any:
    return geo_input(observed_at=dt.datetime.now(dt.UTC), **kw)


# --- the map --------------------------------------------------------------------------------


def test_the_map_gives_the_office_and_the_place(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    setup(client, tmp_path, fresh(latitude=AT_OFFICE[0], longitude=AT_OFFICE[1]), **OFFICE_ENV)
    body = get(client, auth_headers)
    assert body["state"] == "ok"
    assert body["place"] == "office" and body["outside"] is False
    assert body["office"] == {"east_km": 11.0, "north_km": 0.0, "radius_km": 2.0}
    assert body["radius_km"] == 5.0
    assert body["car"] == {"east_km": 11.0, "north_km": 0.0}
    assert set(body["office"]) == {"east_km", "north_km", "radius_km"}
    assert not {"latitude", "longitude", "lat", "lon", "query"} & set(body)


def test_the_map_place_is_home_inside_home_and_none_outside_both(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    setup(client, tmp_path, fresh(latitude=INSIDE[0], longitude=INSIDE[1]), **OFFICE_ENV)
    body = get(client, auth_headers)
    assert (body["place"], body["outside"]) == ("home", False)
    setup(client, tmp_path, fresh(), **OFFICE_ENV)
    body = get(client, auth_headers)
    assert (body["place"], body["outside"]) == (None, True)


def test_the_map_without_an_office(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    setup(client, tmp_path, fresh(latitude=AT_OFFICE[0], longitude=AT_OFFICE[1]))
    body = get(client, auth_headers)
    assert body["office"] is None and body["place"] is None and body["outside"] is True


def test_a_far_office_is_left_off_the_map_but_still_counts(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    far = {"geofence_office_lat": SecretStr("11.5"), "geofence_office_lon": SecretStr("20.0")}
    setup(client, tmp_path, fresh(latitude=11.5, longitude=20.0), **far)
    body = get(client, auth_headers)
    assert body["office"] is None
    assert body["place"] == "office" and body["outside"] is False


def test_the_map_uses_a_saved_office_lookup_and_never_looks_up(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    setup(
        client,
        tmp_path,
        fresh(latitude=AT_OFFICE[0], longitude=AT_OFFICE[1]),
        geofence_office_query=SecretStr("Office Street"),
    )
    assert get(client, auth_headers)["office"] is None
    assert list(tmp_path.iterdir()) == []
    digest = geofence_home._digest("Office Street")
    (tmp_path / "office.json").write_text(
        json.dumps({"query_sha256": digest, "latitude": 10.0, "longitude": 20.1})
    )
    assert get(client, auth_headers)["office"]["east_km"] == 11.0


# --- the settings ---------------------------------------------------------------------------


def test_the_settings_say_whether_the_office_is_set(
    client: TestClient, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    url = "/api/v1/geofence/settings"
    assert client.get(url, headers=auth_headers).json()["office_set"] is False
    setup(client, tmp_path, None, **OFFICE_ENV)
    r = client.get(url, headers=auth_headers)
    assert r.json()["office_set"] is True
    assert "20.1" not in r.text
