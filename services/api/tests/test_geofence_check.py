"""Piece B (approved 2026-11-05): the geofence rule and the background check. Fake source only.

Every position here is made up. The home point is set by manual coordinates, so no lookup runs.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import logging
import math
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import text

from app.adapters.zeekr_live import (
    REMOTE_STATE_KEY,
    SENTRY_KEY,
    GeofenceInput,
    ZeekrLiveTelemetryProvider,
    ZeekrReadError,
    map_geofence,
)
from app.services import geofence
from app.services.geofence import (
    GeofenceCheck,
    Verdict,
    distance_km,
    evaluate,
    geofence_lifespan,
)
from app.services.geofence_home import HomePoint
from tests.test_live_vehicle import Clock, Source, with_time

LIST = "/api/v1/advisory/proposals"
HOME = HomePoint(10.0, 20.0)
NOW = dt.datetime(2026, 11, 5, 4, 0, tzinfo=dt.UTC)
INSIDE = (10.03, 20.0)  # about 3.3 km from home
OUTSIDE = (10.06, 20.0)  # about 6.7 km from home
CONDITION = "sentry_off_outside_geofence"


def reading(
    at: dt.datetime,
    where: tuple[float, float] = OUTSIDE,
    *,
    usage: object = "0",
    gear: object = "0",
    sentry: object = "0",
    age_minutes: int = 1,
) -> dict[str, Any]:
    body = with_time(at - dt.timedelta(minutes=age_minutes))
    body["basicVehicleStatus"] = {
        "position": {"latitude": where[0], "longitude": where[1]},
        "usageMode": usage,
    }
    body["additionalVehicleStatus"]["drivingBehaviourStatus"] = {"gearAutoStatus": gear}
    body[REMOTE_STATE_KEY] = {SENTRY_KEY: sentry}
    return body


def geo_input(**kw: Any) -> GeofenceInput:
    values: dict[str, Any] = {
        "latitude": OUTSIDE[0],
        "longitude": OUTSIDE[1],
        "usage_mode": "0",
        "gear": "0",
        "sentry_active": False,
        "observed_at": NOW - dt.timedelta(minutes=1),
    }
    values.update(kw)
    return GeofenceInput(**values)


def verdict(inp: GeofenceInput | None, **kw: Any) -> Verdict:
    args: dict[str, Any] = {"radius_km": 5.0, "stale_minutes": 30, "now": NOW}
    args.update(kw)
    return evaluate(inp, kw.pop("home", HOME) if "home" in kw else HOME, **args)


# --- distance -----------------------------------------------------------------------------


def test_distance_of_one_degree_of_latitude() -> None:
    assert distance_km(0.0, 0.0, 1.0, 0.0) == pytest.approx(111.195, abs=0.01)


def test_distance_to_the_same_point_is_zero_and_symmetric() -> None:
    assert distance_km(3.1, 101.6, 3.1, 101.6) == 0.0
    assert distance_km(3.1, 101.6, 3.2, 101.7) == pytest.approx(distance_km(3.2, 101.7, 3.1, 101.6))


def test_distance_across_the_antimeridian_is_short() -> None:
    assert distance_km(0.0, 179.5, 0.0, -179.5) == pytest.approx(111.195, abs=0.01)


def test_distance_over_the_pole_is_short() -> None:
    assert distance_km(89.5, 0.0, 89.5, 180.0) == pytest.approx(111.195, abs=0.01)


def test_distance_never_returns_nan_for_opposite_points() -> None:
    d = distance_km(0.0, 0.0, 0.0, 180.0)
    assert not math.isnan(d) and d == pytest.approx(math.pi * 6371.0, abs=0.01)


# --- the rule -----------------------------------------------------------------------------


def test_all_four_conditions_holding_is_an_alert() -> None:
    v = verdict(geo_input())
    assert v.result == "alert" and v.age_minutes == 1


def test_inside_the_radius_is_clear() -> None:
    assert verdict(geo_input(latitude=INSIDE[0], longitude=INSIDE[1])).result == "clear"


def test_exactly_on_the_radius_is_inside() -> None:
    d = distance_km(HOME.latitude, HOME.longitude, *OUTSIDE)
    assert verdict(geo_input(), radius_km=d).result == "clear"
    assert verdict(geo_input(), radius_km=d - 1e-6).result == "alert"


@pytest.mark.parametrize(
    "change",
    [{"gear": "3"}, {"gear": "1"}, {"gear": "2"}, {"usage_mode": "13"}, {"usage_mode": "2"}],
)
def test_a_car_that_is_not_asleep_in_park_is_clear(change: dict[str, Any]) -> None:
    assert verdict(geo_input(**change)).result == "clear"


def test_sentry_on_is_clear() -> None:
    assert verdict(geo_input(sentry_active=True)).result == "clear"


def test_a_reading_exactly_at_the_stale_limit_is_still_fresh() -> None:
    inp = geo_input(observed_at=NOW - dt.timedelta(minutes=30))
    assert verdict(inp).result == "alert"
    assert verdict(geo_input(observed_at=NOW - dt.timedelta(minutes=31))).result == "stale"


def test_a_reading_from_the_future_is_not_believed() -> None:
    assert verdict(geo_input(observed_at=NOW + dt.timedelta(minutes=20))).result == "incomplete"


@pytest.mark.parametrize(
    "change",
    [
        {"latitude": None, "longitude": None},
        {"usage_mode": None},
        {"gear": None},
        {"sentry_active": None},
        {"observed_at": None},
    ],
)
def test_a_missing_value_is_incomplete_not_clear(change: dict[str, Any]) -> None:
    assert verdict(geo_input(**change)).result == "incomplete"


def test_no_reading_and_no_home() -> None:
    assert verdict(None).result == "no_reading"
    assert evaluate(geo_input(), None, radius_km=5.0, stale_minutes=30, now=NOW).result == "no_home"


# --- reading the position out of the status reply -----------------------------------------


def test_map_geofence_keeps_only_the_five_values() -> None:
    inp = map_geofence(reading(NOW))
    assert (inp.latitude, inp.longitude) == OUTSIDE
    assert (inp.usage_mode, inp.gear, inp.sentry_active) == ("0", "0", False)
    assert inp.observed_at == NOW - dt.timedelta(minutes=1)
    assert set(GeofenceInput.__dataclass_fields__) == {
        "latitude",
        "longitude",
        "usage_mode",
        "gear",
        "sentry_active",
        "observed_at",
    }


def test_map_geofence_hides_its_values_in_a_repr() -> None:
    assert "10.06" not in repr(map_geofence(reading(NOW)))


@pytest.mark.parametrize("bad", ["", "abc", None, True, [], {}, "nan", "1e999", 91, -91])
def test_a_bad_latitude_means_no_position(bad: object) -> None:
    body = reading(NOW)
    body["basicVehicleStatus"]["position"]["latitude"] = bad
    inp = map_geofence(body)
    assert inp.latitude is None and inp.longitude is None


@pytest.mark.parametrize("bad", ["", "x", None, 181, -181])
def test_a_bad_longitude_means_no_position(bad: object) -> None:
    body = reading(NOW)
    body["basicVehicleStatus"]["position"]["longitude"] = bad
    inp = map_geofence(body)
    assert inp.latitude is None and inp.longitude is None


def test_the_origin_is_not_a_position() -> None:
    inp = map_geofence(reading(NOW, (0.0, 0.0)))
    assert inp.latitude is None


def test_a_position_given_as_text_is_read() -> None:
    inp = map_geofence(reading(NOW, ("10.06", "20.0")))  # type: ignore[arg-type]
    assert (inp.latitude, inp.longitude) == (10.06, 20.0)


@pytest.mark.parametrize("bad", ["", "abc", "123", "-1", None, True, [], {}, "0 "])
def test_only_a_short_whole_number_is_a_state_code(bad: object) -> None:
    got = map_geofence(reading(NOW, usage=bad, gear=bad))
    expected = "0" if bad == "0 " else None
    assert got.usage_mode == expected and got.gear == expected


def test_a_reply_with_no_positions_at_all() -> None:
    inp = map_geofence({})
    assert inp.latitude is None and inp.usage_mode is None and inp.observed_at is None


def test_the_provider_keeps_the_input_in_memory_and_drops_it_on_a_failed_read() -> None:
    clock = Clock()
    source = Source(reading(NOW), ZeekrReadError("x"))
    provider = ZeekrLiveTelemetryProvider(source, clock=clock, min_interval_s=300)
    assert provider.geofence_input is None
    provider.read_odometer()
    kept = provider.geofence_input
    assert kept is not None and (kept.latitude, kept.longitude) == OUTSIDE
    clock.now += 301
    provider.read_odometer()
    assert provider.geofence_input is None


# --- the background check -----------------------------------------------------------------


def configure(client: TestClient, tmp_path: Path, **kw: Any) -> None:
    settings = client.app.state.settings  # type: ignore[attr-defined]
    values: dict[str, Any] = {
        "geofence_enabled": True,
        "geofence_home_lat": SecretStr("10.0"),
        "geofence_home_lon": SecretStr("20.0"),
        "geofence_state_dir": str(tmp_path),
    }
    values.update(kw)
    client.app.state.settings = settings.model_copy(update=values)  # type: ignore[attr-defined]


class Rig:
    def __init__(self, client: TestClient, *replies: Any) -> None:
        self.client = client
        self.source = Source(*replies)
        self.clock = Clock()
        client.app.state.live_telemetry = ZeekrLiveTelemetryProvider(  # type: ignore[attr-defined]
            self.source, clock=self.clock, min_interval_s=300
        )
        self.when = NOW

    def run(self, job: GeofenceCheck | None = None) -> str:
        self.clock.now += 301
        self.when += dt.timedelta(minutes=5)
        return (job or GeofenceCheck(self.client.app)).run_once(self.when)  # type: ignore[arg-type]

    def rows(self) -> list[Any]:
        with self.client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
            return list(
                conn.execute(
                    text(
                        "SELECT condition, status, decided_at, updated_at FROM advisory_proposal "
                        "ORDER BY created_at, id"
                    )
                ).all()
            )


def replies_for(rig_when: dt.datetime, *specs: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        reading(rig_when + dt.timedelta(minutes=5 * (i + 1)), **spec)
        for i, spec in enumerate(specs)
    ]


def make(client: TestClient, tmp_path: Path, *specs: dict[str, Any], **cfg: Any) -> Rig:
    configure(client, tmp_path, **cfg)
    return Rig(client, *replies_for(NOW, *specs))


def test_it_is_off_unless_switched_on(client: TestClient, tmp_path: Path) -> None:
    rig = make(client, tmp_path, {}, geofence_enabled=False)
    assert rig.run() == "off"
    assert rig.source.calls == 0 and rig.rows() == []


def test_it_does_nothing_when_live_readings_are_off(client: TestClient, tmp_path: Path) -> None:
    configure(client, tmp_path)
    client.app.state.live_telemetry = None  # type: ignore[attr-defined]
    assert GeofenceCheck(client.app).run_once(NOW) == "off"  # type: ignore[arg-type]


def test_one_alert_opens_and_a_repeat_run_opens_no_second(
    client: TestClient, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    rig = make(client, tmp_path, {}, {}, {})
    assert rig.run() == "alert opened"
    assert rig.run() == "alert open"
    assert rig.run() == "alert open"
    assert len(rig.rows()) == 1
    (item,) = client.get(LIST, headers=auth_headers).json()["items"]
    assert item["condition"] == CONDITION and item["status"] == "proposed"
    assert item["inputs"] == {"reading_age_minutes": 1}
    assert item["explanation"] is None and item["explanation_status"] == "disabled"
    assert item["urgency"] is None and item["suggestion"] is None and item["source_refs"] == []
    assert item["provenance"] == {"rule_version": 1, "prompt_version": None, "model_id": None}


@pytest.mark.parametrize(
    "spec",
    [
        {"where": INSIDE},
        {"gear": "3"},
        {"usage": "13"},
        {"sentry": "1"},
    ],
)
def test_each_condition_failing_alone_opens_nothing(
    client: TestClient, tmp_path: Path, spec: dict[str, Any]
) -> None:
    rig = make(client, tmp_path, spec)
    assert rig.run() == "clear"
    assert rig.rows() == []


@pytest.mark.parametrize(
    "spec",
    [
        {"where": INSIDE},
        {"gear": "3"},
        {"usage": "13"},
        {"sentry": "1"},
    ],
)
def test_each_condition_stopping_closes_the_alert(
    client: TestClient, tmp_path: Path, spec: dict[str, Any]
) -> None:
    rig = make(client, tmp_path, {}, spec)
    assert rig.run() == "alert opened"
    assert rig.run() == "alert closed"
    ((condition, status, decided_at, _),) = rig.rows()
    assert (condition, status) == (CONDITION, "closed") and decided_at is not None


def test_a_closed_alert_that_comes_back_is_a_new_alert(client: TestClient, tmp_path: Path) -> None:
    rig = make(client, tmp_path, {}, {"where": INSIDE}, {})
    assert [rig.run(), rig.run(), rig.run()] == ["alert opened", "alert closed", "alert opened"]
    assert [r[1] for r in rig.rows()] == ["closed", "proposed"]


def test_a_stale_reading_does_not_close_an_open_alert(client: TestClient, tmp_path: Path) -> None:
    configure(client, tmp_path)
    rig = Rig(
        client,
        reading(NOW + dt.timedelta(minutes=5)),
        reading(NOW + dt.timedelta(minutes=10), age_minutes=45),
    )
    assert rig.run() == "alert opened"
    assert rig.run() == "stale"
    assert [r[1] for r in rig.rows()] == ["proposed"]


def test_a_stale_reading_opens_nothing(client: TestClient, tmp_path: Path) -> None:
    configure(client, tmp_path)
    rig = Rig(client, reading(NOW + dt.timedelta(minutes=5), age_minutes=45))
    assert rig.run() == "stale"
    assert rig.rows() == []


@pytest.mark.parametrize("missing", ["gear", "usage", "sentry"])
def test_an_incomplete_reading_changes_nothing(
    client: TestClient, tmp_path: Path, missing: str
) -> None:
    rig = make(client, tmp_path, {}, {missing: None})
    assert rig.run() == "alert opened"
    assert rig.run() == "incomplete"
    assert [r[1] for r in rig.rows()] == ["proposed"]


def test_a_dismissed_alert_stays_dismissed_for_that_episode(
    client: TestClient, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    rig = make(client, tmp_path, {}, {}, {}, {"where": INSIDE}, {})
    assert rig.run() == "alert opened"
    (item,) = client.get(LIST, headers=auth_headers).json()["items"]
    done = client.patch(f"{LIST}/{item['id']}", json={"status": "dismissed"}, headers=auth_headers)
    assert done.status_code == 200
    assert rig.run() == "alert already decided"
    assert rig.run(GeofenceCheck(client.app)) == "alert already decided"  # type: ignore[arg-type]
    assert [r[1] for r in rig.rows()] == ["dismissed"]
    assert rig.run() == "clear"  # the episode ends
    assert rig.run() == "alert opened"
    assert [r[1] for r in rig.rows()] == ["dismissed", "proposed"]


def test_a_restart_does_not_reopen_a_dismissed_alert(
    client: TestClient, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    rig = make(client, tmp_path, {}, {}, {"where": INSIDE}, {}, {})
    rig.run()
    (item,) = client.get(LIST, headers=auth_headers).json()["items"]
    client.patch(f"{LIST}/{item['id']}", json={"status": "accepted"}, headers=auth_headers)
    assert rig.run(GeofenceCheck(client.app)) == "alert already decided"  # type: ignore[arg-type]
    assert rig.run(GeofenceCheck(client.app)) == "clear"  # type: ignore[arg-type]
    assert rig.run(GeofenceCheck(client.app)) == "alert opened"  # type: ignore[arg-type]


def test_a_closed_alert_cannot_be_decided(
    client: TestClient, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    rig = make(client, tmp_path, {}, {"gear": "3"})
    rig.run()
    (item,) = client.get(LIST, headers=auth_headers).json()["items"]
    rig.run()
    for decision in ("dismissed", "accepted"):
        r = client.patch(f"{LIST}/{item['id']}", json={"status": decision}, headers=auth_headers)
        assert r.status_code == 409 and r.json()["error"]["code"] == "conflict"


def test_the_list_filter_knows_closed(
    client: TestClient, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    rig = make(client, tmp_path, {}, {"gear": "3"}, {})
    rig.run()
    rig.run()
    rig.run()
    by = {s: client.get(f"{LIST}?status={s}", headers=auth_headers) for s in ("proposed", "closed")}
    assert [len(by[s].json()["items"]) for s in ("proposed", "closed")] == [1, 1]
    assert len(client.get(f"{LIST}?status=all", headers=auth_headers).json()["items"]) == 2
    assert client.get(f"{LIST}?status=bogus", headers=auth_headers).status_code == 400


def test_the_manual_run_of_the_other_checks_leaves_the_alert_alone(
    client: TestClient, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    rig = make(client, tmp_path, {})
    rig.run()
    run = client.post("/api/v1/advisory/checks", headers=auth_headers)
    assert run.status_code == 200 and run.json()["created"] == []
    assert [r[1] for r in rig.rows()] == ["proposed"]


def test_no_home_point_means_no_read(client: TestClient, tmp_path: Path) -> None:
    configure(
        client, tmp_path, geofence_home_lat=None, geofence_home_lon=None, geofence_home_query=None
    )
    rig = Rig(client, reading(NOW))
    assert rig.run() == "home not set"
    assert rig.source.calls == 0 and rig.rows() == []


def test_a_failed_lookup_leaves_it_off_and_asks_once(client: TestClient, tmp_path: Path) -> None:
    configure(
        client,
        tmp_path,
        geofence_home_lat=None,
        geofence_home_lon=None,
        geofence_home_query=SecretStr("canary street"),
    )
    asked: list[str] = []

    def fetch(query: str) -> None:
        asked.append(query)

    rig = Rig(client, reading(NOW))
    job = GeofenceCheck(client.app, fetch)  # type: ignore[arg-type]
    assert [rig.run(job), rig.run(job)] == ["home not set", "home not set"]
    assert len(asked) == 1 and rig.source.calls == 0


def test_a_lookup_result_is_used_and_saved(client: TestClient, tmp_path: Path) -> None:
    configure(
        client,
        tmp_path,
        geofence_home_lat=None,
        geofence_home_lon=None,
        geofence_home_query=SecretStr("canary street"),
    )
    rig = Rig(client, *replies_for(NOW, {}))
    job = GeofenceCheck(client.app, lambda q: (10.0, 20.0))  # type: ignore[arg-type]
    assert rig.run(job) == "alert opened"
    assert (tmp_path / "home.json").exists()


def test_it_never_reads_more_often_than_the_provider_spacing(
    client: TestClient, tmp_path: Path
) -> None:
    configure(client, tmp_path)
    rig = Rig(client, reading(NOW + dt.timedelta(minutes=5)))
    job = GeofenceCheck(client.app)  # type: ignore[arg-type]
    rig.when = NOW + dt.timedelta(minutes=5)
    assert job.run_once(rig.when) in {"alert opened", "alert open"}  # type: ignore[arg-type]
    rig.clock.now += 10
    job.run_once(rig.when + dt.timedelta(minutes=1))  # type: ignore[arg-type]
    job.run_once(rig.when + dt.timedelta(minutes=2))  # type: ignore[arg-type]
    assert rig.source.calls == 1


def test_a_failed_read_is_no_reading_and_the_cap_on_failures_stops_it(
    client: TestClient, tmp_path: Path
) -> None:
    configure(client, tmp_path)
    rig = Rig(client, ZeekrReadError("secret-canary-value"))
    results = []
    for _ in range(8):
        rig.clock.now += 100_000
        rig.when += dt.timedelta(minutes=5)
        results.append(GeofenceCheck(client.app).run_once(rig.when))  # type: ignore[arg-type]
    assert results[0] == "no reading"
    assert results[-1] == "provider stopped"
    assert rig.source.calls == 5
    assert rig.rows() == []


def test_a_failed_read_does_not_close_an_open_alert(client: TestClient, tmp_path: Path) -> None:
    configure(client, tmp_path)
    rig = Rig(client, reading(NOW + dt.timedelta(minutes=5)), ZeekrReadError("x"))
    assert rig.run() == "alert opened"
    assert rig.run() == "no reading"
    assert [r[1] for r in rig.rows()] == ["proposed"]


def test_a_full_table_skips_instead_of_failing(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(geofence, "MAX_PROPOSALS", 0)
    rig = make(client, tmp_path, {})
    assert rig.run() == "cap reached"
    assert rig.rows() == []


def test_the_reading_is_stored_through_the_normal_path(client: TestClient, tmp_path: Path) -> None:
    rig = make(client, tmp_path, {})
    rig.run()
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        n = conn.execute(text("SELECT count(*) FROM live_reading")).scalar_one()
    assert n == 1


CANARIES = ("10.987654", "20.123987", "10.9876", "20.1239")


def test_no_position_distance_or_home_reaches_a_row_a_log_or_a_response(
    client: TestClient,
    tmp_path: Path,
    auth_headers: dict[str, str],
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    configure(
        client,
        tmp_path,
        geofence_home_lat=SecretStr("10.0"),
        geofence_home_lon=SecretStr("20.0"),
        geofence_radius_km=1.0,
    )
    rig = Rig(client, reading(NOW + dt.timedelta(minutes=5), (10.987654, 20.123987)))
    assert rig.run() == "alert opened"
    rig.run()
    seen = [caplog.text]
    with client.app.state.engine.begin() as conn:  # type: ignore[attr-defined]
        for table in ("advisory_proposal", "advisory_model_call", "live_reading"):
            seen.append(str(conn.execute(text(f"SELECT * FROM {table}")).all()))  # noqa: S608
    for path in (LIST, f"{LIST}?status=all", "/api/v1/advisory/status", "/api/v1/live-vehicle"):
        seen.append(client.get(path, headers=auth_headers).text)
    blob = "\n".join(seen)
    for canary in (
        *CANARIES,
        "10.0,",
        "from_home",
        "km_from",
        "latitude",
        "longitude",
        "geofence_radius",
    ):
        assert canary not in blob, canary


def test_the_job_never_uses_the_command_path(client: TestClient, tmp_path: Path) -> None:
    source = (Path(geofence.__file__)).read_text()
    for banned in ("sentry_command", "vehicle()", "set_remote", "start_sentry", ".post("):
        assert banned not in source


def test_the_loop_starts_only_when_enabled_and_live(client: TestClient, tmp_path: Path) -> None:
    app = client.app

    async def started() -> bool:
        async with geofence_lifespan(app):  # type: ignore[arg-type]
            return any(
                "GeofenceCheck" in getattr(t.get_coro(), "__qualname__", "")
                for t in asyncio.all_tasks()
            )

    configure(client, tmp_path, geofence_enabled=False)
    app.state.live_telemetry = ZeekrLiveTelemetryProvider(Source(), clock=Clock())  # type: ignore[attr-defined]
    assert asyncio.run(started()) is False
    configure(client, tmp_path, geofence_enabled=True)
    assert asyncio.run(started()) is True
    app.state.live_telemetry = None  # type: ignore[attr-defined]
    assert asyncio.run(started()) is False


def test_the_loop_waits_the_configured_interval(client: TestClient, tmp_path: Path) -> None:
    configure(client, tmp_path, geofence_interval_minutes=7)
    assert GeofenceCheck(client.app).interval_seconds == 420.0  # type: ignore[arg-type]
