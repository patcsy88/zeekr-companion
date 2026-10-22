# Reminders slice: verification report, 2026-10-22

Author: Engineering Lead (self-verification, **not** an independent QA pass). Data: disposable only (a throwaway Postgres 17 container and the e2e stack's own throwaway database). Nothing was committed, pushed or deployed.

## Gate results (run and seen)

| Gate | Result |
|---|---|
| `ruff check .` and `ruff format --check .` (services/api) | Pass |
| `mypy app` | Pass (36 files) |
| `pytest` | Pass, 336 tests (1 httpx/starlette deprecation warning) |
| `alembic upgrade head` twice on a new database | Pass (first run applies 0001 and 0002, second run no-op, current `0002 (head)`) |
| `pip-audit` | **Fail**: `certifi 2026.7.22`, PYSEC-2026-4320, fix in `2026.10.19`. Transitive (via httpx, httpcore, requests); not changed by this slice. Open |
| `npm run lint`, `npm run format:check`, `npx tsc --noEmit` (apps/web) | Pass (after fixing one lint error in the new e2e spec) |
| `npm test` | Pass, 162 tests in 15 files |
| `npm run build` | Pass |
| `npm run e2e` | Pass, 28 tests (chromium, chromium-csp, webkit smoke) |
| `npm audit --audit-level=high` | Pass, 0 vulnerabilities |
| `cd packages/shared-types && npm run check:drift` and `typecheck` | Pass |
| `gitleaks detect --no-git --source . --redact` | Pass, no leaks |
| Infra smoke (`infra/smoke.sh`) | Not run (no infra change in this slice) |

One defect was found and fixed during the run: refreshing vehicle, records and reminders in parallel made the guarded refreshes invalidate each other, so the service list stayed on "Loading" in the D1 e2e test. The refreshes now run one after another.

## Acceptance criteria

| AC | Result | Evidence |
|---|---|---|
| AC-10 to AC-14 | Passed | `test_reminders.py`, `reminders.test.tsx` |
| AC-15 | Passed | `reminders.test.tsx` |
| AC-16 | Passed | `test_reminders.py`, `reminders.test.tsx` |
| AC-17 | Passed | 15 shared vectors, run by pytest and Vitest |
| AC-18, AC-19 | Passed | Vitest and Playwright |
| AC-20 to AC-23 | Passed | pytest, Vitest, Playwright |
| AC-24, AC-25 | Passed | Vitest (cold start with API down, reload, exactly once, per-item failure) and Playwright offline create |
| AC-26 | Passed | 401 on every reminder and template route |
| AC-27 | **Partly passed; iPhone check BLOCKED** | Second profile read and reload verified on `localhost`. The installed-app check on iPhone needs the Tailscale HTTPS origin |
| AC-28 | Passed | Vitest and Playwright, title `<img src=x onerror=alert(1)>` shown literally, no dialog, no `<img>` |
| AC-29 | Passed except the `pip-audit` finding above | Migrations and gates |

## Date rule (owner decision 2026-10-22)

Service-record and reminder date checks use the Asia/Kuala_Lumpur date. Updated: `schemas.py` (via `app/clock.py`), `RecordForm.tsx`, `dates.ts` hint, `ErrorBox.tsx` (UTC explanation removed), `default-date.test.tsx`, `qa-task5.test.tsx`, `components.test.tsx`, `slice.spec.ts` and the backend tests.

## Security review pass

- Every reminder and template route sits under the router-level `require_auth`; a test asserts 401 for each.
- Validation is strict (`extra=forbid`, strict integers, strict dates, bounds, NUL rejection) and tested; a client-supplied `status` is rejected.
- The 500-row cap is enforced on create; an identical replay at the cap still returns 200.
- The template endpoint reads static data and writes nothing; a test asserts no row exists after fetching it.
- The web renders all text through React text nodes. A search found no `dangerouslySetInnerHTML`, `innerHTML` or `eval`. The client path allow-list was extended only for `/reminders` and `/reminder-templates`.
- No secrets, VIN, e-mail or host names were added; gitleaks found nothing.

## Open items

1. `pip-audit` reports `certifi` PYSEC-2026-4320. Bump needed (dependency pin decision for the owner or a follow-up task).
2. AC-27 on the iPhone is blocked on the Tailscale HTTPS origin.
3. Independent QA pass of the Reminders slice has not been done.
