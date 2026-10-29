"""ADR-008 step 2: the read-only telemetry port and its records-backed provider."""

from __future__ import annotations

import datetime as dt
import inspect

from fastapi.testclient import TestClient

from app.adapters import telemetry
from app.adapters.telemetry import RecordsTelemetryProvider, VehicleTelemetryProvider
from app.repositories.service_records import ServiceRecordRepository
from tests.conftest import record_body

URL = "/api/v1/service-records"


def _public_methods(cls: type) -> list[str]:
    return [n for n, _ in inspect.getmembers(cls, inspect.isfunction) if not n.startswith("_")]


def test_port_has_only_read_methods() -> None:
    names = _public_methods(VehicleTelemetryProvider)
    assert names, "the port must declare at least one read method"
    assert all(n.startswith("read_") for n in names), names


def test_records_provider_has_only_read_methods() -> None:
    assert all(n.startswith("read_") for n in _public_methods(RecordsTelemetryProvider))


def test_telemetry_module_exposes_no_write_verbs() -> None:
    banned = ("send", "set_", "write", "command", "control", "start", "stop", "lock", "unlock")
    for name in (n for n, _ in inspect.getmembers(telemetry, inspect.isfunction)):
        assert not name.startswith(banned), name
    for cls in (VehicleTelemetryProvider, RecordsTelemetryProvider):
        for name in _public_methods(cls):
            assert not name.startswith(banned), name


def test_provider_with_no_records(client: TestClient) -> None:
    with client.app.state.session_factory() as session:  # type: ignore[attr-defined]
        reading = RecordsTelemetryProvider(ServiceRecordRepository(session)).read_odometer()
    assert reading.value is None
    assert reading.observed_at is None
    assert reading.source == "latest_service_record"


def test_provider_reads_latest_record_with_utc_observed_at(
    client: TestClient, auth_headers: dict[str, str]
) -> None:
    for date, km in (("2026-08-01", 5000), ("2026-09-01", 6200)):
        r = client.post(URL, json=record_body(date=date, odometer=km), headers=auth_headers)
        assert r.status_code == 201
    with client.app.state.session_factory() as session:  # type: ignore[attr-defined]
        reading = RecordsTelemetryProvider(ServiceRecordRepository(session)).read_odometer()
    assert reading.value == 6200
    assert reading.source == "latest_service_record"
    # Midnight 2026-09-01 in Kuala Lumpur (UTC+8) is 16:00 on 2026-08-31 UTC.
    assert reading.observed_at == dt.datetime(2026, 8, 31, 16, 0, tzinfo=dt.UTC)
    assert reading.observed_at.utcoffset() == dt.timedelta(0)
