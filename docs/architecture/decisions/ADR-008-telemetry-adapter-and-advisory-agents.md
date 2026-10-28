# ADR-008: Read-only telemetry adapter and advisory agents

- Status: **Partly accepted on 2026-10-29. No code exists.** The owner accepted advisory-only agents (decision 5) and the first conditions (below). The owner chose a hosted model from the start, which replaces the rules-first order in decision 7. **That part is not approved yet:** the provider and the fields allowed to leave the host are still to be named by the owner (see "Owner decisions").
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
7. **A hosted model does the reasoning (owner decision 2026-10-29, replacing "rules first").** This is a new external service and an approval gate (AGENTS.md), and it sends owner data off the host. It is therefore **blocked until the owner approves, in writing in this ADR, (a) the provider and plan, and (b) the exact fields that may be sent.** Until then no agent calls any model. Whatever is approved, these limits apply:
   - Send the minimum: derived values (for example "km to limit", "days to expiry", "cost per kWh versus the recent average"), not whole records, notes, names, the VIN, plate, certificate numbers, GPS or credentials.
   - The model's output is text and a structured suggestion only. It cannot call tools that write data. Code validates the suggestion, then stores it as `proposed` (decision 5).
   - Free tier or a spending cap set by the owner. The API key lives only in the host `infra/.env`, never in the repo, logs or Sentry events.
   - The app must work with the model unreachable or switched off: the checks still run and list their findings without an explanation.
   - Prompts, the fields sent and the model's reply are logged on the host, so the owner can audit what left.

## Conditions

Chosen by the owner on 2026-10-29 for the first build, using data the app already holds:

1. A warranty or reminder due date approaching while the recorded odometer suggests the km limit will be reached first.
2. Charging cost per kWh drifting from the owner's recent average.

Held until a live data source exists: low state of charge, charging not started when a plan expected it, a tyre pressure reading outside the owner's own range.

Not selected for now: a plain "odometer is near a service or warranty km limit" check. It overlaps with condition 1 and can be added later.

## Consequences

- Useful agent behaviour can be built and tested now on data the app already holds.
- A future live source plugs in without changing the agents or the screens.
- Without live data, the conditions that depend on it (battery, tyres, charging state) are unavailable. That is accepted.
- Advisory-only agents cannot fix anything by themselves. The owner is in the loop every time. That is intended.
- Unknown risks of unofficial access stay out of the codebase until the owner has the answers.

## Owner decisions

1. "Act" means advisory proposals only. Commands to the car are out of scope. **Answered yes, 2026-10-29.**
2. Reasoning by a hosted model from the start, not rules first. **Answered 2026-10-29; the provider and the fields that may leave the host are not yet named, so the model part is not approved.**
3. First conditions: the two listed above. **Agreed, 2026-10-29.**
4. Zeekr Malaysia's answer on supported data access and the warranty effect (see `docs/operations/zeekr-malaysia-enquiry.md`). **Open. It does not block the work above.**

## Provider (owner decision 2026-10-29)

The owner chose **Anthropic, with a spending cap**. The monthly cap amount is not yet set. The API key is created by the owner in their own Anthropic account, with the cap set there, and goes only into the host `infra/.env`. It is never pasted into chat or committed. Data retention and training terms for API traffic have not been checked from this repo; the owner should read Anthropic's current terms before approving the fields below.

## Still needed from the owner before any model is called

- The monthly spending cap amount.
- Written approval of the exact fields that may be sent, from the minimum list in decision 7.
- Agreement that prompts and replies are logged on the host.
- Whether the data region matters, as it did for Sentry.

## Not decided

The data model for snapshots and proposals, the API contract, the screens, the scheduling of checks, and the live provider. Each needs its own design step after acceptance.
