# Live vehicle card: possible additions (proposal)

Status: **A and B approved, C rejected by the owner on 2026-11-03.** The data model and contract are approved in `api-contracts.md`. No deploy is approved. No reading is copied here.

Source: one owner-run `--dump` on 2026-11-03. All meanings below are `unverified` until compared with the car.

## Candidates

### A. 12 V battery voltage

- Raw key: `additionalVehicleStatus.maintenanceStatus.mainBatteryStatus.voltage` (a number).
- Meaning: voltage of the 12 V auxiliary battery. `unverified`.
- Value: the first direct reading of the 12 V battery. Stored over time, it shows a slow decline and helps check the open risk that status reads drain it. It is the only candidate with a safety-style use.
- Not proposed: `mainBatteryStatus.stateOfHealth`. It printed '0', which looks like "not reported".
- Data model: one nullable column on `live_reading` (numeric, 1 decimal), plus a CHECK range (proposed 6 to 20 V).
- Contract: one more field in the live card and history items. The sample is "no reading" when missing.
- Risks: the unit and precision are unverified. Voltage varies with charging and rest state, so a single value is not a health verdict. No threshold or colour is proposed, since the app has no known good range.

### B. Tyre temperatures

- Raw keys: `maintenanceStatus.tyreTempDriver`, `...Passenger`, `...DriverRear`, `...PassengerRear` (integers).
- Meaning: probably °C per wheel. `unverified`.
- Value: shown next to the pressures. Temperature explains pressure changes (pressure rises when tyres are warm). It helps judge pressure readings.
- Data model: four nullable integer columns, same all-four-or-none rule as pressures, CHECK range (proposed -40 to 150).
- Contract: a `tyres_celsius` object beside `tyres_kpa`.
- Risks: all four read the same value on this sample, so they may be one shared figure, not four sensors. That should be checked on a driven car before the card implies four readings.

### C. Trip meters

- Raw keys: `runningStatus.tripMeter1`, `tripMeter2` (strings), `avgSpeed` (string).
- Meaning: probably km and km/h. `unverified`. The reset points of each meter are unknown.
- Value: low. The odometer already exists, and the app cannot tell when the owner resets a meter. Trip 1 was far above trip 2 in the sample, so they are not the same counter.
- Data model: two or three nullable columns.
- Recommendation: do not add. It costs a column and screen space for data that cannot be interpreted safely.

## Not proposed

- `averPowerConsumption` (probably kWh/100 km): meaning not checked, and it is per-trip, so it may reset.
- `distanceToEmptyOnBattery20Soc` and `...100Soc`: unknown meaning.
- Interior temperature, windows, sunroof, seat heating: not useful for records.
- Placeholders to treat as no reading if ever read: `timeToFullyCharged` = '2047', `dcChargeIAct` = '-1638.0', `basicVehicleStatus.distanceToEmpty` = '0'.
- Position, locks, doors, VIN, plate, nickname: stay dropped (ADR-009).

## Common impact

- One migration (`0009`) adding nullable columns. Existing rows keep null.
- `map_status`, `live_limits.py`, `LiveCardOut`, `LiveReadingItem`, the Vehicle card, the history page, `api-contracts.md`, shared types, tests.
- Nothing goes to the model. Nothing new is requested from Zeekr: the fields come from the same status reply, so there are no extra calls.
- Retention (12 months) and delete-all cover the new columns.

## Recommendation

Approve **A** (12 V voltage) and **B** (tyre temperatures). Reject **C**.

## Decisions needed

1. A: approve, change or reject?
2. B: approve, change or reject? Show it only once a driven-car reading confirms four distinct values?
3. C: reject, or keep?

After approval: contract and data model for the owner's sign-off, then code, gates and a local commit, then the push and deploy questions.
