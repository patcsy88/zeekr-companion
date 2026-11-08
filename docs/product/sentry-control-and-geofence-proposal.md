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
- The app does not know how long Sentry was left on.
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

- Advisory proposals are reused with a new kind, `sentry_off_outside_geofence`. The alert says only "outside": no distance, no band and no coordinates (owner decision 2026-11-03).
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

## Owner decisions, 2026-11-05 (car-state condition)

1. **Reading taken by the owner with the car asleep in Park:** `$.basicVehicleStatus.usageMode = '0'` and `$.additionalVehicleStatus.drivingBehaviourStatus.gearAutoStatus = '0'`. Only these two values are recorded. The "Deep Sleep" label is still the public project's, so it stays `unverified`.
2. **Condition accepted:** `gearAutoStatus = '0'` and `usageMode = '0'`.
3. **Consequence the owner accepted:** the rule fires only once the car has gone to sleep in Park. It does not fire while the car is awake in Park (`usageMode '2'` or `'13'` has been read in that state), outside the geofence, with Sentry off.
4. Still open: the Piece B contract and data model, for the owner's approval before any code.

## Piece B: contract and data model (DRAFT, needs the owner's approval before any code)

Drafted 2026-11-05 from the owner's decisions above. **Approved by the owner on 2026-11-05. Implemented 2026-11-05 (API, web, migration `0013`, compose volume); not committed to a deploy, not run against the real car.** It changes the approved Advisory contract in two places (marked **CHANGE**), so the owner must be told and must approve first.

### Conflicts found while drafting

1. **CHANGE: a new `status` value `closed`.** The approved Advisory `status` is `proposed | accepted | dismissed`, and a database check requires `decided_at` to be set exactly when the status is not `proposed`. The alert "closes by itself", which none of those three values means. Proposed: add `closed` (set by the check, never by a client), with `decided_at` set when it closes. `PATCH` still accepts only `accepted` or `dismissed`.
2. **CHANGE: a new `condition` value `sentry_off_outside_geofence`.** The `advisory_proposal` table has a check constraint listing the three existing conditions. So "no new table" holds, but a **migration (`0013`) is needed** to widen the `condition` and `status` checks. It adds no column and no data. A fresh encrypted export is needed before the owner deploys it.
3. **The proposal text above says the alert states a distance band.** The owner decided on 2026-11-03 that the alert says only "outside", with no distance. That decision wins, and the line is superseded.

### Data model

- No new table and no new column. Migration `0013` only replaces the `condition_valid` check (adds `sentry_off_outside_geofence`) and the `status_valid` and `decided_matches_status` checks (add `closed`; `closed` requires `decided_at`).
- Each alert is one `advisory_proposal` row. `dedupe_key` is unique, so it is `geofence:<episode>`, where the episode is the UTC time the alert opened, to the second. A new alert after an old one closed gets a new key.
- `inputs` holds `{ "reading_age_minutes": 0 }` only. **No position, no distance, no radius, no home point** is stored.
- `source_refs` is `[]`. `suggestion` is `null`. `urgency` is `null`.
- **Proposed: no model call for this kind.** The text is fixed by code, and `explanation_status` is `disabled`. The alert is the same with the model off. This is for the owner to decide.
- The position and the home point live in memory only. The geocoded home point is held in a small file on the host data volume (approved above), not in the database.

### Contract

- `GET /advisory/proposals`: the existing `status` filter gains `closed`. The default (`proposed`) shows the open alert. `all` includes closed ones.
- Proposal object: `condition` gains `sentry_off_outside_geofence`; `status` gains `closed`. No new field, endpoint or error code.
- `PATCH`: unchanged. `accepted` or `dismissed` on an open alert is allowed. On a `closed` alert: `409 conflict`, as for any decided item.
- `POST /advisory/checks`: unchanged. It does not run the geofence check. The geofence check runs only on its own schedule.
- `GET /advisory/status`: unchanged. No settings endpoint is added.
- No endpoint sends anything to the car. The geofence never sends the Sentry command.

### Check behaviour

1. Runs every `GEOFENCE_INTERVAL_MINUTES` (default 5, minimum 5) while `GEOFENCE_ENABLED` is true. Off by default.
2. Takes the provider's cached snapshot and its spacing, the login cap, back-off and stop-after-failures rules. It cannot read more often than the interval.
3. A reading older than `GEOFENCE_STALE_MINUTES` (default 30) is stale: the run records "skipped, stale" and opens or closes nothing.
4. Fresh reading: the alert should be open if the distance from home exceeds `GEOFENCE_RADIUS_KM` (default 5), `gearAutoStatus` is `'0'`, `usageMode` is `'0'` and Sentry reads off. Otherwise it should be closed.
5. If none is open and it should be: open one. If one is open and it should not be: set it to `closed`. At most one is open.
6. If the home point is missing or the lookup failed: the run records "home point not set" and does nothing else.
7. A dismissed alert stays dismissed for that episode. The next alert opens only after the condition stopped holding and came back.
8. The log line per run holds the result, the reading's age and the reason skipped. It holds no position and no distance.

### Settings (host `infra/.env` only; names approved 2026-11-05 except where noted)

`GEOFENCE_ENABLED` (default off), `GEOFENCE_HOME_QUERY`, `GEOFENCE_HOME_LAT` and `GEOFENCE_HOME_LON` (manual override), `GEOFENCE_RADIUS_KM` (5), `GEOFENCE_INTERVAL_MINUTES` (5, minimum 5), `GEOFENCE_STALE_MINUTES` (30). The setting names are proposed, and the owner approved the home-query name only.

### Acceptance criteria and tests (to be written first)

- Distance: points inside, on the edge of and outside the radius, including a pole-crossing and an antimeridian case.
- Rule: each of the four conditions failing alone opens nothing; all four holding opens exactly one alert; a repeat run opens no second one.
- Closing: each condition stopping closes the alert; a stale reading closes and opens nothing.
- Dismiss: a dismissed alert does not reopen in the same episode.
- Privacy: a test fails if the position, the distance, the home point or the query appears in a proposal row, a log line, an error, an export, a model prompt or an API response.
- Lookup: one request only; no second request on restart when the saved result matches the query hash; a failed lookup leaves the geofence off and reports "home point not set". Tests use a fake HTTP client and never call Nominatim.
- Background: never reads more often than the interval; stops after the existing failure limit; does nothing when `GEOFENCE_ENABLED` is false.
- Migration: upgrade and downgrade on a database that already has the three older conditions.
- The existing Advisory tests, the web tests and the shared-types drift check still pass.

### Risks specific to this draft

- The rule fires only once the car has gone to sleep (owner accepted). A car that stays awake in Park outside the geofence raises no alert.
- Cloud data can be hours old. A stale reading raises nothing, so the alert can be late or missing.
- The position's own timestamp key is still unknown. The fallback is the reading's own time, which can make a stale position look fresh.
- An all-day background read may be noticed by Zeekr, may drain the 12 V battery, and is unverified under their terms.
- Nominatim's policy discourages personal data. The query is street level only, sent once.
- The alert shows in-app only. If nobody opens the app, nobody is told.

## Owner decisions, 2026-11-05 (contract and data model)

The owner approved the Piece B contract and data model above, as drafted ("Approve"): the `closed` status, the `sentry_off_outside_geofence` condition, migration `0013`, no model call for this kind, a dismissed alert staying dismissed for its episode, and the settings list. Changing it now needs the owner to be told first. Build starts with tests. A deploy is owner-run and needs a fresh encrypted export first because of the migration.

## Piece C: a Geofence settings tab (approved and implemented, not deployed)

Drafted 2026-11-05 from the owner's request and answers. **Data model and contract approved by the owner on 2026-11-05, with the answers below.** **Implemented 2026-11-05 (API, web tab, migration `0014`); not deployed, not run against the real car.**

### Owner answers (2026-11-05)

- **First step is settings only.** The geofence still only alerts and never sends anything to the car.
- **Settings live in the database**, edited in the tab, applied without a restart. The home address and coordinates stay in the host `.env` only and never appear in the tab, the API or the database.
- **Automatic Sentry on is not part of this step.** For a later step the owner chose these safeguards: off by default with a switch in the tab, fresh reading only, once per episode, log every automatic send, and "notify and ask first". The last one conflicts with an automatic send (one asks the owner, the other sends by itself). It is open and must be settled in that later step's own proposal. That step needs a new ADR (the first automatic vehicle command) and the owner's approval before any code.

### What the tab edits

| Setting                                 | Today (from `.env`) | Proposed limit in the tab   |
| --------------------------------------- | ------------------- | --------------------------- |
| Radius (km)                             | 5                   | above 0, up to 100          |
| Check interval (minutes)                | 5                   | 5 to 1440                   |
| Stale limit (minutes)                   | 30                  | 1 to 1440 (open question 1) |
| Gear codes that count as "parked"       | `0`                 | 1 to 5 codes, each 0 to 99  |
| Usage-mode codes that count as "asleep" | `0`                 | 1 to 5 codes, each 0 to 99  |

`GEOFENCE_ENABLED` and the home point stay in `.env` (they need a restart and a lookup). The tab shows whether the geofence is on, and whether a home point is set, as yes or no only.

### Data model (CHANGE: the Piece B "no new table" no longer holds)

- One new table, `geofence_settings`, one row only (`id` fixed at 1, enforced by a check). Columns: `radius_km`, `interval_minutes`, `stale_minutes`, `gear_codes`, `usage_mode_codes` (small integer lists), `updated_at` (UTC).
- Migration `0014`. Needs a fresh encrypted export before the deploy. No home data is stored.
- No row means the `.env` values apply. Once a row is saved, it wins over `.env`.

### Contract

| Method | Path                        | Meaning                                                                                                                            |
| ------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/geofence/settings` | Current settings, where each value comes from (`saved` or `env`), the limits, `enabled` (bool) and `home_set` (bool). `200`, `401` |
| `PUT`  | `/api/v1/geofence/settings` | Saves all five values. `200` with the same body, `400 validation_error` (never 422), `401`                                         |

- Token required, `no-store`, the 64 KiB limit and the existing error shape. No new error code.
- The home address, coordinates, distance and car position never appear in a request or response.
- The check reads the saved row at each run, so a change applies at the next check. A new interval applies after the current wait.
- Changing the codes changes what an alert means. The rule version stays 1 and the alert's `inputs` stay `{"reading_age_minutes": N}`.
- Web: a new "Geofence" tab, online only, with a plain note that it never sends anything to the car.

### Open questions for the owner

1. **Stale limit maximum.** The host now has 1440. A long limit lets an alert open on a reading up to 24 hours old. Keep 1440 as the tab's maximum, or cap it lower (for example 180)?
2. **Code entry.** Free numbers, or a pick-list of the known gear labels (P `0`, R `1`, N `2`, D `3`, from your readings only) and the `usageMode` labels (unverified, from the public integration)?
3. **Reset.** Add a "Use the `.env` values" button that deletes the saved row?

### Owner answers to the open questions (2026-11-05), now part of the approved draft

1. **Stale limit maximum is 30 minutes** in the tab (minimum 1). A `.env` value above 30 still starts the API (the host has 1440 today) and applies until a row is saved. The tab will show it as above its limit and refuse to save it until it is changed to 30 or less.
2. **Pick lists.** Gear codes: P `0`, R `1`, N `2`, D `3` (labels from the owner's readings only). Usage-mode codes: `0` Deep Sleep, `1` Parked, `2` Unlocked, `3` System Active, `4` Ready to Go, `13` Active (`unverified`, the public integration's labels). The API accepts only these codes, 1 to 5 distinct values each.
3. **Reset: yes.** Contract addition: `DELETE /api/v1/geofence/settings` removes the saved row and returns `200` with the settings as they then stand (`env` values). Safe to repeat.

## Update 2026-11-08: gear fixed at P, vehicle states narrowed (owner approved)

The owner set the car-state condition for the geofence, and so for automatic Sentry: gear must be P (`gearAutoStatus '0'`), which is no longer a setting, and the vehicle state must be Deep Sleep (`usageMode '0'`) and/or Parked (`'1'`), chosen on the Geofence tab under "Vehicle State(s)". The other four states never count. Radius, check interval and stale limit are unchanged. The gear and usage-mode pick lists in the Piece C sections above are superseded. `usageMode '1'` (Parked) is `unverified`: it has not been read on the owner's car. Details: `docs/architecture/api-contracts.md`, the 2026-11-08 geofence amendment.
