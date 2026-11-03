# ADR-010: One command to the car, Sentry on and off

Status: **accepted by the owner on 2026-11-03 (approvals recorded in `docs/product/sentry-control-and-geofence-proposal.md`). The payload is verified for both directions on the owner's car (see the build records).**

## Context

ADR-008 and ADR-009 say the app sends no commands to the car, and tests ban the Zeekr library's write methods in the read adapter and the dump tool. The owner now wants to switch Sentry on and off by hand from the app, after the read-only Sentry indicator was confirmed against the car.

## Decision

- The app may send **one** kind of command: Sentry on or off. Nothing else. No lock, door, window, climate, charge or any other command, and no unattended or automatic command. The geofence alert (proposal, Piece B) is advisory only and never sends this command.
- The call lives in one module, `app/adapters/zeekr_sentry_command.py`. The service id, key and value are constants there; no caller can pass another command, service, key or value. The read-only adapter and the dump tool keep their ban on write methods, and a test fails if any other file under `app/` names the write method.
- The payload comes from a third-party Home Assistant integration for the same car model (MIT licence, not tested by the owner): service `RSM`, one setting with key `rsm` and value `6`; command `start` to switch on and `stop` to switch off. This is **unverified** until the owner's first run.
- **First send is owner-run.** A CLI (`python -m app.cli.zeekr_sentry_send`) makes one login, reads `vstdModeState`, sends one command, waits, reads it again and prints only the two values and whether Zeekr accepted the call. The agent never runs it. Only after the owner reports a watched, correct read-back does the app get an endpoint and a button.
- After any send the state shown is what the car reports on a later read, never an assumption that the command worked.
- The account used is the second account, as for the reads. Whether it may send commands is unknown.

## Consequences

- The "no commands to the car" rule is narrowed, not removed. ADR-008 "Act" stays advisory.
- A wrong payload could do something unintended on the car or get the account flagged. Mitigation: the owner-run first send, one command, watched.
- Zeekr's terms are unverified, and a command is a stronger action than a read.
- Sentry may draw on the 12 V battery. The app does not know how long Sentry has been on.
- Later steps (endpoint, button, `car_command_log` table, migration `0012`) are separate, need a fresh encrypted export before the deploy, and are recorded here as build records.

## Not allowed

- Any other command, including the library's charge and travel plan writers.
- Sending from a schedule, a rule or the model.
- Logging or storing the payload, the reply body, the VIN or any position.

## Build records

- **First send, owner-run (2026-11-04).** The owner ran `app.cli.zeekr_sentry_send --on`: state before off, Zeekr accepted the call, state after 15 seconds on, and the owner saw Sentry come on in the car (owner-observed). The owner then ran `--off`: state before on, accepted, state after off, and the owner observed Sentry off. So `RSM` / `rsm` = `6` with `start` and `stop` is **confirmed** on this car, with the second account, for one on/off cycle. Not covered: other cars or software versions, or whether Zeekr changes it later. The "unverified" label on the payload is dropped.
- **Endpoint, log and button (2026-11-04; not deployed).** `POST /api/v1/vehicle/sentry`, `GET /api/v1/vehicle/sentry/log`, table `car_command_log` (migration `0012`) and a confirm-first button on the live card, as in `api-contracts.md` (Amendment: Sentry command). Decisions inside the approved scope: the 60-second spacing is counted from the last logged command; the send shares the provider's lock, session and login cap; a status read that holds the lock for over 5 seconds makes the send a 409; the web request waits up to 45 seconds because the server waits about 15 for the car. The new error code `upstream_error` (502) is used by this endpoint only. Tests use a fake vehicle; the autouse guard still blocks the real client, and a test fails if any file but `zeekr_sentry_command.py` names the write method.
- **Not verified:** the button on a phone, behaviour with two pages open, how Zeekr treats repeated sends, the effect on the 12 V battery, and whether a send is slower than 45 seconds on a bad day.
- **Owner trial and web fix (2026-11-04; web only, not deployed).** The owner pressed Send on the host. The card still showed the older reading ("No newer reading yet", 5-minute minimum spacing), so the Sentry state and the button did not follow the car. Fix, option A chosen by the owner: after a send, the page keeps the state the car reported at read-back, shows it as "Sentry: on/off, read from the car at <time>" and offers the next button from it, until a newer card reading arrives. No API change, no migration, no extra read of the car. A `null` state after sets nothing. Not chosen: merging the read-back into the stored card reading (option B), which would store a partial reading and change the provider and contract.
