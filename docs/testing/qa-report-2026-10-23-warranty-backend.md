# QA report: Warranty backend (FR-6, AC-48 to AC-68), independent pass

Date: 2026-10-23. Scope: backend only, commit f6cfa57 and later (HEAD e73f7ce). The tester did not write the code. Only a test file and this report were added; no application code, migration or existing test was changed. Nothing was committed.

New tests: `services/api/tests/test_warranty_qa.py`. Written from the contract and the ACs, not from the implementation tests. 3 strict xfail cases document 2 defects.

## Verdict

No data-integrity defect and no blocker. Replay/conflict, validation, status rules, ordering, shared odometer, cascade, template content, auth and DB constraints all behave as the contract says. Two defects found, both Low/Info: a `500` when a coverage `PATCH` races a `DELETE`, and OpenAPI patch schemas that advertise `null` for non-nullable fields.

## Commands run (services/api, throwaway container `zc-warqa-pg` on 127.0.0.1:55497)

| Command | Result |
|---|---|
| `.venv/bin/ruff check .` | All checks passed |
| `.venv/bin/ruff format --check .` | 73 files already formatted |
| `.venv/bin/mypy app` | no issues in 45 source files |
| `.venv/bin/pytest -q` (whole suite) | 1610 passed, 6 xfailed, 1 warning (106 s). The 6 xfails are the 3 new ones plus 3 older ones from the Expenses report |
| `alembic upgrade head`, `downgrade 0003` (warranty tables gone, count 0), `upgrade head`, `downgrade base`, `upgrade head` on a fresh database | all succeeded, ends at `0004 (head)`. `test_migrations.py` already checks the two warranty tables and revision 0004 |
| `gitleaks detect --no-git --source . --redact` (repo root) | no leaks found |
| `pip-audit` | No known vulnerabilities found (the local package itself is skipped, not on PyPI) |

The web client, `npm` checks and the OpenAPI drift check were not run (backend scope).

## Findings

| Id | Severity | AC | Description | Reproduction | Status |
|---|---|---|---|---|---|
| QA-W1 | Info | AC-50, AC-60 | OpenAPI `WarrantyCoveragePatch` advertises `null` for `name`, `provider_type`, `start_date`, `verification_status`, and `WarrantyClaimPatch` for `date`, `odometer`, `description`, `status`, `currency`. The API rejects all of these with 400 ("must not be null"). A generated client type lets a caller send null. Same as expenses QA-E5. | `build_schema()["components"]["schemas"]["WarrantyCoveragePatch"]["properties"]["name"]["anyOf"]` contains `{"type": "null"}`. | Open (xfail, 2 cases) |
| QA-W2 | Low | AC-50 | `PATCH /warranty-coverages/{id}` returns `500 internal_error` if the row is deleted between its commit and the response being built. `apply()` commits, then `_view` reads `row.id`, which triggers a reload and raises `ObjectDeletedError`. Window is milliseconds; single-owner use makes it unlikely. Expected: `200` (the patch did commit) or `404`. The claim `PATCH` does not have this problem, and the GET paths do not either (they expunge before use). | Wrap `WarrantyCoverageRepository.apply` to run `DELETE FROM warranty_coverage WHERE id = ...` after it returns, then `PATCH` the coverage: `500`. A real-thread race did not hit it in 5 rounds. Fix idea: read `row.id` before `apply`, or use the `coverage_id` argument in `_view`. | Open (xfail) |

### Observations, not defects

- Unlike the expenses slice, `GET` of a coverage or claim is safe against a concurrent delete, and the list query count is constant (tested with 2 vs 20 coverages with claims, and 2 vs 20 claims).
- `status`, `claim_count`, `expired_by` and `expiring_soon_by` are computed on read; no such columns exist.
- A `today` outside 0001..9999-style extremes such as `0001-01-01` and `9999-12-31` is accepted (reasonable).
- A claim `POST` that replays after its coverage was deleted returns `400` on `coverage_id` (documented in the backend notes; tested).
- Auth runs before validation and 404 on every route. An oversized body is rejected with 400 by the body-limit middleware before auth, same as the other slices.

## What was checked

- 401 on all 11 routes plus 3 invalid-input variants, with no token, empty, `Bearer`, wrong, malformed, wrong scheme, tampered tokens; `WWW-Authenticate`; `Cache-Control: no-store` on 2xx, 4xx, 401, 405 and oversized responses.
- Replay and conflict: every coverage content field (name, provider_type, dates, km_limit, notes, source_kind, verification_status, source_note, template_ref) including null vs value and missing vs value; every claim field including `coverage_id`; missing equals explicit null; blank equals null; replay after patch is 409; delete then recreate; uppercase UUID; bad ids; concurrent identical creates (one 201, rest 200) and conflicting creates (one winner).
- Coverage validation: `km_limit` 0/1/10/10,000,000/10,000,001/2^31, bool, float, string, list, object, NaN, Infinity, 300 digits; dates 1999-12-31, 2000-01-01, 2200-12-31, 2201-01-01, 2026-02-30, 2025-02-29, datetime strings, padded, compact, slashed, non-ASCII digits, numbers and booleans, for both `start_date` and `end_date`; name 1/200/201 characters, whitespace-only, NBSP, emoji counted by characters; NUL at start, middle and end of each text field, as an escape in raw JSON, lone surrogate; notes 5000/5001, source_note 200/201, template_ref 100/101; template_ref requires `source_kind` template; enums with wrong case, padding, null and wrong types; unknown fields (`status`, `claim_count`, `expired_by`, `provider`, `certificate_number`, and others); non-object and oversized bodies; cap 50 with replay, conflict, patch, delete at cap and field errors taking precedence.
- PATCH: immutable and unknown fields (`source_kind`, `template_ref`, `coverage_id`, `id`, `status`, `claim_count`, timestamps) return 400 and leave the row unchanged; null rejected for non-nullable and accepted for nullable fields; end-or-km rule (null one, null both together, null one then the other, set one while nulling the other); end before start by patching only end or only start, equal accepted; start moved past a null end accepted; both dates together; empty body is a no-op; `updated_at` moves and `created_at` does not; validation before 404.
- Status: 90-day boundary (`end - today` of 0, 1, 89 to 90, 91, 92), expired the day after, 5,000 km boundary (14,999, 15,000, 20,000, 20,001), equality never expired, both `expired_by` values, both `expiring_soon_by` values, expired beating not_started, not_started precedence, km-only never expiring by date, date-only ignoring the odometer, unknown odometer skipping km, `today` defaulting to the Kuala Lumpur date (15:59:59 vs 16:00:00 UTC), 13 malformed `today` values on list and get, list and get agreeing.
- List order: expiring_soon, active, not_started, expired; then end_date ascending with nulls last, name, id (11-row case and an id tie case).
- Current odometer: same value in `/reminders` and `/warranty-coverages` with date ties, `created_at` ties (forced equal) resolved by id, a lower odometer on a later date winning, deletion of the latest record falling back, claims (create, patch with huge odometers) never changing it.
- Claims: `coverage_id` missing, malformed, unknown (400 on `coverage_id`), uppercase; delete coverage then GET, PATCH, DELETE of its claim give 404; odometer, cost, description, status, currency, notes, date (KL midnight boundaries for create and patch, 1999-12-31, 2000-01-01, impossible dates, datetime strings, numbers) validation; unknown fields; cap 500 with replay and conflict at cap; claim date outside the coverage dates accepted; PATCH of every status value, null rejected for non-nullable, cost null / 0 / 10^12 / 10^12+1 / -1 / bool / float; `coverage_id` in PATCH is 400 even when unchanged; list ordering with ties; filter by valid, uppercase, unknown and non-UUID id.
- No side effects: claim cost leaves expenses, expense summary, service records and reminders unchanged through create, patch, delete and coverage delete.
- Template: exact content (six items, months and km, research refs, key sets, `enter_manually` only on genuine parts), no price, provider or coverage wording, GET creates nothing and is stable, no write methods (405) and no apply endpoint.
- Stored literally: HTML, script, SQL-like, template-like, bidi, emoji and CRLF strings in every text field.
- OpenAPI: route set, status codes, security, query parameters, schema fields and required sets, `additionalProperties: false`, enum order, bounds, no provider, certificate, document, attachment, VIN or registration field, patch schemas without `coverage_id` and `id`.
- DB without the API: check constraints (template_ref requires template, lengths, date ranges, km range, odometer, cost, currency, status, description), a valid boundary insert, cascade delete at SQL level, the foreign key against orphans and re-parenting.
- Concurrency: claim creates racing a coverage delete leave no orphan and no 500 (6 rounds); get racing delete (coverage and claim); delete with concurrent reads; the 50-coverage cap under 8 parallel creates (exactly 2 succeed from 48).

## What was NOT checked

- The web client, offline queue and shared vectors on the device (AC-61 to AC-63, AC-65, AC-53 wording in the UI), AC-54 screen behaviour, and the iPhone installed-app check (deferred by the owner).
- The AC-55 "no coverage is created by any event" test beyond the server side: there is no server event that creates one, and the tests confirm that template GETs, vehicle and service-record writes do not.
- Behaviour behind the real reverse proxy; load and latency at 500 claims; the shared test vector file beyond what `test_warranty.py` already replays.
- Migration `0004` on a populated database beyond the SQL-level constraint probes.
- Race conditions with real thread timing for QA-W2 (reproduced only by forcing the interleaving).

## Traceability

| AC | Tests in `test_warranty_qa.py` |
|---|---|
| AC-48 | `test_ac48_*` (conflict per field, template_ref, missing vs null, blank, trim, replay, recreate, uppercase id, bad ids, concurrency) |
| AC-49 | `test_ac49_*` (km_limit, dates, name, NUL, lengths, enums, unknown fields, bodies, cap, precedence) |
| AC-50 | `test_ac50_*`, `test_coverage_patch_racing_delete_is_not_500` (xfail QA-W2) |
| AC-51 | `test_ac51_*` (boundaries, precedence, today, malformed today, list order) |
| AC-52 | `test_ac52_*` |
| AC-55, AC-56, AC-57 | `test_ac55_*`, `test_ac56_*`, `test_ac57_*` |
| AC-58 | `test_ac58_*` |
| AC-59 | `test_ac59_*` |
| AC-60 | `test_ac60_*`, `test_claim_patch_racing_delete_is_not_500` |
| AC-64 | `test_ac64_*` |
| AC-66 | `test_ac66_text_round_trips_literally` |
| AC-67 | `test_ac67_*`, `test_ac60_claim_cost_has_no_side_effects` |
| AC-68 | `test_openapi_*`, `test_db_*`, alembic round trip (commands above) |
| Robustness | `test_get_racing_*`, `test_claim_create_racing_*`, `test_cap_holds_under_concurrency_*`, `test_query_count_constant_*`, `test_every_response_kind_is_no_store` |

## Fixes (2026-10-23)

| Id | Status | Change |
|---|---|---|
| QA-W2 | **Fixed** | `WarrantyCoverageRepository.apply` now flushes, refreshes and detaches the row before the commit, so the response no longer reloads the row after a racing delete. The xfail marker was removed and the test passes. |
| QA-W1 | Open (Info) | OpenAPI patch schemas advertise null for non-nullable fields. Accepted, same as Expenses QA-E5. |

After the fix: 1611 passed, 5 expected failures (Expenses E2 twice, E5, and Warranty W1 twice); ruff, format and mypy clean.
