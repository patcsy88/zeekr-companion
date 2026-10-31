# Live vehicle card: proposal

Status: **proposed, owner answers recorded 2026-10-31, still not approved as a whole** (see "Owner answers" at the end; two points need confirming before the contract is drafted). Drafted 2026-10-31 at the owner's request, "B". No code, contract or screen exists for this. Builds on ADR-009 (the read-only live provider, deployed off) and ADR-008 (the telemetry port). Nothing here changes an approved contract until the owner approves it.

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

1. **Updates by a timer and by pull-down (revised after the owner's answers to questions 4 and 5).**
   - **Timer:** the card refreshes itself every X minutes while it is on screen. X is configurable, with a **minimum of 5 minutes**; a lower value is refused or raised to 5.
   - **Pull-down:** pulling the page down asks for a refresh. The server still spaces its real calls to Zeekr by the same X, so a pull inside that window returns the cached reading and the card says "no newer reading yet" with the reading's own time. This stops repeated pulls from becoming repeated logins.
   - **Who polls (proposed, needs the owner's confirmation):** the web page does, only while the Vehicle page is open and visible. The server never polls Zeekr in the background. Background polling around the clock would mean about 288 reads a day at 5 minutes, would run with nobody looking, and the effect of reads on the car's 12 V battery is unknown. The alternative (server polls all the time, so the card is always warm and history becomes possible) is a larger decision and is not what this proposal assumes.
   - **Where X is set (proposed, not found in the repo):** a host setting such as `ZEEKR_LIVE_INTERVAL_MINUTES` in `infra/.env`, default 5, floor 5, changed by editing the file and restarting the API. The API sends the current X to the page so the timer follows it. An in-app setting would need a stored value and a settings screen; that is not proposed unless the owner wants it.
2. **No history table.** Readings live in the server's memory and are lost on restart. No new table, no migration. This is the agent's reading of the owner's answer; see "Owner answers". A history (for example battery over time) would be a separate slice with its own data model.
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
2. With the flag on, the server makes at most one Zeekr read per X minutes (X from the setting, never below 5) however many times the card is opened, timed or pulled down, and none while no page asks.
2a. A setting below 5 is raised to 5 (or refused at startup; the contract will say which), and the response carries the current X so the page timer matches.
2b. Pull-down inside the window returns the cached reading and the card says no newer reading yet.
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

## Owner answers (2026-10-31)

1. **First use:** yes, read the information from the car and show it read-only. Whether any of it goes to the model is the owner's later decision (nothing goes now).
2. **Lines:** show all of the list above.
3. **Place:** the Vehicle page.
4. **Updates:** "No" to pull-only. Poll for updates on a configurable interval, and also allow pull-down to refresh.
5. **Spacing:** configurable, with a 5-minute minimum.
6. **Paused state:** hold for now. Until decided, a paused provider stays paused until the API restarts, and no reset is built.

## Still open (needs the owner before the contract is drafted)

- **A. Who polls.** The page while it is open (proposed), or the server all the time? See behaviour item 1.
- **B. "No" to question 4.** The agent read it as "update on a timer, not only on open", with no history table. If the owner also wants readings kept over time, that is a data model and a separate slice.
- **C. Where the interval is set.** Host `.env` and restart (proposed), or an in-app setting.
- **D. Explicit approval** of this proposal as revised, so the contract can be drafted for review. Nothing is built until then.
