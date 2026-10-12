# ADR-002: Mobile-responsive web client (PWA) instead of a native iOS app

- Status: **Approved by the owner on 2026-10-11**: option (b) Vite PWA; Caddy-or-nginx reverse proxy container; cached data readable without an app lock (rely on the phone lock); AC-9 added to the slice; `gitleaks` and Playwright browser downloads allowed. Still open: HTTPS route and remote-access tool (deferred by the owner).
- Date: 2026-10-11
- Supersedes (in part, once approved): the "Mobile" row of ADR-001. The backend, database, deployment and integration choices in ADR-001 are unchanged.

Labels used below: **confirmed** (owner decision, or a property of this repository), **proposed** (my recommendation), **unverified** (a claim about browser or tool behaviour that I have not checked against a primary source in this session or on the owner's device). Every `unverified` item has a named check in the "Verification plan" section. Do not build on an `unverified` claim without running its check.

## Context

- **confirmed** The owner decided on 2026-10-11 that the client is a mobile-responsive web app, to avoid the Apple Developer fee.
- **confirmed** Backend stays FastAPI + PostgreSQL on Unraid via Docker Compose. Auth is a single owner password. The API contract (`api-contracts.md`) is approved and must not change without flagging it.
- **confirmed** The remote access method is deliberately undecided. NFR-6 forbids exposing the API to the public internet.
- **confirmed** No client code exists yet (`apps/`, `packages/`, `infra/` are empty), so no work is lost by changing the client stack.
- **confirmed** `packages/shared-types` is a types-only package. ADR-001 makes the OpenAPI schema the source for generated types.
- The client must keep NFR-1 (cached data readable offline) and NFR-2 (offline writes queued, visible sync state).

The hard constraint is that browsers only allow service workers in a secure context (HTTPS, or `localhost`) **(unverified here; well-documented web platform rule, check against MDN)**. With no public exposure and no remote-access tool chosen, there is currently no HTTPS origin the iPhone can reach. That shapes everything below.

## Options considered

### (a) Keep Expo/TypeScript, ship Expo web (react-native-web) as a PWA

Pros
- One codebase could later produce a native Android build, which ADR-001 gave as a reason for Expo (**confirmed** that ADR-001 says this).
- Same component model if native is ever wanted.

Cons
- PWA support is not first-class. Expo web does not give a ready service worker or Workbox pipeline in current SDKs, so the service worker and manifest would be hand-written **(unverified; check the current Expo SDK docs)**.
- `expo-secure-store` has no web implementation **(unverified; check Expo docs)**, so the Keychain-based token design in architecture.md is void either way, and storage code needs a web-specific path.
- react-native-web approximates, but is not, the DOM. Forms, focus, scrolling, `<input type=file capture>`, and accessibility need web-specific work. Larger bundle.
- The native-Android benefit is speculative: an Android user can install the same PWA.
- Two test stacks (Jest + RN Testing Library, plus Playwright for web) are needed anyway.

### (b) Separate React + Vite + TypeScript PWA

Pros
- Standard DOM, so semantic HTML, native form controls and accessibility work without a translation layer.
- Mature PWA tooling (`vite-plugin-pwa`, which wraps Workbox) **(unverified; confirm it is maintained at the version we pin)**.
- Fast Vitest integration, plain Testing Library, small static bundle that any web server can serve.
- Simpler dependency tree, so a smaller `npm audit` surface.

Cons
- No native path. Android and iOS both rely on the PWA.
- Any Expo knowledge or tooling configured for ADR-001 is dropped (none exists in the repo).

### Not chosen, for the record
- **Server-rendered pages (FastAPI + Jinja/HTMX):** simplest deployment and no JS token storage, but offline reads and queued writes become awkward. Reconsider only if offline is dropped from the requirements.
- **Native Swift / TestFlight:** needs the Apple Developer account the owner wants to avoid.

## Shared concerns (apply to both options unless stated)

### Reuse of `packages/shared-types`
- **confirmed** It is pure TypeScript types, so it works unchanged in both options. Reuse is not a differentiator. The only thing option (a) would additionally reuse is UI components, and none exist.
- **proposed** Generate it from the FastAPI OpenAPI schema (for example with `openapi-typescript`, an open-source dev dependency) and add a CI check that regenerating produces no diff. This guards the Python/TypeScript drift risk named in ADR-001.
- **proposed** The package must stay free of React, DOM and React Native imports.

### Offline cache and write queue
- **proposed** Two layers with different jobs:
  1. **Service worker** caches the app shell only (HTML, JS, CSS, icons, manifest) with precaching. It must **not** cache `/api/*` responses. API responses carry `Authorization` and personal data and should not live in Cache Storage.
  2. **Application code + IndexedDB** holds data. Stores: `cache` (last successful response per resource key, with `fetched_at`), `queue` (pending writes) and `meta`. A small wrapper such as `idb` is enough.
- **proposed** Queue entry: `{ id (the client UUID, also the record id for creates), method, path, body, created_at, attempts, status: pending | sending | failed, last_error }`.
- **proposed** Idempotency uses the contract as written. `POST /service-records` is idempotent on `id`, `PUT /vehicle` replaces, `PATCH` is safe to repeat. A replayed `DELETE` can return `404`, which the client treats as success.
- **proposed** Flush triggers: app start, `online` event, `visibilitychange` to visible, and a manual "Sync now" button. Background Sync is not available in Safari **(unverified; check caniuse/WebKit status)**, so syncing only while the app is open is the design, not a fallback.
- **proposed** Error handling in the flush: `401` pauses the queue and prompts for the password. `400` marks the item `failed` and shows it to the user. `409` marks it `failed` with a conflict message. Network errors and `5xx` retry with backoff.
- **proposed** Ordering is FIFO. Offline create followed by edit of the same record is coalesced into one `POST`.
- **proposed** Conflict policy stays last write wins (architecture.md).
- UI must show pending, failed and offline states (NFR-2).
- **Contract ambiguities to flag (no change made):**
  1. The status code for a replayed identical `POST` (`200` or `201`) is unspecified. The client will accept both.
  2. Cursor pagination offline: only pages already fetched are cached. Pages that were never loaded are not available offline.
  3. `PUT /vehicle` does not say whether the body `id` is client-supplied. The client will send one it generated and stored.

### Token storage in the browser, and the XSS trade-off
The contract returns `access_token` in the JSON body with `expires_in: 3600`, and requires `Authorization: Bearer`. There is no refresh token. **confirmed**

| Option | Survives reload/relaunch | Readable by XSS | Notes |
|---|---|---|---|
| JS memory only | No | Yes, while the page is live | Smallest exposure window. User re-enters the password after relaunch. A password manager makes that tolerable. |
| `sessionStorage` | Per tab, lost on close | Yes | Little gain over memory for an installed app. |
| `localStorage` / IndexedDB | Yes | Yes, anytime | Convenient. A token that lives one hour makes persistence of little value anyway. |
| `HttpOnly; Secure; SameSite=Strict` cookie | Yes | No (script cannot read it) | Better XSS posture, but **requires a contract change** (the server would set a cookie, and CSRF handling would be needed). Flagged, not proposed for now. |

- **proposed** Keep the Bearer contract. Hold the token in memory only. After a relaunch the user signs in again. Never store the password.
- **proposed** The honest trade-off: any JS-readable store is equally exposed to XSS, and an XSS attacker can also call the API from the page and read the IndexedDB cache. Memory-only limits theft of a reusable token, not in-page abuse. The real defence is preventing XSS: no third-party scripts, no `dangerouslySetInnerHTML`, a strict Content-Security-Policy (`default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'`), no inline scripts, and pinned dependencies with `npm audit`.
- **Owner decision:** the IndexedDB cache is readable without logging in (it must be, for AC-7 on a cold start offline). Anyone with the unlocked phone and the installed app sees cached records. Options: accept it (single owner, rely on the phone lock), or add an app-level lock later.
- Cache and queue hold no token or password. Logout clears memory and, optionally, the cache.

### HTTPS, service workers and install-to-home-screen on iOS Safari
- Service workers need a secure context. **unverified (check MDN)** `http://localhost` qualifies, but `http://192.168.x.x` or `http://unraid.local` does not.
- Consequence **(proposed)**: until the owner has an HTTPS origin reachable from the iPhone, the offline shell cannot be proven on the phone. Development and automated tests run on `localhost`, which is a secure context, so they are not blocked.
- Adding to the Home Screen may work over plain HTTP as a plain web-clip bookmark **(unverified)**, but without a service worker there is no offline shell, and the standalone behaviour is not something to rely on.
- Ways to get an HTTPS origin without public exposure, **all depend on owner choices and none is chosen**:
  1. A remote-access overlay that provides certificates (for example Tailscale's HTTPS feature) **(unverified details)**. This is the remote-access decision already deferred, and it is a new external service needing approval.
  2. A private certificate authority on the LAN, with its root installed and fully trusted on the iPhone through a configuration profile **(unverified procedure on current iOS)**. No new paid service, but manual and fragile.
  3. A real domain name with a DNS-validated public certificate used on a private IP. This needs a domain (cost), so it needs approval.
- **Origin stability matters.** Storage, service workers and the installed app are per-origin. Changing the hostname later gives a fresh empty cache and a new install. Pick the hostname once.
- This ADR does not choose among these. It states that the phone-side AC-6 and AC-7 checks wait on that choice.

### Same-origin serving through a reverse proxy, instead of CORS
- **proposed** Serve the built static client and the API from one origin through a reverse proxy container in Docker Compose: `/api/*` and `/health` go to FastAPI, everything else is static files. No CORS configuration is needed, the browser does not send preflights, and no wildcard origin is ever configured. No change to the API contract (paths stay `/api/v1/...`, and the client uses relative URLs).
- **proposed** Compose services: `db`, `api`, `web` (proxy + static files). Only `web` publishes a port. `api` and `db` stay on the internal Compose network.
- **proposed** The proxy sets `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and HSTS once HTTPS exists. `sw.js` and `index.html` are served `Cache-Control: no-cache`. `/api/*` responses are `no-store`.
- **proposed** The API's auth rate limit must key on the real client address. Behind a proxy it would otherwise see only the proxy address. Configure forwarded headers and trust only the proxy. Add a test.
- Alternative: let FastAPI serve the static files with no proxy container. It is simpler for now but couples frontend and backend deployment and leaves TLS termination undecided. Dev uses the Vite dev server with a proxy to the API, which is also same-origin from the browser's view.
- Product choice (Caddy or nginx; both open source, free): **proposed** Caddy for simpler config, nginx is acceptable. **Owner approval required** because it adds a new container image and component, even though no new paid service is involved.

### iOS Safari PWA limitations
All **unverified** until checked on the owner's iPhone and against WebKit documentation. Design accordingly:
- **Storage eviction.** Safari tabs may purge script-written storage (including IndexedDB) after about seven days without use. Installed home-screen apps are said to be exempt. Quota is limited and `navigator.storage.persist()` support is uncertain. Mitigation: the server is the source of truth, the cache is rebuildable, the queue is the only thing that can be lost. The queue should be flushed promptly, and the UI must show unsynced items. Warn the user not to leave unsynced writes for long.
- **Separate storage.** A site opened in Safari and the same site installed to the Home Screen do not share storage or login. Expect to sign in again after installing.
- **Push.** Web Push on iOS works only for installed Home Screen apps, on recent iOS versions, over HTTPS, after an in-app permission prompt. It also needs a push sender on the backend. **Out of scope for the MVP**: FR-7 and FR-8 show reminders in the app only. If added later it needs its own ADR and owner approval.
- **No Background Sync**, so no sync while the app is closed. See above.
- **Service worker updates** are slower and less visible than a native release. Use a visible "New version available, reload" prompt.
- **Camera and files** (FR-10, later) go through `<input type="file" accept="image/*" capture>`. Large blobs in IndexedDB count against quota. Revisit when attachments are specified.
- Install is manual (Share, then Add to Home Screen). There is no install prompt.

### Test tooling and gates
Option (b), **proposed**:

| Layer | Tooling |
|---|---|
| Unit and component | Vitest + Testing Library (`@testing-library/react`, `jest-dom`, `user-event`), `fake-indexeddb` for the cache and queue, MSW to mock the API |
| End to end | Playwright against the production build (`vite preview` or the Compose stack) on `localhost`. Chromium for the offline tests (`context.setOffline`, service worker control), plus a WebKit project as a rough Safari-engine smoke test. WebKit in Playwright is not iOS Safari, and does not prove standalone PWA behaviour. |
| Manual | Real iPhone, installed PWA. Blocked on HTTPS. |

Option (a) would use Jest (`jest-expo`) + React Native Testing Library, and still need Playwright for the web build.

Gates, **proposed**, run from `apps/web`: `npm run lint` (ESLint with `typescript-eslint`, `react-hooks`, `jsx-a11y`), `npm run format:check` (Prettier), `npx tsc --noEmit` (strict), `npm test` (Vitest), `npm run build`, `npm run e2e` (Playwright), `npm audit --audit-level=high`, and the generated-types drift check. Playwright downloads browser binaries (free, open source). I list it for the owner's awareness, not as a paid dependency.

## Decision (proposed)

**Option (b): React + Vite + TypeScript PWA in `apps/web`**, served same-origin through a reverse proxy container, with the Bearer token held in memory only.

Why: the native-Android reason for Expo is speculative, option (a) gains nothing from shared-types, and it adds a second platform abstraction and a weaker PWA toolchain. A plain web stack gives the best install, offline and test story for a single-owner PWA.

If the owner prefers option (a), everything in "Shared concerns" still applies. The differences are the `apps/mobile` directory, Jest instead of Vitest, a hand-written service worker, and no `expo-secure-store`.

## Consequences

- ADR-001's "Mobile: React Native + Expo" and its Apple Developer open item are superseded once this is approved.
- The Apple Developer enrolment gate is no longer needed. The remote-access gate remains and now also blocks HTTPS on the phone.
- **Offline on the phone cannot be verified until an HTTPS origin exists.** That is a project risk, not a design flaw.
- An installed PWA on iOS is more fragile than a native app (storage, no background sync, no push). The server is the source of truth to limit the damage.
- `apps/mobile` becomes `apps/web` (directory rename).
- No change to `api-contracts.md`. The ambiguities listed above are flagged for the owner, not edited.

## Proposed wording for AC-6 and AC-7 (for `requirements.md` after approval)

- **AC-6** (current: "On the phone, a service record created in the app is still there after restarting the app"):
  > After a service record is created in the web app, it is still listed after a full page reload and after closing and reopening the app (installed to the Home Screen on the owner's iPhone once an HTTPS origin exists), and it is returned by `GET /api/v1/service-records` when read from a different browser profile, which shows it was stored on the server and not only in the browser.
- **AC-7** (current: "With the server stopped, the app still shows previously loaded records and indicates it is offline"):
  > After the web app has been opened once while online, and with the API unreachable (server stopped or the browser offline), reopening the app from a cold start still shows the previously loaded vehicle and service records from the local cache and displays a visible offline indicator.
- **Optional AC-9** (needed to cover NFR-2; **not in the original slice, so it is a scope decision for the owner**):
  > A service record created while offline is shown as pending, and is sent exactly once, with no duplicate, when the API becomes reachable again.
- **AC-8:** replace "mobile and backend" with "web client and backend".
- Verification split: AC-6 and AC-7 are automated in Playwright on `localhost` (secure context). The phone check is a named manual step that is **blocked until the HTTPS decision is made**.

## Verification plan for `unverified` claims

| Claim | Check |
|---|---|
| Service workers require a secure context, and `localhost` counts | MDN, and a Playwright test on `localhost` |
| Add to Home Screen over plain HTTP gives no offline shell | Try on the owner's iPhone against a LAN HTTP URL |
| Storage eviction and the installed-app exemption | WebKit documentation; observe on the device over several days |
| `navigator.storage.persist()` behaviour on iOS | Test on the device |
| Background Sync not available in Safari | caniuse / WebKit status |
| Web Push requirements on iOS | Apple/WebKit documentation, before any push ADR |
| Expo web PWA tooling and `expo-secure-store` on web | Expo SDK docs, only if option (a) is chosen |
| `vite-plugin-pwa` maintenance status | Check the pinned version before scaffolding |
| Private CA or overlay certificate procedure on iOS | Pending the remote-access decision |

## Open items for the owner

See "Decisions the owner must make" in the report that accompanied this ADR. They are repeated in `architecture.md` under "Open decisions".
