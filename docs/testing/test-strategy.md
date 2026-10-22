# Test Strategy

Status: **proposed**, updated 2026-10-22 for the Reminders slice. Commands are the gates. The initial-slice gates were run independently by QA on commit `3297776` and passed (2026-10-14/15, see `docs/testing/qa-report-2026-10-14.md`). The Reminders slice gates were run by the Engineering Lead on 2026-10-22 (see `docs/testing/qa-report-2026-10-22-reminders.md`); an independent QA pass is still to do. The AC-6, AC-7 and AC-27 iPhone checks and the ADR-003 remote-access checks are blocked until the owner sets up the Tailscale HTTPS origin.

## Test layers

| Layer | Tooling | Scope |
|---|---|---|
| Backend unit | pytest | Services and validation |
| Backend integration | pytest + disposable PostgreSQL | Routers, repositories, migrations |
| Web unit and component | Vitest + Testing Library + `fake-indexeddb` + MSW | Components, hooks, cache, sync queue |
| End to end | Playwright against the production build on `localhost` | Slice flows. Chromium for offline tests, WebKit as a rough smoke test only (not iOS Safari) |
| Compose / proxy smoke | shell + curl | Stack starts, `/health` through the proxy, security headers |
| Manual | Physical iPhone, installed PWA | Offline behaviour, install, storage. **Blocked until the Tailscale HTTPS origin is set up (ADR-003)** |

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
| AC-10, AC-11, AC-12, AC-13, AC-14 | `services/api/tests/test_reminders.py` (create, replay 200, conflict 409, both-due-fields rule, validation cases, patch, delete). Web: `apps/web/test/reminders.test.tsx` |
| AC-15 | `reminders.test.tsx` (kinds, "Road tax (JPJ)" label, no due odometer for non-service kinds) |
| AC-16 | `test_reminders.py` (current odometer and its basis) and `reminders.test.tsx` (basis shown next to odometer reminders) |
| AC-17 | Shared vectors `packages/shared-types/test-vectors/reminder-status.json`, run by `test_reminders.py` and `apps/web/test/reminder-status.test.ts` |
| AC-18, AC-19 | `reminders.test.tsx` and Playwright `e2e/reminders.spec.ts` (groups, Completed filter, complete, reopen) |
| AC-20, AC-21, AC-22, AC-23 | `test_reminders.py` (template content, GET creates nothing), `reminders.test.tsx` (cancel and app start create nothing, preselect, baseline required, one POST per selected item), Playwright template test |
| AC-24, AC-25 | `reminders.test.tsx`, `reminder-queue.test.ts` (coalescing, exactly once, per-item failure) and Playwright offline create |
| AC-26 | `test_reminders.py` 401 test for every reminder and template route |
| AC-27 | Playwright (second profile reads from the API, reload). Manual iPhone check: **blocked on HTTPS** |
| AC-28 | `reminders.test.tsx` and Playwright with the title `<img src=x onerror=alert(1)>` |
| AC-29 | `test_migrations.py` (apply, re-run, downgrade) and all gates |

Remote-access checks from ADR-003 (manual, owner holds the iPhone; reports use placeholder names only): HTTPS smoke from the iPhone on cellular; headers present exactly once; rate-limit keying behind Tailscale Serve and Caddy; Tailscale identity headers never reach the API; no public port and Funnel off.

Additional checks from ADR-002: auth rate limit keys on the real client address behind the proxy; security headers and CSP present; the service worker never caches `/api/*`.

Date rule (owner decision 2026-10-22): calendar-date checks use the Asia/Kuala_Lumpur date. Covered by `test_service_records.py`, `default-date.test.tsx`, `qa-task5.test.tsx` and the Playwright default-date test.

## Not yet covered

Performance, backup restore, push notification delivery, and CSP/XSS testing beyond header checks. Accessibility is covered only by `jsx-a11y` lint until a fuller check is added.
