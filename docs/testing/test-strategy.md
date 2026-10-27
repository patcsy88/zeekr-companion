# Test Strategy

Status: **proposed**, updated 2026-10-23 for the Expenses slice (accepted by the owner), previously 2026-10-22 for the Reminders slice. Commands are the gates. The initial-slice gates were run independently by QA on commit `3297776` and passed (2026-10-14/15, see `docs/testing/qa-report-2026-10-14.md`). The Reminders slice gates were run by the Engineering Lead on 2026-10-22 (see `docs/testing/qa-report-2026-10-22-reminders.md`); an independent QA pass is still to do. The AC-6, AC-7 and AC-27 iPhone checks and the ADR-003 remote-access checks are deferred and optional (owner decision 2026-10-22): they no longer gate a slice, but they are not passed and are reported as deferred.

## Test layers

| Layer | Tooling | Scope |
|---|---|---|
| Backend unit | pytest | Services and validation |
| Backend integration | pytest + disposable PostgreSQL | Routers, repositories, migrations |
| Web unit and component | Vitest + Testing Library + `fake-indexeddb` + MSW | Components, hooks, cache, sync queue |
| End to end | Playwright against the production build on `localhost` | Slice flows. Chromium for offline tests, WebKit as a rough smoke test only (not iOS Safari) |
| Compose / proxy smoke | shell + curl | Stack starts, `/health` through the proxy, security headers |
| Manual | Physical iPhone, installed PWA | Offline behaviour, install, storage. **Deferred and optional until an HTTPS origin exists (ADR-003); not a gate** |

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
| AC-30, AC-31, AC-32, AC-33 | `services/api/tests/test_expenses.py` and `test_expenses_qa.py` (create, replay 200, conflict 409, validation cases, patch, delete). Web: `apps/web/test/expenses.test.tsx`, `expenses-qa.test.tsx` |
| AC-34 | `expenses.test.tsx` (all categories selectable, readable labels, "Road tax (JPJ)") and `test_expenses.py` (enum) |
| AC-35, AC-36 | `test_expenses.py`, `test_expenses_qa.py` (ordering, cursor paging, filters, invalid cursor and limit, `from` later than `to`). Web filters in `expenses.test.tsx` |
| AC-37 | `test_expenses.py` (summary) and shared vectors `packages/shared-types/test-vectors/expense-totals.json` |
| AC-38 | `expenses.test.tsx` (KL default date, MYR to sen parser, field errors) and `expenses-qa.test.tsx` (parser edge cases) |
| AC-39, AC-40 | `expenses.test.tsx`, `expense-queue.test.ts` (coalescing, delete of an unsent create, exactly once, per-item failure) and Playwright `e2e/expenses.spec.ts` offline flow |
| AC-41 | `expense-totals.test.ts` (same vectors as the server) and `expenses.test.tsx` (partial warning) |
| AC-42 | `test_expenses.py` 401 test for every expense route |
| AC-43 | Playwright `e2e/expenses.spec.ts` (second profile reads from the API, reload). Manual iPhone check: **deferred, not run** |
| AC-44 | `expenses.test.tsx`, `expenses-qa.test.tsx` and Playwright with a script-like note |
| AC-45 | `test_expenses.py` (cap of 5,000, replay accepted at the cap) |
| AC-46 | `test_expenses.py` (no link to service records, service costs not in totals) |
| AC-47 | `test_migrations.py` (migration `0003`) and all gates |

| AC-48, AC-49, AC-50 | `services/api/tests/test_warranty.py`, `test_warranty_qa.py` (replay, conflict, each validation case, "end or km" rule after a patch, cascade delete). Web: `warranty.test.tsx`, `warranty-forms-qa.test.ts` |
| AC-51, AC-52 | Shared vectors `packages/shared-types/test-vectors/warranty-status.json`, run by pytest and by `warranty-status.test.ts`; `warranty-status-qa.test.ts` (boundaries, date math). Backend test that reminders and warranty report the same current odometer |
| AC-53, AC-66 | `warranty.test.tsx`, `warranty-qa.test.tsx` (wording scan, plain-text rendering with a script-like name) |
| AC-54, AC-55, AC-56, AC-57 | `test_warranty.py` (template content, GET creates nothing, future-start extended coverage), `warranty.test.tsx` and `warranty-qa.test.tsx` (suggestion only, baseline required, one POST per selected item, cancel creates none), Playwright `e2e/warranty.spec.ts` |
| AC-58, AC-59, AC-60 | `test_warranty.py`, `test_warranty_qa.py` (parent must exist, validation, `coverage_id` immutable, ordering, no expense side effect) |
| AC-61, AC-62, AC-63 | `warranty-queue.test.ts`, `warranty-queue-qa.test.ts` (coalescing, dependency order, blocked claims, cancel with unsent coverage, exactly once, reload), `warranty.test.tsx`, Playwright offline create of a coverage and a claim |
| AC-64 | `test_warranty.py`, `test_warranty_qa.py` (401 on every warranty route) |
| AC-65 | Playwright `e2e/warranty.spec.ts` (second profile reads from the API). Manual iPhone check: **deferred, not run** |
| AC-67 | Review checklist and a schema test that no provider, certificate or document field exists |
| AC-68 | `test_migrations.py` (migration `0004`: apply, re-run, downgrade) and all gates |

Warranty security review: `docs/security/review-2026-10-23-warranty.md`. SEC-W3 and SEC-W4 fixed (`warranty-sec.test.tsx`); SEC-W1, W2, W5, W6 open.

Warranty independent QA: `docs/testing/qa-report-2026-10-23-warranty-backend.md` and `qa-report-2026-10-23-warranty-web.md`. Open limits: W1 (Info), WW4, WW5, WW6 (Low).

Expenses independent QA: `docs/testing/qa-report-2026-10-22-expenses-backend.md` and `qa-report-2026-10-22-expenses-web.md`. Open limits: E2, E5, W3, W4, W6 (all Low or Info, accepted by the owner on 2026-10-23).

Remote-access checks from ADR-003 (manual, owner holds the iPhone; reports use placeholder names only): HTTPS smoke from the iPhone on cellular; headers present exactly once; rate-limit keying behind Tailscale Serve and Caddy; Tailscale identity headers never reach the API; no public port and Funnel off.

Additional checks from ADR-002: auth rate limit keys on the real client address behind the proxy; security headers and CSP present; the service worker never caches `/api/*`.

Owner account login (ADR-006): `services/api/tests/test_owner_account.py` covers username trimming and case-insensitivity, validation (length, control characters), identical 401 for an unknown username and a wrong password, one scrypt check on the unknown-username path, no username in failure logs, unknown usernames counting towards lockout, the no-account 401 and warning, reset without restart, tokens surviving a reset until expiry, the single-row and username constraints, and `set_owner` (create, reset, bad input, no password in output). Web: three SignIn tests in `components.test.tsx`. E2E: wrong username and wrong password are both refused. `infra/smoke.sh` seeds the account in the real Compose stack. The smoke check "api not reachable from host" is skipped when another process holds port 8000.

Date rule (owner decision 2026-10-22): calendar-date checks use the Asia/Kuala_Lumpur date. Covered by `test_service_records.py`, `default-date.test.tsx`, `qa-task5.test.tsx` and the Playwright default-date test.

## Not yet covered

Performance, backup restore, push notification delivery, and CSP/XSS testing beyond header checks. Accessibility is covered only by `jsx-a11y` lint until a fuller check is added.

## Error reporting (ADR-007)

- API: `services/api/tests/test_observability.py` checks that the scrubber removes fake secrets (password, token, username, amount, plate, host name, local path) and keeps the exception type and frames, that nothing starts without a DSN, and that the SDK is started with privacy-safe options.
- Web: `apps/web/test/observability.test.ts` does the same for the browser scrubber. `test/csp-drift.test.ts` and `infra/smoke.sh` pin the CSP including the `connect-src` allowance.
- Not tested: delivery to a real Sentry project. That needs a DSN and is an owner-run check (see the ADR).
