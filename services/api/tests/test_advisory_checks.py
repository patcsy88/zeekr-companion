"""ADR-008 step 2: the pure advisory checks. No database, no clock, no model."""

from __future__ import annotations

import datetime as dt
import uuid

import pytest

from app.services import advisory_checks as ac
from app.services.advisory_checks import (
    ChargeSample,
    LimitSubject,
    OdometerSample,
    check_charging_cost_drift,
    check_date_vs_km,
    cost_per_kwh_sen,
    driving_pace,
)

TODAY = dt.date(2026, 10, 29)
D = dt.date


def uid(n: int) -> uuid.UUID:
    return uuid.UUID(int=n)


def samples(*pairs: tuple[dt.date, int]) -> list[OdometerSample]:
    return [OdometerSample(d, km) for d, km in pairs]


# 100 km/day over 60 days, ending today at 10,000 km.
PACE = samples((TODAY - dt.timedelta(days=60), 4000), (TODAY, 10000))


def subject(limit_km: int, limit_date: dt.date, kind: ac.SubjectKind = "warranty_coverage", n=1):
    return LimitSubject(kind, uid(n), limit_km, limit_date)


# --- driving pace ---------------------------------------------------------------------------


def test_pace_basic() -> None:
    assert driving_pace(PACE, TODAY) == ac.Pace(km=6000, days=60)


def test_pace_needs_two_records() -> None:
    assert driving_pace(PACE[:1], TODAY) is None
    assert driving_pace([], TODAY) is None


@pytest.mark.parametrize(("span", "expected"), [(29, None), (30, ac.Pace(300, 30))])
def test_pace_span_boundary(span: int, expected: ac.Pace | None) -> None:
    s = samples((TODAY - dt.timedelta(days=span), 1000), (TODAY, 1300))
    assert driving_pace(s, TODAY) == expected


@pytest.mark.parametrize(("age", "used"), [(180, True), (181, False)])
def test_pace_window_boundary(age: int, used: bool) -> None:
    s = samples((TODAY - dt.timedelta(days=age), 1000), (TODAY, 1900))
    assert (driving_pace(s, TODAY) is not None) is used


def test_pace_ignores_future_samples() -> None:
    s = [*PACE, OdometerSample(TODAY + dt.timedelta(days=1), 99999)]
    assert driving_pace(s, TODAY) == ac.Pace(6000, 60)


def test_pace_needs_odometer_to_rise() -> None:
    assert driving_pace(samples((D(2026, 8, 1), 5000), (TODAY, 5000)), TODAY) is None
    assert driving_pace(samples((D(2026, 8, 1), 5000), (TODAY, 4000)), TODAY) is None


def test_pace_same_day_samples_are_ordered_by_km() -> None:
    s = samples((D(2026, 8, 1), 5000), (D(2026, 8, 1), 4900), (TODAY, 7000))
    assert driving_pace(s, TODAY) == ac.Pace(2100, 89)


# --- date versus km -------------------------------------------------------------------------


def test_finding_when_km_limit_comes_first() -> None:
    # 100 km/day, 1000 km left -> 10 days, date limit in 100 days.
    out = check_date_vs_km([subject(11000, TODAY + dt.timedelta(days=100))], PACE, 10000, TODAY)
    assert len(out.findings) == 1
    f = out.findings[0]
    assert f.condition == "date_vs_km_warranty"
    assert f.dedupe_key == f"date_vs_km_warranty:{uid(1)}"
    assert f.inputs == {
        "km_to_limit": 1000,
        "days_to_expiry": 100,
        "projected_limit_date": (TODAY + dt.timedelta(days=10)).isoformat(),
    }
    assert f.source_refs[0].kind == "warranty_coverage"
    assert f.suggestion is not None
    assert f.suggestion["due_date"] == (TODAY + dt.timedelta(days=10)).isoformat()


def test_service_reminder_uses_its_own_condition_and_title() -> None:
    s = subject(11000, TODAY + dt.timedelta(days=100), "reminder")
    f = check_date_vs_km([s], PACE, 10000, TODAY).findings[0]
    assert f.condition == "date_vs_km_service"
    assert f.source_refs[0].kind == "reminder"
    assert f.suggestion is not None
    assert "service" in f.suggestion["title"]


def test_no_finding_when_date_comes_first() -> None:
    out = check_date_vs_km([subject(20000, TODAY + dt.timedelta(days=30))], PACE, 10000, TODAY)
    assert out.findings == ()
    assert out.skipped == ()


def test_projected_equal_to_date_limit_is_not_a_finding() -> None:
    out = check_date_vs_km([subject(11000, TODAY + dt.timedelta(days=10))], PACE, 10000, TODAY)
    assert out.findings == ()
    out = check_date_vs_km([subject(11000, TODAY + dt.timedelta(days=11))], PACE, 10000, TODAY)
    assert len(out.findings) == 1


def test_projection_rounds_up_to_whole_days() -> None:
    # 1001 km at 100 km/day = 10.01 days -> 11.
    out = check_date_vs_km([subject(11001, TODAY + dt.timedelta(days=100))], PACE, 10000, TODAY)
    assert (
        out.findings[0].inputs["projected_limit_date"]
        == (TODAY + dt.timedelta(days=11)).isoformat()
    )


@pytest.mark.parametrize(("km_left", "found"), [(36500, True), (36501, False)])
def test_horizon_is_365_days(km_left: int, found: bool) -> None:
    s = subject(10000 + km_left, TODAY + dt.timedelta(days=1000))
    assert bool(check_date_vs_km([s], PACE, 10000, TODAY).findings) is found


def test_expired_and_overrun_subjects_are_skipped_silently() -> None:
    expired = subject(11000, TODAY - dt.timedelta(days=1), n=1)
    overrun = subject(9000, TODAY + dt.timedelta(days=100), n=2)
    out = check_date_vs_km([expired, overrun], PACE, 10000, TODAY)
    assert out.findings == () and out.skipped == ()


def test_date_limit_today_is_still_checked() -> None:
    out = check_date_vs_km([subject(10001, TODAY)], PACE, 10000, TODAY)
    assert out.findings == ()  # projected is after today, never before the limit


def test_exactly_at_km_limit_has_zero_days() -> None:
    out = check_date_vs_km([subject(10000, TODAY + dt.timedelta(days=5))], PACE, 10000, TODAY)
    assert out.findings[0].inputs["km_to_limit"] == 0


def test_not_enough_data_is_reported_per_condition() -> None:
    subs = [
        subject(11000, TODAY + dt.timedelta(days=100), "warranty_coverage", 1),
        subject(11000, TODAY + dt.timedelta(days=100), "reminder", 2),
        subject(11000, TODAY + dt.timedelta(days=100), "reminder", 3),
    ]
    out = check_date_vs_km(subs, PACE[:1], 10000, TODAY)
    assert out.findings == ()
    assert [s.condition for s in out.skipped] == ["date_vs_km_service", "date_vs_km_warranty"]
    assert all(s.reason == "not_enough_data" for s in out.skipped)


def test_no_odometer_means_not_enough_data() -> None:
    out = check_date_vs_km([subject(11000, TODAY + dt.timedelta(days=100))], PACE, None, TODAY)
    assert [s.condition for s in out.skipped] == ["date_vs_km_warranty"]


def test_no_subjects_no_noise() -> None:
    out = check_date_vs_km([], [], None, TODAY)
    assert out.findings == () and out.skipped == ()


def test_findings_are_sorted_by_key() -> None:
    subs = [subject(11000, TODAY + dt.timedelta(days=100), n=n) for n in (3, 1, 2)]
    keys = [f.dedupe_key for f in check_date_vs_km(subs, PACE, 10000, TODAY).findings]
    assert keys == sorted(keys)


def test_inputs_hold_only_derived_values() -> None:
    f = check_date_vs_km([subject(11000, TODAY + dt.timedelta(days=100))], PACE, 10000, TODAY)
    assert set(f.findings[0].inputs) == {"km_to_limit", "days_to_expiry", "projected_limit_date"}
    assert str(uid(1)) not in repr(f.findings[0].inputs)


# --- charging cost drift --------------------------------------------------------------------


def charge(n: int, amount: int, wh: int | None, day: int | None = None) -> ChargeSample:
    date = D(2026, 1, 1) + dt.timedelta(days=day if day is not None else n)
    return ChargeSample(uid(n), date, dt.datetime(2026, 1, 1, tzinfo=dt.UTC), amount, wh)


def steady(count: int, amount: int = 5000, wh: int = 10000) -> list[ChargeSample]:
    return [charge(n, amount, wh) for n in range(1, count + 1)]


@pytest.mark.parametrize(
    ("amount", "wh", "expected"),
    [
        (5000, 10000, 500),
        (1, 2000, 1),
        (1, 1000, 1),
        (3, 2000, 2),
        (1000, 3000, 333),
        (2000, 3000, 667),
    ],
)
def test_cost_per_kwh_rounds_half_up(amount: int, wh: int, expected: int) -> None:
    assert cost_per_kwh_sen(amount, wh) == expected


def test_drift_needs_five_earlier_priced_charges() -> None:
    assert check_charging_cost_drift(steady(5)).skipped[0].condition == "charging_cost_drift"
    assert check_charging_cost_drift(steady(6)).skipped == ()


def test_unpriced_charges_do_not_count() -> None:
    s = [*steady(5), charge(6, 9000, None), charge(7, 9000, None)]
    assert check_charging_cost_drift(s).skipped != ()


def test_no_drift_below_threshold_and_exact_boundary() -> None:
    base = steady(6)  # baseline 500 sen/kWh
    just_under = [*base, charge(7, 5999, 10000)]  # 599.9 -> 600 rounds to exactly +20%
    assert len(check_charging_cost_drift(just_under).findings) == 1
    below = [*base, charge(7, 5990, 10000)]  # 599 -> +19.8%
    assert check_charging_cost_drift(below).findings == ()


@pytest.mark.parametrize("latest", [6000, 4000])
def test_drift_either_direction(latest: int) -> None:
    f = check_charging_cost_drift([*steady(6), charge(7, latest, 10000)]).findings
    assert len(f) == 1
    assert f[0].condition == "charging_cost_drift"
    assert f[0].inputs["average_cost_per_kwh_sen"] == 500
    assert f[0].inputs["latest_cost_per_kwh_sen"] == latest // 10
    assert f[0].source_refs[0].kind == "expense" and f[0].source_refs[0].id == uid(7)
    assert f[0].dedupe_key == f"charging_cost_drift:{uid(7)}"
    assert f[0].suggestion is None


def test_baseline_uses_at_most_ten_earlier_charges() -> None:
    old = [charge(n, 9000, 10000) for n in range(1, 4)]  # very old, expensive
    recent = [charge(n, 5000, 10000, day=100 + n) for n in range(10, 20)]
    latest = charge(99, 5000, 10000, day=200)
    assert check_charging_cost_drift([*old, *recent, latest]).findings == ()


def test_latest_is_by_date_then_created_at_then_id() -> None:
    a = ChargeSample(uid(1), D(2026, 5, 1), dt.datetime(2026, 5, 1, tzinfo=dt.UTC), 9000, 10000)
    b = ChargeSample(uid(2), D(2026, 5, 1), dt.datetime(2026, 5, 2, tzinfo=dt.UTC), 5000, 10000)
    base = [charge(n, 5000, 10000, day=n) for n in range(10, 15)]
    out = check_charging_cost_drift([a, b, *base])
    assert out.findings == ()  # b is latest and normal; a is only part of the baseline
    assert out.skipped == ()


def test_drift_inputs_hold_only_derived_values() -> None:
    f = check_charging_cost_drift([*steady(6), charge(7, 6000, 10000)]).findings[0]
    assert set(f.inputs) == {"latest_cost_per_kwh_sen", "average_cost_per_kwh_sen", "latest_date"}
