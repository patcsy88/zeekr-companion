# ADR-008: Read-only telemetry adapter and advisory agents

- Status: **Accepted for design on 2026-10-29. Steps 1 to 3 are deployed with the model off. Step 4 (the model call) is built and tested with a fake chat model, not deployed, and no real model has been called.** The owner accepted advisory-only agents (decision 5), the first conditions, a hosted model from the start (replacing the rules-first order in decision 7), Anthropic as the provider with a monthly cap of USD 10.00, the derived-values-only field list, host logging, and LangChain, LangGraph and LangSmith (free tier, with conditions). The owner still has to set and check the cap in the Anthropic console and create the keys (see "Owner approvals").
- Date: 2026-10-29
- Related: `docs/research/vehicle-integrations.md` (R1, M29, M30, M42), AGENTS.md principles 5 to 7 and the approval gates, ADR-005.

## Context

The owner wants the app to read vehicle telemetry through an API call and to use agents that reason over observed conditions and act on them.

No official or documented data interface for Malaysian owners has been found (R1, M29, absence of evidence). The only route found is an unofficial client that impersonates the Zeekr phone app, needs five values extracted from that app plus the owner's account login, and can send commands to the car (M42). Its terms, warranty and account-lock risks are unknown.

The project rules are to prefer documented interfaces, never invent vehicle capabilities, keep vehicle control off unless the owner approves it, and make sure the app works without a live vehicle connection.

## Decision

1. **A read-only telemetry port.** The API defines an interface, `VehicleTelemetryProvider`, with read methods only. Each method returns a typed snapshot in which every field is nullable and carries `source` and `observed_at`. There is no method that sends a command, sets a plan or changes anything on the car. A test fails if one is added to the interface.
2. **The first provider is manual or simulated.** Readings come from what the owner already records (odometer, service records, reminders, expenses, warranty) and from a fixture provider for tests. No live connection is needed for any feature, as the project rules require.
3. **A live Zeekr provider is not part of this decision.** A proposal is in `ADR-009-live-zeekr-provider.md` (design accepted 2026-10-30; nothing built, and its later gates are not approved). It stays behind the port and needs a separate ADR and the owner's explicit approval after the account, terms and warranty questions are answered. Until then:
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

### Anthropic data terms (read by the agent on 2026-10-29 from public pages; the owner has not independently confirmed them)

- **Training:** the Commercial Terms say Anthropic may not train models on Customer Content from the Services, and the customer keeps rights to inputs and owns outputs. Training happens only if the owner opts in (for example the Development Partner Program). Source: Commercial Terms of Service, section B; the Anthropic privacy centre.
- **Retention:** the privacy centre (article dated 1 July 2026) says API inputs and outputs are deleted from Anthropic's backend within 30 days, except where a service has longer retention, where a zero-data-retention agreement exists, where needed to enforce the Usage Policy, or where the law requires it. Content flagged as a Usage Policy violation can be kept for up to 2 years. The API data-retention page says content is not retained by default, but that "Covered Models" (named there as Fable 5.1, Mythos 5.1, Fable 5 and Mythos 5) require 30-day retention. **The two pages describe retention differently, so assume up to 30 days.**
- **Zero data retention** exists, but only by agreement through Anthropic's sales team. It is not available to this project by default.
- **Not checked:** the data-processing addendum, where API traffic is processed (region), and how the spending limit behaves. The cap must be confirmed in the owner's Anthropic account (see below).
- **Consequence:** the fields sent are limited to derived values, so a retained prompt holds nothing that identifies the owner or the car.

## Frameworks and tracing (owner decision 2026-10-29)

The owner approved **LangChain, LangGraph and LangSmith**. The agent had recommended using none of them for the first build; this is the owner's call and is recorded as approved. Conditions that come with the approval:

- **LangChain and LangGraph (free libraries, new dependencies).** Added only when the build starts, pinned exactly, and covered by `pip-audit` and the licence check like every other dependency. The model call still goes through the internal `ReasoningModel` interface, so the provider and the framework stay swappable. The Anthropic integration package is added only if needed.
- **LangSmith (new external service).** Free Developer plan only, with a spend limit and no paid upgrade. Facts from LangSmith's public pages, read by the agent on 2026-10-29 and not confirmed by the owner:
  - The Developer plan is $0 per seat for 1 seat and includes 5,000 base traces a month, then pay-as-you-go. A spend limit must be set so it cannot go beyond the free allowance.
  - Base traces are kept 14 days. Extended traces are kept 180 days and cost extra; do not use them.
  - LangSmith says it does not train on customer data and that traces remain private to the organisation.
  - The region is chosen when the account is created: US, EU (stored in the Netherlands), APAC or AWS US. Pricing and terms are the same. Data cannot be migrated between regions later. Region does not matter to the owner; the suggested default is EU, to match the Sentry choice. The owner picks at sign-up.
  - Some trace metadata may be kept indefinitely for analytics and billing.
  - Not checked: LangSmith's Terms of Service and data-processing terms.
- **What may be traced.** The same limit as decision 7. A trace holds a prompt and a reply, so it may contain only the approved derived values. No notes, names, VIN, plate, certificate numbers, GPS, usernames, tokens or free text.
  - Tracing is **off by default** and is switched on only by an explicit setting in the host `infra/.env`. Tests and local runs trace nothing.
  - Client-side scrubbing runs before anything is sent, and a test with fake secrets proves it, as with the Sentry scrubbers.
  - Engine and other LangSmith features that read trace data or connect to GitHub stay off.
- **The LangSmith key** is created by the owner and goes only into the host `infra/.env`. It is never pasted into chat or committed.
- **Host logs stay the primary audit record.** LangSmith is a second copy for debugging, not the record of what left the host.
- **Second third party.** With LangSmith, derived values reach two companies (Anthropic and LangChain), each with its own retention. This is accepted by the owner.

## Owner approvals (2026-10-29)

- **Provider and plan:** Anthropic, prepaid or pay-as-you-go with a **monthly cap of 10.00**. The currency was not stated; Anthropic bills in US dollars as far as the agent knows, so the owner should confirm that the cap is 10.00 USD in the console. The owner sets the cap in the Anthropic console and checks that it is applied before the key goes on the host. The app also keeps its own call counter and stops calling the model once a configurable monthly call limit is reached, so the cap is not the only guard.
- **Fields allowed to leave the host:** derived values only: the condition name, km to a limit, days to expiry, cost per kWh and the recent average, and a date. Not allowed: notes, names, VIN, plate, certificate numbers, GPS, usernames, tokens, free text of any kind, or whole records.
- **Logging:** prompts and replies are logged on the host for audit. Agreed.
- **Region:** does not matter to the owner.
- **Terms:** checked by the agent (above). The owner asked for the check; the owner's own reading of the terms is still the owner's call.
- **API key:** the owner creates it and puts it only in the host `infra/.env`. It is never pasted into chat or committed.

With these approvals the model part of decision 7 is accepted for design. **No model is called, and no key is requested, until the build exists and the owner has put the key on the host.**

## Still needed from the owner before any model is called

- The cap amount is **confirmed by the owner as USD 10.00 per month (2026-10-29)**. Still to do by the owner: set it in the Anthropic console and check that it is active before the key goes on the host.
- LangSmith: choose the region and set a spend limit when creating the account, then create a key (host `infra/.env` only).
- (Superseded by the approvals above, kept for the record) Written approval of the exact fields that may be sent, from the minimum list in decision 7.
- Agreement that prompts and replies are logged on the host.
- Whether the data region matters, as it did for Sentry.

## Not decided

The data model for snapshots and proposals, the API contract, the screens, the scheduling of checks, and the live provider. Each needs its own design step after acceptance.
