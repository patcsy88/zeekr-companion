# ADR-008: Read-only telemetry adapter and advisory agents

- Status: **Proposed on 2026-10-29. Not accepted: the owner has not reviewed it. No code exists.**
- Date: 2026-10-29
- Related: `docs/research/vehicle-integrations.md` (R1, M29, M30, M42), AGENTS.md principles 5 to 7 and the approval gates, ADR-005.

## Context

The owner wants the app to read vehicle telemetry through an API call and to use agents that reason over observed conditions and act on them.

No official or documented data interface for Malaysian owners has been found (R1, M29, absence of evidence). The only route found is an unofficial client that impersonates the Zeekr phone app, needs five values extracted from that app plus the owner's account login, and can send commands to the car (M42). Its terms, warranty and account-lock risks are unknown.

The project rules are to prefer documented interfaces, never invent vehicle capabilities, keep vehicle control off unless the owner approves it, and make sure the app works without a live vehicle connection.

## Decision

1. **A read-only telemetry port.** The API defines an interface, `VehicleTelemetryProvider`, with read methods only. Each method returns a typed snapshot in which every field is nullable and carries `source` and `observed_at`. There is no method that sends a command, sets a plan or changes anything on the car. A test fails if one is added to the interface.
2. **The first provider is manual or simulated.** Readings come from what the owner already records (odometer, service records, reminders, expenses, warranty) and from a fixture provider for tests. No live connection is needed for any feature, as the project rules require.
3. **A live Zeekr provider is not part of this decision.** It stays behind the port and needs a separate ADR and the owner's explicit approval after the account, terms and warranty questions are answered. Until then:
   - the unofficial client is not added as a dependency,
   - no one extracts keys from the app on the owner's behalf,
   - no Zeekr login is made by any agent or by the app.
4. **If a live provider is ever approved, it is read-only by construction.** It would call only the client's `get_*` methods through a wrapper that exposes nothing else, and it would use a second Zeekr account with the car shared to it, as the client's author advises. Credentials and keys would live only in the host environment, never in the repo, logs or Sentry events. Trip history would be reduced to odometer, distance and energy before storing. GPS coordinates would be dropped on arrival.
5. **Agents are advisory.** The "reason and act" loop is: observe a snapshot, evaluate rules or a model against it, and propose. A proposal is a suggested reminder, a flag or a notification. It is stored as `proposed` and does nothing until the owner accepts it, as with the service-schedule and warranty templates. An agent can never create a reminder directly, edit a record, delete anything or touch the vehicle.
6. **Every proposal is explainable.** It records which readings and which rule or prompt produced it, so the owner can see why it appeared.
7. **No owner data to external model services without approval.** If a hosted model is used for reasoning, that is a new external service and an approval gate (AGENTS.md). Rule-based checks need no external service and come first.

## Examples of conditions (illustrative, not a commitment)

- Odometer within a set distance of a service or warranty km limit.
- Warranty or reminder due date approaching while the recorded odometer suggests the km limit will be reached first.
- Charging cost per kWh drifting from the owner's recent average.
- With a live provider only: low state of charge, charging not started when a plan expected it, a tyre pressure reading outside the owner's own range.

## Consequences

- Useful agent behaviour can be built and tested now on data the app already holds.
- A future live source plugs in without changing the agents or the screens.
- Without live data, the conditions that depend on it (battery, tyres, charging state) are unavailable. That is accepted.
- Advisory-only agents cannot fix anything by themselves. The owner is in the loop every time. That is intended.
- Unknown risks of unofficial access stay out of the codebase until the owner has the answers.

## Open questions for the owner

1. Does "act" mean advisory proposals only, as set out here? Commands to the car are out of scope for this ADR.
2. Rule-based checks first, with a hosted model considered later only after approval?
3. Which conditions matter most? That sets the first build.
4. Zeekr Malaysia's answer on supported data access and the warranty effect (see `docs/operations/zeekr-malaysia-enquiry.md`).

## Not decided

The data model for snapshots and proposals, the API contract, the screens, the scheduling of checks, and the live provider. Each needs its own design step after acceptance.
