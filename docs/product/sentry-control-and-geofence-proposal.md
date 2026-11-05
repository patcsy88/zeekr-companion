# Sentry toggle and geofence alert (proposal)

Status: **approved by the owner on 2026-11-03 (all seven decisions below); not built, not deployed.** The engine and car states are still to be researched, so Piece B's rule is not final. No reading, coordinate or address is copied here.

Owner answers on 2026-11-03: (1) the hand toggle comes first; (2) alert first, no unattended command; (3) the geofence centre is the owner's home address; (4) the position is held in memory first; (5) the engine and car states need more research; (6) the check runs at a configurable interval (minimum 5 minutes), and stale positions are configurable, tagged stale and not used.

## Piece A: Sentry on/off by hand

This is the first time the app would send a command to the car. ADR-008 and ADR-009 forbid that today, and a test bans the library's write methods in the adapter and the dump tool. A new ADR (proposed ADR-010) would allow **one** command, Sentry on and off, and nothing else.

### Evidence for the command

- A third-party Home Assistant project for the Zeekr 7X (MIT licence, not verified on this car) sends `do_remote_control` with service `RSM` and one setting, key `rsm`, value `6`. It reads state from the same `vstdModeState` key we use, and that key was confirmed against this car by the owner.
- Its start/stop command words for on and off were not fully traced. Our own payload is **unverified**: nothing has been sent from this app.
- The write goes to the same remote-control endpoint family as the read, using the second account. The account may not be allowed to send commands. Unknown.

### Design

- **Write path kept apart.** A new module holds the single call. The read-only adapter keeps its ban on write methods, and a new test allows exactly this call in exactly this module.
- **First send is an owner-run CLI**, like the login check: one login, one command, with a confirm variable, output redacted and pasted back. The agent never runs it. Only after that works does the app get an endpoint.
- **Endpoint:** `POST /api/vehicle/sentry` with `{"desired": "on" | "off"}`, token required, no-store, one request in flight at a time, and a minimum spacing between sends. A failure returns a fixed message and never the server's text.
- **Confirm in the app.** The control is a button with a confirm step, not a switch that flips on a tap. The card's read-only indicator stays as it is. After a send, the app re-reads `vstdModeState` and shows what the car reports, never assuming success.
- **Sentry only.** The service id, key and value are constants. There is no field that lets a caller choose another command.

### Data model (needs approval)

- One new table `car_command_log`: id, time (UTC), desired (`on` or `off`), source (`manual`), result (`sent`, `refused` or `failed`) and the state read back (`on`, `off` or null). No payload, no response body, no VIN, no position. Kept 12 months, covered by delete-all.
- Migration `0012`. Needs a fresh encrypted export before the deploy.

### Contract (needs approval)

- `POST /api/vehicle/sentry` as above. `400 validation_error` for a bad body, `401` without a token, `409` while another send is in flight or too soon, `502` with a fixed message if Zeekr refuses.
- `GET /api/vehicle/sentry/log` returns the last entries.

### Risks

- The payload may be wrong or may do something else on this car. Mitigation: owner-run first send, with a watched read-back, before any endpoint exists.
- Zeekr may treat remote commands as outside its terms or flag the account. The terms are still unverified.
- Sentry uses the 12 V battery. Switching it on may drain it faster, and the app does not know how long it was left on.
- A command to a moving or locked car is not something the app can check. It only sends the one Sentry command.

## Piece B: geofence alert

An alert only. No command is sent. The result is an **advisory proposal** in the existing Advisory tab (ADR-008), so there is no new service and no push notification.

### Rule

An open alert exists while **all** of these hold on a fresh position:

1. The car is farther than the configured radius from the home point.
2. The engine and car are in the states the owner chooses (open, see below).
3. Sentry reads off.

The alert closes by itself when any of them stops holding. At most one alert is open at a time.

### Settings (host `infra/.env` only)

- `GEOFENCE_ENABLED` (off by default).
- Home latitude and longitude. **Never in the repo**; the owner provides them. The app does no address lookup, so no address is sent to any service.
- Radius in km (configurable).
- Check interval in minutes, minimum 5, same bounds as the live interval.
- Stale limit in minutes (configurable). A position older than this is tagged **stale** and is **not used**: the check records "skipped, position stale" and opens or closes nothing.

### Position handling

- ADR-009 drops position on arrival. This would change: latitude, longitude and the position's own timestamp are read from the status reply the app already fetches, kept **in memory only** for the check, and never written to the database, logs, errors, exports, the model or the API. Only the derived result (inside, outside, stale, unknown) leaves the check.
- No extra Zeekr read is needed, because the position is in the reply the card already fetches.
- Which key holds the position's timestamp is **not yet known**. Staleness needs it. If the reply has none, the check falls back to the reading's own time. That is a research item.
- A restart loses the in-memory value. The check then reports "unknown" until the next fresh read.

### A background check is new

Today the app reads Zeekr only while the Vehicle page is open, plus once a day for a service reminder. A check every 5 minutes means an unattended read all day, with the page closed. That raises the login and request volume, the 12 V battery risk and the terms risk, and is a separate decision. It is part of this approval, not a side effect.

- It shares the provider's single cached snapshot and its spacing, so it cannot read more often than the interval.
- It uses the existing login cap, back-off and stop-after-failures rules.
- It is off unless `GEOFENCE_ENABLED` is true.

### Data model and contract (needs approval)

- Advisory proposals are reused with a new kind, `sentry_off_outside_geofence`. The alert text states the distance band and the time, and never coordinates. Whether it should carry a rounded distance at all is a question below.
- No new table for the check itself. A short log line per run, without position: result, age of the reading, reason skipped.
- Contract: the Advisory list gains the new kind. A settings read-only endpoint is not proposed.

### Engine and car states: research

Open. The state keys are not known, and the dump tool hides lock and door keys unless `--include-lock-door` is passed. Proposed: an owner-run `--dump` with that flag, read on the Mac, with the owner pasting only the **key names and plain values** for the engine, power, gear, lock and door keys and nothing position-like. The dump holds the owner's password hash and must not be pasted whole. The conditions are written into the contract only after that.

#### Car state keys: `gearAutoStatus` and `usageMode` (2026-11-05, `unverified`)

Only these two keys are recorded. No other reading is copied into the repo. The owner-run `--dump` on the Mac supplied the values. Both mappings are `unverified`.

**`$.additionalVehicleStatus.drivingBehaviourStatus.gearAutoStatus`**: the gear labels are the owner's, stated for each reading.

| `gearAutoStatus` | Gear        | Times read |
| ---------------- | ----------- | ---------- |
| `'0'`            | Park (P)    | 4          |
| `'1'`            | Reverse (R) | 1          |
| `'2'`            | Neutral (N) | 1          |
| `'3'`            | Drive (D)   | 2          |

- No outside source labels this key. On 2026-11-05 the public Home Assistant integration (`Fryyyyy/zeekr_homeassistant`: source, `services.yaml`, `translations/en.json` and tests), the `zeekr_ev_api` 0.1.15 library, and the issues and pull requests of both repos were searched for `gearAutoStatus`, "gear", "park" and "neutral". None of them label it. So the labels above rest on the owner's readings alone.

**`$.basicVehicleStatus.usageMode`**: the owner chose this as the car status. The labels are from the public integration above (`custom_components/zeekr_ev/sensor.py`, class `ZeekrVehicleStatusSensor`, lines 686 to 693; MIT licence; nothing of the owner's was sent). They are that project's labels, not Zeekr's.

| `usageMode` | Label in that project | Read on the owner's car |
| ----------- | --------------------- | ----------------------- |
| `'0'`       | Deep Sleep            | no                      |
| `'1'`       | Parked                | no                      |
| `'2'`       | Unlocked              | yes, 1 dump             |
| `'3'`       | System Active         | no                      |
| `'4'`       | Ready to Go           | no                      |
| `'13'`      | Active                | yes, 2 dumps            |

**Read together** (the only readings that have both keys):

| Reading             | `usageMode` | `gearAutoStatus` |
| ------------------- | ----------- | ---------------- |
| Engine-off dump     | `'2'`       | `'0'` (Park)     |
| Engine-running dump | `'13'`      | `'0'` (Park)     |
| Drive (D) dump      | `'13'`      | `'3'` (Drive)    |

- `usageMode` was not captured for the Reverse, Neutral and single Park and Drive readings, because only the gear key was pasted.
- `usageMode '13'` read the same with the gear in Park and in Drive, so on its own it does not separate "parked with the car on" from "in gear". The gear key does.
- Only `'2'` and `'13'` have been read on the owner's car. The labels for `'0'`, `'1'`, `'3'` and `'4'` are not checked against it.
- A value is only as fresh as the last cloud upload. Whether either key updates while the car is moving is not known, because `speed` read 0 in every sample.
- The engine and car-state conditions for the rule are **not decided**. The owner is working that out, and nothing is written into the contract until the owner says.

## Risks (both pieces)

- Zeekr's response to a command, and to an all-day background read from a different address, is unknown.
- A stale or wrong position could raise a false alert or hide a real one. Mitigation: stale positions are skipped and tagged, and the alert says when the reading was taken.
- The alert shows only inside the app. iOS push needs an installed PWA over HTTPS, which is not set up (Tailscale deferred). Without that the owner sees the alert only when the app is open.
- Home latitude and longitude on the host are sensitive. They stay out of the repo, logs, backups of the app's data and chat.

## Decisions needed

1. Approve ADR-010 (one command, Sentry only) and the data model and contract for Piece A?
2. Approve the owner-run CLI as the first real send?
3. Approve a background check every 5 minutes or more, even with the page closed?
4. Approve in-memory position handling, with only the derived result leaving the check?
5. Should the alert carry a rounded distance (for example to the nearest km), or say only "outside"?
6. Alert delivery: in-app only for now, or do you want push later (needs HTTPS)?
7. Approve the owner-run `--include-lock-door` dump, pasting only the key names and plain values for the engine and car states?

Build order if approved: A (ADR-010, CLI, owner-run test, endpoint, button), then the dump research, then B.

## Owner decisions, 2026-11-03

1. Approved: ADR-010 (one command, Sentry only), the data model (`car_command_log`, migration `0012`) and the contract for Piece A.
2. Approved: the owner-run CLI as the first real send.
3. Approved: a background check every 5 minutes or more, even with the page closed.
4. Approved: in-memory position handling, only the derived result leaves the check.
5. The alert says only "outside", with no distance.
6. Delivery is in-app only for now.
7. Approved: the owner-run `--dump --include-lock-door` read, pasting only key names and plain values for the engine and car states.

Still open: the engine and car state conditions (waiting on the dump), whether the account may send commands, the real Sentry payload, and Zeekr's terms. The owner's home point and radius are not in the repo and are never to be.

## Owner decisions, 2026-11-05

1. Default radius: 5 km (configurable).
2. Stale limit: 30 minutes (configurable). A position older than this is tagged stale and not used.
3. Check interval: 5 minutes (the approved minimum).
4. The geofence centre is the owner's home. It is **not** recorded in the repo, in any doc, in tests, in logs or in the model prompts. It goes in the host `infra/.env` only. How the owner's address becomes coordinates is open: the app does no address lookup, and a lookup would be a new external service that needs the owner's approval (see the proposal above).
5. Car-state condition: the owner proposed `gearAutoStatus = '0'` and `usageMode = '0'`. **Not yet accepted.** `usageMode '0'` has never been read on the owner's car (only `'2'` and `'13'`), so the condition may never be true. Waiting on a reading with the car asleep in Park.

## Owner decisions, 2026-11-05 (geocoding)

1. **Service approved: the public Nominatim API (OpenStreetMap).** Free, no account, no key. Source: the OSMF Nominatim usage policy, read 2026-11-05 (1 request per second at most, identifying User-Agent, attribution, results cached, periodic app use discouraged, no personal data).
2. **Lookup is built into the app, and runs once.** On first start with the geofence on, the app makes one HTTPS request, saves the coordinates and never calls the service again. A changed query triggers a new lookup.
3. **Street-level query only** (street, town, postcode; no house number). Nominatim sees the query text and the host's IP address.
4. **Saved result:** a small file on the host data volume, not a database table, holding the coordinates and a hash of the query. Approved.
5. **Setting name approved:** `GEOFENCE_HOME_QUERY`, set in the host `infra/.env` only. `GEOFENCE_HOME_LAT` and `GEOFENCE_HOME_LON` stay as a manual override that skips the lookup.
6. **Never logged or exposed:** the query and the coordinates stay out of logs, errors, exports, the API and model prompts. A failed lookup shows only "home point not set", and the geofence stays off.
7. **Fallback if Nominatim is refused or fails:** the manual override, or Geoapify (needs a new approval, an account and a key).
8. Still open: the car-state condition (waiting on the owner's sleeping-car reading), and the contract and data model.
