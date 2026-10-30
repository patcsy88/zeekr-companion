# Live vehicle card: proposal

Status: **proposed, not approved** (drafted 2026-10-31 at the owner's request, "B"). No code, contract or screen exists for this. Builds on ADR-009 (the read-only live provider, deployed off) and ADR-008 (the telemetry port). Nothing here changes an approved contract until the owner approves it.

## What the owner would get

One read-only card showing what the car last reported, with the time it was reported:

- Battery percent and electric range (km).
- Plugged in and charging (yes or no).
- Tyre pressures in kPa, four wheels, named by the driver's side (driver front, passenger front, driver rear, passenger rear).
- Odometer (km).
- Distance and days to the next service, as the car counts them.

Every line says "as of" the car's own update time (Asia/Kuala_Lumpur), and a missing reading shows "no reading", never zero. These fields were compared with the car on one reading (ADR-009, owner-reported, 2026-10-31). Stability over days is **unverified**.

## What it deliberately does not do

- No location, lock state, door or boot state, VIN, plate or nickname. These are not in the provider's snapshot and cannot reach the screen.
- No commands to the car. The provider has `read_*` methods only (ADR-009 decision 1).
- No tyre warnings or "low pressure" colours. The app has no recommended pressure (the tyre specification is free text), so a threshold would be invented.
- No writing into service records or reminders. If the live odometer and the latest record differ, both are shown with their sources and nothing is created or changed.
- No use by the advisory checks or the model in this slice. The model keeps receiving derived values from records only (ADR-008 decision 2).

## Proposed behaviour

1. **Pull, not push.** The server contacts Zeekr only when the owner opens the card or presses Refresh. There is no background polling. The provider already serves a cached snapshot for at least 5 minutes, so repeated opens do not repeat the call.
2. **Not stored.** Readings live in the server's memory and are lost on restart. No new table, no migration. A history (for example battery over time) would be a separate slice with its own data model.
3. **Online only.** The card is not cached by the service worker and is not queued offline. Offline it says "Needs a connection". Live data that looks current but is old would mislead.
4. **Off means invisible.** With `ZEEKR_LIVE_ENABLED=false` the card shows "Live readings are off" and no call is made.
5. **Failure is stated plainly.** States: off, reading, readings available, no readings (car reported nothing), unavailable (last read failed), paused (5 failures, until the API restarts). No server text is shown.

## Draft endpoint (proposed, not in `api-contracts.md`)

`GET /api/v1/live-vehicle`, authenticated like every other route, `Cache-Control: no-store`.

```json
{
  "status": "ok",
  "readings": {
    "odometer_km": {"value": 13763, "observed_at": "2026-10-30T16:23:06Z"},
    "battery_percent": {"value": 64.0, "observed_at": "..."},
    "range_km": {"value": null, "observed_at": null},
    "tyres_kpa": {"value": {"driver": 236, "passenger": 240, "driver_rear": 238, "passenger_rear": 233}, "observed_at": "..."}
  }
}
```

The numbers above are examples in the right shape, not a reading. `status` is one of `off`, `ok`, `unavailable`, `paused`. Timestamps are UTC, shown in Kuala Lumpur time. Errors use the existing shape (400 `validation_error`, 401 and so on). No request body, so no validation cases beyond authentication.

## Acceptance criteria (draft)

1. With the flag off, the endpoint returns `status: "off"` with no readings, and no outbound call is made.
2. With the flag on, opening the card makes at most one Zeekr read per 5 minutes however many times it is opened.
3. A missing, empty or out-of-range value is `null`, shown as "no reading".
4. The response contains no position, lock, door, VIN, plate or nickname field (test on the serialised response).
5. A failed read returns `status: "unavailable"` with fixed text, and nothing from the server or the library appears in the response or the logs.
6. After 5 failures the endpoint returns `status: "paused"` and makes no further calls until restart.
7. The card shows "as of" in Asia/Kuala_Lumpur and does not render when offline.
8. Unauthenticated requests get 401.

## Work, in order (each step ends with the full gates and a local commit)

1. Owner approves this proposal and answers the questions below.
2. Contract entry in `api-contracts.md`, shown to the owner before code.
3. Backend route and tests (fake provider only).
4. Web card and tests, including offline behaviour and a check that the service worker does not cache the endpoint.
5. Independent QA and security review.
6. Deploy with the flag still off. Gate 5 (real values in the host `.env`) is a **separate** approval after that, and the first real call from the host happens only then.

## Risks and unknowns

- **Account risk.** Zeekr may restrict the second account. The owner accepted this for the account (ADR-009). The host would log in from a different address than the Mac did, which is untested.
- **Unofficial API.** Zeekr can change it at any time. The card then shows "unavailable" and the rest of the app is unaffected.
- **Effect on the car.** It is **unknown** whether a status read wakes the car or affects the 12 V battery. Pull-only reads with a 5-minute minimum keep the load low, but this is not measured.
- **Terms.** Whether Zeekr's terms allow this use is unverified. The enquiry draft stays unsent by the owner's choice.
- **Stability of the sign-in.** `prod_secret` candidate 3 worked on the Mac on 2026-10-31. Whether it keeps working is unknown.
- **Paused state needs a restart.** After 5 failures the owner must restart the API. A "try again" button would be a small addition, but it would let a person hammer a failing login, so it is not proposed.

## Questions for the owner

1. Is this the right first use, or would you rather the odometer feed the existing service checks first?
2. Which lines should the card show? The list above, fewer, or more?
3. Where should it live: at the top of the Vehicle page, or its own tab?
4. Is "shown live, never stored" right for now, or do you want history (a separate slice)?
5. Do you accept pull-only with a 5-minute minimum, or do you want a different spacing?
6. Should a paused state need an API restart, or do you want a deliberate reset?
