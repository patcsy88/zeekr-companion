# ADR-009: Live Zeekr telemetry provider (read-only)

- Status: **Proposed on 2026-10-30. Not accepted. Nothing in this ADR is built, installed or run.** No dependency is added, no Zeekr login is made, no key is extracted. Every step under "Gates" needs the owner's explicit approval.
- Date: 2026-10-30
- Related: ADR-008 (decisions 1, 3 and 4), `docs/research/vehicle-integrations.md` (R1, M29, M30, M42), `docs/operations/zeekr-malaysia-enquiry.md`, AGENTS.md principles 5 to 8 and the approval gates.

## Context

The owner wants the app to read vehicle data through the Zeekr API (`zeekrlife.com` gateways) instead of typing it in. ADR-008 decision 3 left the live provider for a separate ADR after the account, terms and warranty questions are answered.

What is known (research M42, read from source on 2026-10-29, nothing run):

- No official or documented data interface for Malaysian owners has been found (R1, M29). This is absence of evidence, not proof that none exists.
- The only route found is the unofficial `zeekr_ev_api` client (MIT licence, single maintainer). It presents itself as the Zeekr Android app. It needs the owner's Zeekr username and password plus five values extracted from the phone app: an HMAC access key, an HMAC secret key, a password public key, a VIN key and an IV. Extracting them is left to the user.
- Its read calls cover the vehicle list, latest status, VTM status, charging status, remote-control state, charge limit, charge plan, travel plan, trip history and GPS trackpoints. The status calls return raw JSON, so field names are **unverified**.
- Its write calls (`do_remote_control`, `set_charge_plan`, `set_travel_plan`) are not restricted by the library.
- Each call logs the phone app out unless a second account has the car shared to it. `export_session()` returns the password in plain text. It defaults to the SEA region and country `AU`; whether a Malaysian account resolves correctly is **unknown**.
- Upstream is undocumented and can break without notice.

Unanswered, and not answerable from this repo: whether Zeekr's terms forbid this access, whether it can suspend the account, and whether it affects the vehicle or battery warranty. The enquiry to Zeekr Malaysia is drafted but **the owner has decided not to send it for now**, so these stay open.

## Proposal

If the owner decides to go ahead, knowingly accepting the open risks above, the provider is built like this.

1. **It sits behind the existing port.** `VehicleTelemetryProvider` in `app/adapters/telemetry.py` has one method today, `read_odometer`. A live provider adds more `read_*` methods that return a `Reading` with `source` and `observed_at`. The existing test that fails when a non-`read_*` method is added stays.
2. **The library is never exposed.** A wrapper holds the client and calls only a short allow-list of `get_*` methods. It has no attribute that reaches `do_remote_control`, `set_charge_plan`, `set_travel_plan` or `export_session`. A test fails if the wrapper exposes any of them, and another proves a write method on the client is never called.
3. **A second Zeekr account.** The car is shared to a second account and the app logs in as that account only. The owner's main account and phone app are never used by the app (owner answer 2026-10-30). Whether the share gives the second account the read calls needed is **unverified**.
4. **Credentials live only on the host.** The account login and the five extracted values go only in the host `infra/.env`, as secrets. They are never in the repo, logs, Sentry events, model prompts, or chat. Nobody but the owner extracts the values or logs in. An agent does not do either.
5. **Off by default.** A setting switches the provider on. With it off, or when Zeekr is unreachable, every feature works from manual records as today (ADR-008 decision 2).
6. **Minimum data kept.**
   - GPS coordinates are dropped on arrival and never stored, logged or sent anywhere.
   - Trip history is reduced to odometer, distance and energy.
   - Raw responses are not stored. The first readings are mapped field by field after the owner has seen the real field names.
   - Nothing from the live provider reaches the model except the derived values already approved in ADR-008.
7. **Gentle on the upstream API.** Polling is infrequent and fixed (the interval is set at build time and proposed at no more than a few times an hour), with back-off after any error and a stop after repeated failures. One broken login attempt must not retry in a loop, since repeated failures could lock the account.
8. **Failures are visible, not silent.** The app shows "live data unavailable" and the age of the last reading. A stale reading is never shown as current.
9. **Pinned and audited.** If approved, the client is pinned exactly, covered by `pip-audit` and the licence check, and read again at the pinned version before use. It is a single-maintainer package that impersonates an app, so it gets a dependency review of its own.
10. **Scrubbing.** Sentry events already drop messages and request data. A test with fake credentials proves they cannot reach an event or a log line from this provider.

## Risks the owner accepts by approving this

- Zeekr may treat the access as a terms breach and suspend the second account, or the main one if linked.
- It might affect the warranty. This is unknown.
- It can stop working at any time.
- A second account and shared access add one more place where the car's data lives.
- The extracted keys are credentials for impersonating the app. If they leak, someone else could do the same.
- The library can send commands. The wrapper blocks them in this code, but the library underneath still can.

## Gates (each needs the owner's explicit approval)

1. Accept or reject this ADR, knowing the enquiry is unsent.
2. Add the client as a dependency (new external dependency).
3. Create the second Zeekr account and share the car to it.
4. Extract the five values from the phone app. The owner does this. The method is not described here, because the README leaves it to the user and nothing has been checked.
5. Put credentials in the host `.env`.
6. Make the first live login. The owner runs it, with the output reviewed for field names before any mapping is written.
7. Deploy.

## Not decided

- Which fields the app should read first. That depends on the real field names from gate 6.
- The polling interval, and whether the data is stored or only shown live.
- New data model and screens for live readings. Each needs its own design before code, as with ADR-008.
- Whether a supported route appears. If Zeekr Malaysia ever offers one, it replaces this proposal.
