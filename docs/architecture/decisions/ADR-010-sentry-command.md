# ADR-010: One command to the car, Sentry on and off

Status: **accepted by the owner on 2026-11-03 (approvals recorded in `docs/product/sentry-control-and-geofence-proposal.md`). The payload is unverified: nothing has been sent from this app yet.**

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
