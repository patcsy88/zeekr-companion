# Live vehicle card: Sentry indicator (proposal)

Status: **data model and contract approved by the owner on 2026-11-03; built, not deployed.** Name: `sentry_active` (owner's choice). On 2026-11-03 the owner agreed to the name "Sentry", the `unverified` label and a second Zeekr call on each refresh. No code, no migration and no deploy is approved. No reading is copied here.

## Evidence

- Source: three owner-run `--remote-state` reads on 2026-11-03, with the owner toggling Sentry on the car in between (the owner confirmed the toggle but not whether it was on the screen or in the app).
- Result: one key moved with the toggle, `vstdModeState`: `'0'` with Sentry off, `'1'` with Sentry on, `'0'` again with Sentry off. Its event ID (`vstdModeStatusEventId`) changed on each flip.
- No key is named "sentry" or "rsm" in either Zeekr reply the app can read (`status/latest`, `getVehicleState`). The owner-run dump found none in the library source either.
- One on/off cycle is a small sample. The meaning of `vstdModeState` is **`unverified`**: it follows the owner's toggle, but the name does not say Sentry, and it could be a related state that Sentry switches on.
- Other values (for example a "triggered" state) may exist. Only `'0'` and `'1'` have been seen.

## What would be added

- A read-only on/off indicator on the live card and the history page, labelled "Sentry", with the note "unverified" in the same way as the other indicators.
- Value mapping: `'1'` is on, `'0'` is off, anything else (including `None`, empty text or a missing key) is "no reading". Numbers 1 and 0 and the text "true" and "false" are not accepted from this key, because only the two strings have been seen.
- Display only. The app has no write path to the car and none is added. The indicator never sends anything to the model.

## Data model (needs approval)

- One nullable boolean column on `live_reading`, following `pre_climate_active` and the other indicators from migration `0009`. Name: `sentry_active` (owner chose it over `vstd_mode_active`).
- Migration `0011`: add the column, no default, no backfill. Existing rows keep null ("no reading"). Needs a fresh encrypted export before the deploy.
- Retention (12 months) and delete-all already cover the table.

## Contract (needs approval)

- The live card and the history item gain one nullable field, `sentry_active` (or the alternative name).
- No new endpoint and no new request field. Shared types are regenerated and checked for drift.

## The second Zeekr call

- Today `ZeekrStatusSource` calls `login`, `get_vehicle_list` and `get_status`. The addition is one more read, `get_remote_control_state` on the same vehicle object, in the same login session. It is a GET in the library; the library's write methods stay unused and a test keeps them out of the adapter.
- It is made on every refresh, at the same spacing as the status read (5 minutes minimum). It adds no login. The daily login cap of 10 is unchanged.
- **Failure handling:** if the second read fails, the main reading is still stored and the Sentry field is "no reading". A failure of the second read alone does not count toward the provider's failure count or back-off. A failure of the main read behaves as today.
- Only one field is taken from the reply. `gpsstate`, all event IDs and every other state key are dropped on arrival, in the same way position, lock and door fields are dropped now (ADR-009).
- The daily service-reminder read uses the same source, so it also makes the second call.

## Risks

- `vstdModeState` may not mean Sentry. The card could show "Sentry on" when another mode is on. Mitigation: the `unverified` label, and a second on/off check against the car before the label is dropped.
- The car may report the change late. The card is as old as the last read, which can be about an hour.
- Zeekr's response to an extra call per refresh is unknown. The effect of status reads on the 12 V battery is already an open risk and this adds to it a little.
- The unattended daily task has not run against a real car yet.

## Common impact

- `ZeekrStatusSource`, `map_status`, `Snapshot`, `live_limits.py` (no range needed), `LiveCardOut`, `LiveReadingItem`, `live_vehicle.py`, the card and the history page, `api-contracts.md`, ADR-009, shared types and tests.
- One migration. A fresh export, then an owner-run deploy.

## Decisions needed

1. Approve the data model and contract above, or change them?
2. Column and field name: `sentry_active` or `vstd_mode_active`?
3. After approval: build it, run the gates and commit locally. The push and the deploy are asked separately.
