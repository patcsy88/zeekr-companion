# Test Strategy

Status: **proposed**, updated 2026-10-11 for the web client (ADR-002). Commands are the intended gates. Backend gates are being run by QA after the backend build; web gates have not been run because `apps/web` does not exist yet.

## Test layers

| Layer | Tooling | Scope |
|---|---|---|
| Backend unit | pytest | Services and validation |
| Backend integration | pytest + disposable PostgreSQL | Routers, repositories, migrations |
| Web unit and component | Vitest + Testing Library + `fake-indexeddb` + MSW | Components, hooks, cache, sync queue |
| End to end | Playwright against the production build on `localhost` | Slice flows. Chromium for offline tests, WebKit as a rough smoke test only (not iOS Safari) |
| Compose / proxy smoke | shell + curl | Stack starts, `/health` through the proxy, security headers |
| Manual | Physical iPhone, installed PWA | Offline behaviour, install, storage. **Blocked until an HTTPS origin exists** |

## Quality gates

Run from the repository root.

| Gate | Command |
|---|---|
| Backend format and lint | `cd services/api && ruff check . && ruff format --check .` |
| Backend types | `cd services/api && mypy app` |
| Backend tests | `cd services/api && pytest` |
| Migrations on a clean DB | `cd services/api && alembic upgrade head` against a new test database, run twice |
| Backend dependency audit | `cd services/api && pip-audit` |
| Web lint | `cd apps/web && npm run lint` (ESLint: typescript-eslint, react-hooks, jsx-a11y) |
| Web format | `cd apps/web && npm run format:check` |
| Web types | `cd apps/web && npx tsc --noEmit` (strict) |
| Web tests | `cd apps/web && npm test` |
| Web build | `cd apps/web && npm run build` |
| Web end to end | `cd apps/web && npm run e2e` |
| Web dependency audit | `cd apps/web && npm audit --audit-level=high` |
| Shared types drift | Regenerate from the OpenAPI schema and fail on any diff |
| Secret scan | `gitleaks detect --no-git --source . --redact` from the repo root (approved by the owner 2026-10-11; `brew install gitleaks`). Config: `.gitleaks.toml`, which allowlists only named test-only fixtures. Never scan `zeekr-private-docs`. Run with git history too once the first commit exists. |

A failed gate blocks completion. Gates are never skipped to obtain a pass. A gate that cannot run is reported as not run, with the reason.

## Rules

- Tests use disposable data and a disposable database. They never touch real records.
- Each acceptance criterion in `docs/product/requirements.md` maps to at least one test or a named manual check.
- Bugs get a regression test before the fix.
- The same agent does not both implement and sign off a feature. The QA agent verifies.

## Traceability for the slice

| Criterion | Verification |
|---|---|
| AC-1 | Compose smoke test |
| AC-2 | Migration gate |
| AC-3 | Backend integration test |
| AC-4 | Backend integration test |
| AC-5 | Backend unit and integration tests |
| AC-6 | Playwright on `localhost` (reload, reopen, second browser profile reads from API). Manual iPhone check: **blocked on HTTPS** |
| AC-7 | Vitest cache test and Playwright cold start with the API stopped. Manual iPhone check: **blocked on HTTPS** |
| AC-8 | All gates |
| AC-9 | Vitest queue tests and Playwright offline create then reconnect, asserting exactly one record on the server |

Additional checks from ADR-002: auth rate limit keys on the real client address behind the proxy; security headers and CSP present; the service worker never caches `/api/*`.

## Not yet covered

Performance, backup restore, push notification delivery, and CSP/XSS testing beyond header checks. Accessibility is covered only by `jsx-a11y` lint until a fuller check is added.
