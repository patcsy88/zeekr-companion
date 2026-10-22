# QA report: Expenses backend (FR-5, AC-30 to AC-47), independent pass

Date: 2026-10-22. Scope: backend only, commit 8070cbe and later. Author of the code was not the tester.
Tests: `services/api/tests/test_expenses_qa.py` (new, 180 cases: 170 pass, 10 strict xfail cases documenting 5 defects). No application code or existing test was changed.

## Verdict

No blocker. The contract is implemented faithfully for every happy path and for nearly all validation paths. Five defects found, none affecting data integrity: one reachable 500 on a tampered cursor (Medium), one race-condition 500 plus N+1 queries (Low), and three Low/Info contract-polish items.

## Defects

| Id | Severity | Summary |
|---|---|---|
| QA-E1 | Medium | A syntactically valid cursor whose `i` is a JSON number, list, object, float or bool returns `500 internal_error` instead of `400 validation_error` (AC-35). |
| QA-E2 | Low | `ExpenseRepository.get/list_page` call `session.rollback()` after loading, which expires the ORM objects. Serialising then lazily reloads each row (N+1: a 20-row list issues 21 SELECTs, a GET issues many) and a row deleted between load and serialise raises `ObjectDeletedError` and returns `500` rather than 200/404. Window is milliseconds; single-owner use makes it unlikely. |
| QA-E3 | Low | Whitespace-only `notes` (`"   "`) is trimmed to `""` and stored as the empty string, not `null`. `""` and `null` become two "no notes" states, and replaying a create with `null` after `""` is a `409`. Contract is silent; AC-31 says "trim" only. Recommend normalising `""` to `null` in the contract and code, or documenting the current behaviour. |
| QA-E4 | Low | `limit=1.0` and `limit=" 5"` are accepted (lax int parsing of query strings). Contract: `limit` is an integer 1 to 100. Harmless, but a stricter client may rely on a 400. |
| QA-E5 | Info | OpenAPI `ExpensePatch` advertises `null` for `date`, `category`, `amount_minor`, `currency`, which the API rejects with 400 ("must not be null"). The generated TypeScript type therefore lets a client send null. Contract says only `notes` may be null. |

### Repro

- QA-E1: `GET /api/v1/expenses?cursor=<base64url of {"d":"2026-01-01","c":"2026-01-01T00:00:00+00:00","i":5}>` with a valid token returns 500. Cause: `decode_cursor` catches `ValueError, KeyError, TypeError, binascii.Error` but `uuid.UUID(5)` raises `AttributeError` (and for list/dict/float likewise). It needs the owner token, so exposure is low, but it is a documented contract case (invalid cursor is 400). The shared `decode_cursor` is also used by service records (not tested here, same defect expected).
- QA-E2: add an `sqlalchemy before_cursor_execute` listener, create 20 expenses, `GET /expenses?limit=20`: 21 statements. Wrap `ExpenseRepository.get` to delete the row after it returns: response is 500 (`ObjectDeletedError` inside `ExpenseOut.model_validate`).
- QA-E3: `POST` with `"notes": "   "` returns `"notes": ""`.
- QA-E4: `GET /expenses?limit=1.0` returns 200.
- QA-E5: `build_schema()["components"]["schemas"]["ExpensePatch"]["properties"]["amount_minor"]["anyOf"]` contains `{"type": "null"}`.

## Observations, not defects (no test, or passing test)

- `GET /api/v1/expenses/` (trailing slash) returns `307` to `http://<host>/api/v1/expenses`, before authentication, also for unauthenticated callers. Behind a TLS-terminating proxy the Location scheme could be wrong. Applies to all routers (framework default); not expenses-specific. Low.
- A `date` filter outside 2000-01-01..today (e.g. `from=1900-01-01`, `to=9999-12-31`) is accepted and returns the matching rows. Reasonable.
- Repeated `category` params: FastAPI takes the last value; no error. Test accepts 200 or 400 but not OR semantics.
- `Authorization: bearer <token>` (lowercase scheme) is accepted (RFC-correct).
- Auth runs before validation and before 404 for every route (including bad UUID, bad filters, oversized body is 400 from the body-limit middleware before auth: same as other slices).

## What was checked (all pass unless listed above)

- 401 variants (none, empty, `Bearer`, `Bearer `, wrong scheme, forged and tampered tokens) on all six routes, with the validation-failing inputs that must not leak past auth; `WWW-Authenticate: Bearer`; `no-store` on 2xx, 4xx, 5xx-path, 405, 401 and oversized-body responses.
- Create: 201/200/409, replay equality after trim, replay after PATCH is 409, delete then recreate the same id, uppercase UUID normalised, bad id forms, concurrent same-content and conflicting creates (exactly one 201), PATCH racing DELETE never 500.
- Amount: 1 and 10^12 round trip, 10^12+1, raw JSON `1e3`, `1000.0`, `true`, `"1"`, `[1]`, `{}`, `null`, `-0`, `NaN`, `Infinity`, 300-digit integer.
- Date: KL midnight boundary at 15:59:59 and 16:00:00 UTC (also year end and 29 February), PATCH uses the same rule, 2000-01-01 accepted, 1999-12-31, 0001-01-01, 0000-01-01, non-padded and slash forms, datetime strings.
- Notes: emoji and combining characters, 5000 emoji accepted and 5001 rejected, trimming, interior whitespace, `""`, `null`, NUL, lone surrogate, injection-like and template-like strings stored verbatim.
- PATCH: unknown and immutable fields (`id`, `created_at`, `updated_at`, wrong-case key), non-object bodies, identical values, validation before 404, `updated_at` moves and `created_at` does not.
- List: ordering with identical dates, amounts and `created_at` (id tie-break), cursor paging without loss or duplicate over 23 rows, cursor row deleted, cursor reused with other filters, many tampered cursors (non-JSON, wrong types, naive timestamps, missing keys, non-ASCII, NUL), empty cursor, `limit` 0, 101, negative, text, empty, `1e1`, `2.5`, Arabic-Indic digit.
- Filters: invalid category (case, whitespace, empty, SQL-like, NUL), invalid dates (13th month, 30 Feb, compact, datetime, leading space, Arabic-Indic digits, SQL-like), `from > to` names `from`, `from == to` accepted, all errors reported together, applied identically to `summary`.
- Summary: exact key set, category order (total desc, name asc) and month order (desc), cross-year months, all 11 categories, filters equal list rows, recalculation after PATCH and DELETE, paging params ignored, all 10 cases of `packages/shared-types/test-vectors/expense-totals.json` replayed against the server (AC-41 server half).
- Cap: 5000 reached, rejected on field `body`, replay `200`, conflict `409`, PATCH and DELETE at cap, delete frees a slot, field errors take precedence over the cap error.
- DB constraints (date >= 2000-01-01, amount 1..10^12, currency MYR) enforced without the API.
- OpenAPI: route set, status codes per route, security, request and response required fields, `extra=forbid`, enum order equals the contract, query parameter names/bounds/default.
- Error body shape `{error:{code,message,details[{field,issue}]}}` for 400, 401, 404, 405, 409.

## What was NOT checked

- The web client, offline queue, shared-vector use on the device, AC-38 to AC-41, AC-43 (cross-browser), AC-44 (rendering), and anything under `apps/web` (instructed: no npm, vitest or playwright).
- Migration `0003` up/down on a populated database beyond the DB-constraint probes (existing `test_migrations.py` covers empty up/down/re-run).
- Behaviour behind the real reverse proxy (TLS, proxy header trust, trailing-slash redirects with a real `Host`).
- Performance and load (only the query count of a 20-row list); the 5000-row list/summary latency.
- Service-record cursor handling (QA-E1 likely also affects `/service-records`, not tested because out of scope).
- Server clock manipulation other than monkeypatching `schemas.today_kl`; DST is not applicable (KL is UTC+8).
- AC-46 beyond the existing independence tests; no link field was searched for in the web client.
- The OpenAPI drift check (`npm run check:drift`, not run by instruction), generated `api.d.ts` content.
- Security review (token lifetime, rate limits) beyond the 401 matrix.

## Commands run (services/api, throwaway container `zc-qae-pg` on 127.0.0.1:55499)

- `.venv/bin/ruff check .`: All checks passed
- `.venv/bin/ruff format --check .`: 64 files already formatted
- `.venv/bin/mypy app`: no issues in 39 source files
- `.venv/bin/pytest -q`: 796 passed, 10 xfailed (the 10 are QA-E1 x5, QA-E2 x2, QA-E3, QA-E4, QA-E5)
