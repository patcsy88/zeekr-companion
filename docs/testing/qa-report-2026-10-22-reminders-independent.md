# QA report: Reminders slice, second pass (2026-10-22)

Commit under test: `adb55a5` plus `608c1fc` (certifi pin). Written after two QA-agent runs timed out; the agent's test file was kept, and the gates were re-run by the Engineering Lead's assistant. **Limits of this pass:** the contract-versus-code line-by-line review was not completed. The web QA tests, e2e run and migration check were added afterwards (see "Follow-up pass").

## Gates run in this pass

| Gate | Result |
|---|---|
| `ruff check .`, `ruff format --check .` (services/api) | Pass |
| `mypy app` | Pass |
| `pytest -q` (disposable Postgres 17) | Pass: 470 passed, 3 expected failures (defects below) |
| `pip-audit` | Pass: no known vulnerabilities (after certifi bump) |
| `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` (apps/web) | Pass (162 tests) |
| shared-types `check:drift` | Pass |
| Playwright e2e, `alembic upgrade head` twice, `infra/smoke.sh` | Not run in this pass |
| iPhone checks (AC-6, AC-7, AC-27) | Deferred, not run (owner decision 2026-10-22) |

## Defects

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| QA-D1 | Minor (single user), **fixed** | The 500-reminder cap is check-then-insert, not atomic. 40 concurrent creates from 490 rows can exceed 500. | `test_cap_500_is_not_exceeded_by_concurrent_creates` (strict xfail) |
| QA-D2 | Minor, **fixed** | A datetime string such as `2026-10-21T00:00:00` is accepted as a date, on create and as the `today` query parameter. The contract says `YYYY-MM-DD`. | `test_nonstandard_date_strings_probe[override1]`, `test_today_param_malformed[2026-10-21T00:00:00]` (strict xfail) |

The tests are marked strict `xfail`, so they fail the suite once the defects are fixed and the marks must be removed. No application source was changed.

## What the new backend tests cover (134 passing)

Midnight boundary at UTC+8, overdue equality, clearing both due fields, kind change with a due odometer, the 500-row cap sequentially, idempotent replay 200/409, same-id concurrent create exactly once, extra and malformed fields, title bounds, 401 on the new routes, and the template endpoint creating nothing.

## Traceability

AC-10 to AC-26, AC-28, AC-29: verified by the Lead's tests plus this pass on the backend. Web behaviour for these (offline queue, template screen, plain-text rendering) is verified only by the Lead's web tests. AC-27: server storage verified on `localhost`; iPhone check deferred.

## Fixes

QA-D1 and QA-D2 were fixed afterwards. The reminder count check and insert now share one transaction under a Postgres advisory lock, and dates must match `YYYY-MM-DD` exactly (body and the `today` query parameter). The three expected-failure marks were removed, and the suite passes: 473 passed, plus ruff, format, mypy and the shared-types drift check. Web unit tests still 162 passed.

## Follow-up pass: web QA, e2e and migrations

| Check | Result |
|---|---|
| New web QA tests `apps/web/test/reminders-qa.test.tsx` | 15 passed. Cover the Kuala Lumpur day rollover at 16:00 UTC and a year end, status edges (due today, exact odometer, one day or km past, unknown odometer, completed), `daysBetween` leap days, "due soon" limits, queue edge cases (duplicate create, create-edit-delete-create), form refusals (whitespace title, negative, fractional and over-limit odometer) and template accept with nothing selected |
| Test sensitivity | Changing `>` to `>=` in `reminderStatus.ts` made 4 tests fail (new and old); the file was restored and `git diff` showed no source change |
| Lint, prettier, tsc on the new file | Pass |
| `npm run e2e` (Playwright, production build, real API, throwaway Postgres) | 28 passed, exit 0, no leftover containers |
| `alembic upgrade head` twice, then downgrade to 0001 and upgrade again | Pass: head `0002` each time (throwaway Postgres, removed) |

Still not done: the line-by-line contract review, and any check on a real iPhone (deferred by the owner).
