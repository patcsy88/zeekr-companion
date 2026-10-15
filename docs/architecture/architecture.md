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
| Web client (PWA) | `apps/web` (replaces `apps/mobile`, proposed) | UI, routing, IndexedDB cache, offline write queue, in-memory token, service worker for the app shell |
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
| No HTTPS origin until Tailscale is set up (chosen 2026-10-13, ADR-003), so offline cannot be proven on the phone | Test on `localhost` in Playwright; owner completes the Tailscale steps; phone checks stay blocked and are reported as such until run |
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
