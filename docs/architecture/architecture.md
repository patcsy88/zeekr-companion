# Architecture

Status: **proposed**, pending owner approval. Technology choices are recorded in ADR-001 (backend, database, deployment), ADR-002 (web client), ADR-003 (remote access and HTTPS through Tailscale, accepted by the owner 2026-10-13) and ADR-004 (standalone Ubuntu Server host, replacing Unraid, accepted by the owner 2026-10-15). Where ADR-002 is approved it supersedes the mobile choice in ADR-001. ADR-004 supersedes the "Unraid" deployment target in ADR-001.

## Overview

```
iPhone browser / installed PWA ──HTTPS (origin not yet available)──▶ Reverse proxy (web) ──▶ FastAPI ──▶ PostgreSQL
  IndexedDB cache + write queue      same origin: static files + /api/*                       │
  service worker (app shell only)                                                             └──▶ Integration adapters (none in MVP)
```

## Components

| Component | Location | Responsibility |
|---|---|---|
| Web client (PWA) | `apps/web` (replaces `apps/mobile`, per ADR-002) | UI, routing, IndexedDB cache, offline write queue, in-memory token, service worker for the app shell |
| Reverse proxy | `infra` (Compose service `web`) | Serves the static client, forwards `/api/*` and `/health` to the API, sets security headers, terminates TLS once available |
| API | `services/api` | HTTP interface, validation, business rules, authentication |
| Persistence | PostgreSQL | Vehicle, service, expense, reminder, warranty and tyre records |
| Adapters | `services/api/app/adapters` | Replaceable interfaces to external vehicle and document sources |
| Shared types | `packages/shared-types` | Contract types shared by the web client and API, generated from the OpenAPI schema |

## Backend layering

1. **Routers** handle HTTP and validation only.
2. **Services** hold business rules and are independent of HTTP.
3. **Repositories** handle persistence.
4. **Adapters** wrap external systems behind interfaces.

Routers never query the database directly. Services never import HTTP types.

## Web client layering (proposed)

1. Pages and components
2. Hooks and state
3. API client (relative URLs, `/api/v1`)
4. Local storage and sync queue (IndexedDB)
5. Service worker (app shell precache only; never caches `/api/*`)

`packages/shared-types` must not import React or DOM types.

## Data model (initial)

| Table | Key fields |
|---|---|
| `vehicle` | id, model, variant, drive, steering, registration, vin, purchase_date, purchase_price_minor |
| `service_record` | id, vehicle_id, date, odometer, provider, description, cost_minor, notes |
| `expense` | id, vehicle_id, date, category, amount_minor, notes |
| `reminder` | id, vehicle_id, kind, due_date, due_odometer, completed_at |
| `warranty` / `warranty_claim` | coverage, start, end, claim details |
| `tyre_record` | position, brand, spec, fitted_date, odometer |
| `attachment` | id, owner_type, owner_id, path, mime_type |

The slice implements `vehicle` and `service_record` first. Other tables are added in later increments, each with a migration.

### Reminders data model (approved with the contract, 2026-10-22)

Refines the placeholder `reminder` row above for the Reminders slice (FR-7, FR-8, FR-12). Contract: "Reminders" in `api-contracts.md`.

| Table | Fields |
|---|---|
| `reminder` | `id` uuid PK (client generated), `kind` varchar(30), `title` varchar(200), `due_date` date null, `due_odometer` integer null (km), `notes` text null, `completed_on` date null, `template_ref` varchar(100) null, `created_at`, `updated_at` timestamptz |

- The placeholder `vehicle_id` and `completed_at` are dropped: there is one vehicle (singleton) and the service-record table has no `vehicle_id` either, so the table follows that pattern. Completion is a date, `completed_on`, not a timestamp, for consistency with the other date fields.
- Check constraints (named, per `NAMING_CONVENTION`): `kind IN ('service','insurance_renewal','road_tax_renewal')`; `due_date IS NOT NULL OR due_odometer IS NOT NULL`; `due_odometer IS NULL OR (due_odometer >= 0 AND due_odometer <= 10000000)`; `due_odometer IS NULL OR kind = 'service'` (proposal, Q4); `char_length(title) BETWEEN 1 AND 200`.
- Index on `(completed_on, due_date, due_odometer)` for the list order. At most 500 rows, so a plain scan is fine.
- `status` and `overdue_by` are computed on read, never stored, because they depend on today's date and the latest service record.
- Current odometer is read from `service_record` (latest `date`, `created_at`, `id`) with no new column (proposal, Q1). It is a read through the service layer: the reminders service calls the service-record repository, and routers never query across tables.
- The template is static, versioned data in code. It has no table.
- One migration (`0002`) adds the table, with a downgrade.
- Web: the IndexedDB `cache` store gains a reminders key, and the `queue` gains reminder create, edit and delete kinds. This needs no new object store, but `QueueKind` and `applySuccess` change. Overdue is computed on the device by a pure function that shares test vectors with the backend. The service worker is unchanged and still never caches `/api/*`.
- Implemented 2026-10-22: migration `0002_reminder`, `Reminder` model, `app/clock.py` (`today_kl`, Asia/Kuala_Lumpur) used by both service-record and reminder date checks, `reminder_status.compute_status` (backend) and `apps/web/src/lib/reminderStatus.ts` (web), tested against one shared vector file. `zoneinfo` finds `Asia/Kuala_Lumpur` in the `python:3.13-slim` image, so no `tzdata` dependency was added. The device date is derived with `Intl` in the same zone. The web refreshes the vehicle, records and reminders one after the other, because guarded refreshes that ran side by side kept invalidating each other.
- Staleness risk: the offline status uses the device date and the cached latest service record, so it can differ from the server until the next sync. The UI says so.

### Expenses data model (approved 2026-10-22)

Refines the placeholder `expense` row (drops `vehicle_id` as there is one vehicle, keeps `amount_minor`, adds `currency` and timestamps). Contract: "Expenses" in `api-contracts.md`.

| Table | Fields |
|---|---|
| `expense` | `id` uuid PK (client generated), `date` date, `category` varchar(30), `amount_minor` bigint, `currency` varchar(3) default 'MYR', `notes` text null, `created_at`, `updated_at` timestamptz |

- Check constraints (named): `category IN (...)` the 11 values; `amount_minor >= 1 AND amount_minor <= 10^12`; `currency = 'MYR'`; `date >= '2000-01-01'`. The future-date rule is not a database constraint (it depends on today), it is enforced in the schema like service records.
- Index on `(date DESC, created_at DESC, id DESC)` for the list and cursor. Filters on `category` and `date` use that index plus a filter; at most 5,000 rows.
- Totals by category and by month are `GROUP BY` queries on read (`to_char(date, 'YYYY-MM')`), never stored. Summing 5,000 rows of at most 10^12 stays far below the 64-bit limit; the JSON numbers stay below 2^53 (5,000 x 10^12 = 5 x 10^15 is under 9 x 10^15). Flag: do not raise the cap or the amount bound without rechecking this.
- No foreign key to `service_record` (proposal, Q10).
- Migration `0003` adds the table, with a downgrade.
- Web: a `expenses` cache key, queue kinds for expense create, edit and delete, a pure `expenseTotals` function with shared vectors in `packages/shared-types/test-vectors`, and a pending overlay like `reminderOverlay.ts`. The list uses cursor paging like service records, so the offline totals warn when the cache is partial (AC-41).

### Warranty data model (approved 2026-10-22)

Refines the placeholder `warranty` / `warranty_claim` row. Contract: "Warranty" in `api-contracts.md`.

| Table | Fields |
|---|---|
| `warranty_coverage` | `id` uuid PK (client generated), `name` varchar(200), `provider_type` varchar(20), `start_date` date, `end_date` date null, `km_limit` integer null, `notes` text null, `source_kind` varchar(20), `verification_status` varchar(20), `source_note` varchar(200) null, `template_ref` varchar(100) null, `created_at`, `updated_at` timestamptz |
| `warranty_claim` | `id` uuid PK (client generated), `coverage_id` uuid FK to `warranty_coverage.id` ON DELETE CASCADE, `date` date, `odometer` integer, `description` varchar(500), `status` varchar(20), `cost_covered_minor` bigint null, `currency` varchar(3) default 'MYR', `notes` text null, `created_at`, `updated_at` timestamptz |

- Check constraints (named): `provider_type IN ('factory','extended')`; `source_kind IN ('owner_entered','template')`; `verification_status IN ('confirmed','proposed','unverified')`; `end_date IS NOT NULL OR km_limit IS NOT NULL`; `end_date IS NULL OR end_date >= start_date`; `km_limit IS NULL OR (km_limit BETWEEN 1 AND 10000000)`; claim `status IN ('submitted','approved','rejected','completed')`; `odometer BETWEEN 0 AND 10000000`; `cost_covered_minor IS NULL OR BETWEEN 0 AND 10^12`.
- Index on `warranty_claim (coverage_id, date DESC, created_at DESC, id DESC)`.
- `status`, `expired_by`, `expiring_soon_by` and `claim_count` are computed on read, never stored (they depend on today and the latest service record).
- Current odometer is read through the service layer from `service_record`, the same read reminders use. The reminders service has this logic today; the plan extracts it into a shared function (a refactor of approved reminders code with no contract change, covered by the existing reminder tests).
- The factory template is static, versioned data in code (no table), like the reminder template.
- Migration `0004` adds both tables, with a downgrade.
- No personal data: there is no provider name, certificate number or VIN column. Owner documents (research O1 to O8) are used only as the owner's reference when typing values; their identifiers are never stored in the repository.
- Web: cache keys for coverages and claims, queue kinds for both entities with a dependency rule (a claim create waits on its coverage create), a pure `warrantyStatus` function with shared vectors, a template screen modelled on `ReminderTemplatePage`. Service worker unchanged.
- Known limit: `km_limit` is compared with the odometer reading, not with km since the start date (Q13).

### Advisory agents data model (APPROVED by the owner, 2026-10-29; ADR-008)

Approved as drafted, including the `energy_wh` amendment to Expenses, the check thresholds and the default limit of 60 model calls a month. Contract: "Advisory agents" in `api-contracts.md`. Build status: step 1 (`energy_wh`, migration `0006`) and step 2 (the read-only telemetry port with its records-backed provider, and the two checks as pure functions in `services/advisory_checks.py`, no tables, no model) are built; proposals and the model call are not.

**Telemetry port (code, not a table).** `VehicleTelemetryProvider` is a Python `Protocol` with read methods only (`read_odometer`, and later state of charge, charging state and tyre pressure). Each returns `Reading[T]`: `value` (nullable), `source` (string) and `observed_at` (UTC timestamp, nullable). There is no method that writes or commands. A test inspects the Protocol and fails if any method name is outside an allow-list of `read_*` names.
- `RecordsTelemetryProvider` (the only real provider): odometer from the latest service record (the same read reminders and warranty use), `source = "latest_service_record"`. Every other reading is `None`.
- `FixtureTelemetryProvider` (tests only).
- Snapshots are computed on demand and **not stored** in the first build. A snapshot table is added with the first live provider, in its own ADR.

**Expense change (amends the approved Expenses model).**

| Table | Change |
|---|---|
| `expense` | add `energy_wh` integer null (watt-hours, so no floating point; the UI shows kWh) |

- Check: `energy_wh IS NULL OR (category = 'charging' AND energy_wh BETWEEN 1 AND 1000000)`.
- Existing rows stay `NULL` and are ignored by the charging check.
- Migration `0006`, with a downgrade.

**New tables (migration `0007`, with a downgrade).**

| Table | Fields |
|---|---|
| `advisory_proposal` | `id` uuid PK (server generated), `condition` varchar(40), `dedupe_key` varchar(100), `status` varchar(20), `inputs` jsonb, `source_refs` jsonb, `explanation` text null, `explanation_status` varchar(20), `urgency` varchar(10) null, `suggestion` jsonb null, `rule_version` integer, `prompt_version` integer null, `model_id` varchar(100) null, `created_at`, `updated_at`, `decided_at` timestamptz null |
| `advisory_model_call` | `id` uuid PK, `proposal_id` uuid null FK ON DELETE SET NULL, `called_at` timestamptz, `model_id` varchar(100), `request_text` text, `response_text` text null, `input_tokens` integer null, `output_tokens` integer null, `outcome` varchar(20) |

- `condition IN ('date_vs_km_warranty','date_vs_km_service','charging_cost_drift')`.
- `status IN ('proposed','accepted','dismissed')`. `explanation_status IN ('model','unavailable','disabled','limit_reached','invalid_output')`. `outcome IN ('ok','error','invalid_output')`. `urgency IN ('low','normal','high')`.
- `inputs` holds **exactly** the derived values sent to the model and nothing else (list below). `source_refs` holds local record ids (for example a reminder id) so the screen can link to the record. Ids are never sent to the model.
- Unique index on `dedupe_key` for every row: one proposal per key, ever. A dismissed key is not proposed again until the key changes (see keys below). Row cap: 2,000 proposals.
- `advisory_model_call` keeps the full prompt and reply for audit (owner decision: host logging). It also drives the app's monthly call count: calls with `called_at` in the current Asia/Kuala_Lumpur month, any outcome. Rows older than 13 months are deleted by the check run.
- Neither table stores notes, names, VIN, plate, certificate numbers, GPS, usernames or tokens. Dumps will contain these rows; they hold derived numbers and model text only.

**The two checks (rule code, versioned by `rule_version`).** All dates are Asia/Kuala_Lumpur calendar dates.

1. `date_vs_km_warranty` and `date_vs_km_service`: the date will pass after the km limit is reached.
   - Subjects: a warranty coverage with both `end_date` and `km_limit` that is not expired, and an incomplete `service` reminder with both `due_date` and `due_odometer`.
   - Pace: from service records with `date` in the last 180 days. Needs at least 2 records spanning at least 30 days, else no finding. Pace = (latest odometer − earliest odometer in the window) / days between them. Pace must be above 0.
   - Projected limit date = today + (limit − current odometer) / pace, rounded up to a whole day. If the current odometer is already past the limit the item is already expired or overdue and the check skips it.
   - Finding when the projected limit date is before the date (`end_date` or `due_date`) and within 365 days of today.
   - Key: `condition:subject_id`. A warranty or reminder edited later keeps the same key, so a dismissed finding stays dismissed.
2. `charging_cost_drift`: the latest priced charging session is far from the recent average.
   - Cost per kWh (sen) = `amount_minor * 1000 / energy_wh`, rounded to the nearest sen. Rows without `energy_wh` are ignored.
   - Latest = the newest such expense by `date`, `created_at`, `id`. Recent average = the mean of the 10 such expenses before it (or fewer, at least 5, else no finding), rounded to the nearest sen.
   - Finding when the latest differs from the average by 20% or more, in either direction.
   - Key: `charging_cost_drift:<expense id>`. Each new charging expense can raise at most one proposal.

All thresholds (180, 30, 365, 10, 5, 20%) are named constants, proposed values for the owner to change.

**What leaves the host, per condition (the owner-approved list, nothing more).**

| Condition | Fields sent |
|---|---|
| `date_vs_km_*` | condition name, `km_to_limit`, `days_to_expiry`, `projected_limit_date` |
| `charging_cost_drift` | condition name, `latest_cost_per_kwh_sen`, `average_cost_per_kwh_sen`, `latest_date` |

The pace is **not** sent (it is not on the approved list); the projected date carries the same information. The subject's name is not sent, because names are free text.

**Model call.** One call per new finding, through `ReasoningModel.explain(inputs) -> Explanation`. The model returns only `{ "explanation": "<=500 chars plain text", "urgency": "low|normal|high" }`. **Code, not the model, builds the suggestion** (for example "add or review a reminder" with a title and values from fixed templates), so the model cannot invent a record. Invalid JSON, wrong types or over-length text means `explanation_status = invalid_output` and the finding is stored without an explanation. If the model is off, unreachable, errors, or the monthly call limit is reached, the finding is still stored with `explanation_status` `disabled` or `unavailable` or `limit_reached`. The app works fully with no model.

**Settings (host `infra/.env`, none in the repo):** `ADVISORY_MODEL_ENABLED` (default false), `ANTHROPIC_API_KEY`, `ADVISORY_MODEL_ID`, `ADVISORY_MONTHLY_CALL_LIMIT` (default 60), and the LangSmith switch and key (tracing off by default, ADR-008).

**Web.** Online only in the first build: proposals are not cached offline and decisions are not queued. A new Advisory screen lists proposals with their inputs, explanation and "why" (rule version, model id), and Accept/Dismiss buttons. Accept opens the ordinary create-reminder form prefilled with the suggestion; saving it is a normal `POST /reminders` made by the owner, then the proposal is marked accepted. The service worker is unchanged.

## Offline and sync (proposed, see ADR-002)

- The service worker caches the app shell only. Data lives in IndexedDB, not Cache Storage.
- The client keeps the last successful response per resource in an IndexedDB `cache` store, so cached data is readable on a cold start with no server.
- Writes made offline go into a persistent IndexedDB `queue` with a client-generated UUID, so retries are idempotent. Offline create then edit of the same record is coalesced.
- The queue flushes on app start, the `online` event, `visibilitychange` and a manual button. There is no Background Sync on iOS Safari (unverified), so nothing syncs while the app is closed.
- Flush errors: `401` pauses the queue and asks for the password, `400` and `409` mark the item failed and visible, network errors and `5xx` retry with backoff. A replayed `DELETE` returning `404` counts as success.
- Conflict policy for a single user: last write wins by server timestamp. Revisit if multi-device use grows.
- The server is the source of truth. On iOS Safari, browser storage can be evicted (unverified), so the cache is rebuildable and the UI shows unsynced items.

## Authentication (proposed)

- A single owner password exchanged at `POST /api/v1/auth/token` for a one-hour Bearer token. No refresh token.
- The token is held in JavaScript memory only. It is not written to `localStorage`, IndexedDB or a cookie. After a full relaunch the owner signs in again. The password is never stored.
- Honest limit: memory-only storage reduces token theft but does not stop in-page abuse by XSS. The control is XSS prevention: strict CSP, no third-party scripts, no raw HTML injection.
- A cookie-based session would be safer against XSS but needs an API contract change and CSRF handling. It is not proposed.
- All endpoints except `/health` require a valid token.
- Cached data in IndexedDB is readable without signing in. Accepted or mitigated by an app lock: owner decision.

## Deployment (proposed)

- Docker Compose on a standalone Ubuntu Server (self-hosted homelab hardware, ADR-004) with three services: `db`, `api`, `web` (reverse proxy plus static client). Only `web` publishes a port. `api` and `db` are on the internal network.
- Same-origin serving: no CORS configuration. No wildcard origins.
- The proxy sets CSP, `X-Content-Type-Options`, `Referrer-Policy`, `no-store` for `/api/*`, `no-cache` for `index.html` and `sw.js`, and HSTS once HTTPS exists. The API reads the client address from forwarded headers, trusted only from the proxy, so the auth rate limit still works.
- **HTTPS is required for service workers and offline use on the phone** (service workers need a secure context, unverified here). No HTTPS origin exists yet, because remote access is undecided and no public exposure is allowed (NFR-6). Development and automated tests use `localhost`, which is a secure context.
- Remote access (decided 2026-10-13, ADR-003): Tailscale. `tailscale serve` on the host terminates HTTPS and proxies to the Caddy `web` port, which stays bound to `127.0.0.1` (proposed; sidecar is the alternative). No public port, Funnel off, HSTS off until verified. The real tailnet and host names are never written in this public repo. Until the owner steps are done the phone has no HTTPS origin.
- Client address behind Serve and Caddy is expected to be one constant address, so the login limiter effectively has a single bucket (unverified, to be tested). `FORWARDED_ALLOW_IPS` is unchanged.
- Hostname stability: browser storage and the installed PWA are per origin. Choose the hostname once.
- Scheduled `pg_dump` to a location off the host (external volume, network share, or offsite), with a restore test.

## Integration boundary

Adapters implement interfaces such as `VehicleDataSource`. The MVP ships none. A future adapter must be backed by a `verified` entry in `docs/research/vehicle-integrations.md`.

## Risks

| Risk | Mitigation |
|---|---|
| Homelab downtime (standalone Ubuntu Server, ADR-004) leaves the app without a backend | Offline cache and queue |
| No HTTPS origin until Tailscale is set up (chosen 2026-10-13, ADR-003), so offline cannot be proven on the phone | Test on `localhost` in Playwright; owner completes the Tailscale steps; phone checks are deferred (owner decision 2026-10-22), not gating, and reported as not run |
| Tailscale machine name is public in certificate-transparency logs; Tailnet policy mistakes could expose host services | Neutral names, restrictive policy, Funnel off, checks in ADR-003 |
| iOS Safari may evict browser storage (unverified) | Server is source of truth; show unsynced items; flush promptly |
| No background sync or push on iOS Safari for the MVP | Sync while open; reminders shown in-app only |
| XSS exposes the token and cache | Memory-only token, strict CSP, no third-party scripts, dependency audit |
| Python/TypeScript type drift | Generate types from OpenAPI, CI drift check |
| Data loss | Tested backups |
| Scope creep from agents | Approval gates in `AGENTS.md` |
| Unverified vehicle interfaces | Parallel research, no MVP dependency |

## Open decisions (owner)

1. Approve ADR-002 and choose option (b) Vite PWA or option (a) Expo web.
2. Approve a reverse proxy container (Caddy proposed, nginx acceptable). It is a new component.
3. ~~Choose the HTTPS route and the remote access tool.~~ **Decided 2026-10-13: Tailscale (free Personal plan), Funnel off, nothing public** (ADR-003, accepted by the owner). Still open inside ADR-003: host `tailscale serve` versus sidecar, machine and tailnet names, HSTS on/off, key expiry, account MFA.
4. Accept that cached data is readable without signing in, or request an app lock.
5. Decide whether offline-queue behaviour becomes an acceptance criterion (proposed AC-9).
6. Approve `gitleaks` and Playwright browser downloads as tools.

## Contract notes (no change made)

- The status for a replayed identical `POST` (200 or 201) is unspecified. The client accepts both.
- `PUT /vehicle` does not say whether the client supplies `id`.
- Offline pagination: only pages already fetched are available.
