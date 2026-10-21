# Requirements

Status: **confirmed**, **proposed** or **unverified**. Each requirement has an ID so tests can trace to it.

## Functional requirements: MVP

| ID | Requirement | Status |
|---|---|---|
| FR-1 | Create, view, edit the vehicle profile: model, variant, drive (AWD), steering side (RHD), registration, VIN, purchase date, purchase price, tyre specification | proposed |
| FR-2 | Record a service: date, odometer, provider, description, cost, notes | proposed |
| FR-3 | List service history, newest first, and view one record | proposed |
| FR-4 | Edit and delete a service record, with confirmation before delete | proposed |
| FR-5 | Record an expense: date, category, amount, notes | proposed |
| FR-6 | Record warranty details and warranty claims | proposed |
| FR-7 | Create reminders (service, insurance renewal, road tax renewal) with a due date or due odometer (km). Malaysian context: road tax is administered by JPJ. | proposed |
| FR-8 | Show upcoming and overdue reminders | proposed |
| FR-9 | Record tyre changes and rotations | proposed |
| FR-10 | Attach a photo or document to a service record or expense | proposed |
| FR-11 | Authenticate before any data is accessible | proposed |
| FR-12 | Offer the official AWD Performance service schedule (every 20,000 km or 1 year, whichever comes first; research M12) as a suggested reminder template. The owner reviews, edits and explicitly accepts it before any reminder is created. It is never applied silently. Not part of the initial vertical slice. | proposed |

## Non-functional requirements

| ID | Requirement | Status |
|---|---|---|
| NFR-1 | Cached data stays readable when the server is unreachable | proposed |
| NFR-2 | Offline writes are queued and synced when connectivity returns, with visible sync state | proposed |
| NFR-3 | No secrets or personal identifiers in source control | confirmed |
| NFR-4 | All schema changes use migrations | confirmed |
| NFR-5 | Backend can be backed up and restored, and a restore has been tested | proposed |
| NFR-6 | The API is not exposed directly to the public internet | proposed |
| NFR-7 | Money stored as integer minor units, timestamps in UTC | proposed |

## Constraints

- No vehicle integration is required for any MVP requirement.
- No undocumented Zeekr API is used.
- No vehicle control capability.

## Acceptance criteria: initial vertical slice

The slice covers FR-1, FR-2, FR-3 and FR-11.

| ID | Criterion |
|---|---|
| AC-1 | `docker compose up` starts PostgreSQL and the API, and `GET /health` returns 200 |
| AC-2 | Migrations apply cleanly to an empty database and can be re-run without error |
| AC-3 | An unauthenticated request to any data endpoint returns 401 |
| AC-4 | A vehicle can be created, then retrieved, with the same values |
| AC-5 | A service record with a negative cost or a missing date is rejected with a validation error |
| AC-6 | After a service record is created in the web app, it is still listed after a full page reload and after closing and reopening the app (installed to the Home Screen on the owner's iPhone once an HTTPS origin exists). It is also returned by `GET /api/v1/service-records` from a different browser profile, which shows it is stored on the server. |
| AC-7 | After the web app has been opened once while online, and with the API unreachable, reopening it from a cold start still shows the previously loaded vehicle and service records from the local cache, with a visible offline indicator. |
| AC-8 | Lint, type checks and tests pass for both the web client and the backend |
| AC-9 | A service record created while offline is shown as pending, and is sent exactly once, with no duplicate, when the API becomes reachable again (covers NFR-2). Added by the owner 2026-10-11. |

## Open questions for the owner

Resolved:

- Distance unit is kilometres (confirmed 2026-10-11).
- ADR-001 and the API contract are approved (2026-10-11).

- Service schedule is offered as a suggested template that the owner can accept or edit (owner decision 2026-10-22, FR-12). Reason: Zeekr's PDF says requirements vary by build date, conditions and local rules. Source: research M12, `verified` against the official Malaysia PDF.
- Authentication is a single owner password for now (confirmed 2026-10-11). A full account model is deferred.
- Client is a mobile-responsive web app instead of a native iOS app, to avoid the Apple Developer fee (confirmed 2026-10-11). The web stack is a React + Vite + TypeScript PWA (ADR-002, approved 2026-10-11), served same-origin through a reverse proxy container.
- Cached data is readable without an app lock; the owner relies on the phone lock (confirmed 2026-10-11).
- `gitleaks` and Playwright browser downloads are approved as free tools (confirmed 2026-10-11).
- Phone-side checks for AC-6 and AC-7 are blocked until the Tailscale HTTPS origin is set up (owner chose Tailscale on 2026-10-13, see ADR-003). They are reported as blocked, not passed.
- Remote access: Tailscale, free Personal plan (owner decision 2026-10-13, ADR-003). Funnel stays off and nothing is exposed to the public internet (NFR-6). The repository is public, so the real tailnet name, hostnames, account email and device names must never appear in it; use placeholders.

- The owner's market is Malaysia, not the UK, and the currency is MYR with the `currency` field kept and defaulting to MYR (confirmed 2026-10-11). The earlier UK research is void for the owner's market.

- The service-record rule "date not in the future" stays as written, judged against the current UTC date, with no tolerance (owner decision 2026-10-11). Known consequence: between 00:00 and 08:00 Malaysian time, today's local date is ahead of the UTC date and is rejected with `validation_error`. The web client should show that error clearly. Owner decision 2026-10-12: the new-record form defaults its date to the current UTC date, so the default is never rejected, and a hint under the field explains the window.

- Login lockout stays a hard lockout (owner decision 2026-10-11). After too many failed attempts, login returns 429 even for the correct password until the window passes. Known trade-off: someone who can reach the API could keep the owner locked out, so reachability limits (NFR-6) are the main protection. The limiter is in memory and resets on restart.

Deferred:

1. Remote access: decided, see above (Tailscale). The open sub-questions (where TLS terminates, tailnet naming, HSTS, key expiry, identity provider) are listed in ADR-003.
