# Expenses slice plan

Status: **approved by the owner 2026-10-22**, drafted 2026-10-22 by the Engineering Lead. Covers FR-5. Acceptance criteria AC-30 to AC-47 in `docs/product/requirements.md`. Contract: "Expenses" in `docs/architecture/api-contracts.md`. Data model: "Expenses data model" in `docs/architecture/architecture.md`. Built first; the Warranty slice (`warranty-slice-plan.md`) starts after this slice is accepted. Attachments (FR-10) and CSV export are out of scope.

## Task breakdown

Order follows `.opencode/agents/engineering-lead.md`: contract, then implementation in parallel, then independent QA, then security review.

| # | Owner | Task | Inputs | Output / done when |
|---|---|---|---|---|
| 0 | Owner | Answer the blocking questions (Q10 to Q16), approve AC-30 to AC-47 and the Expenses contract draft | requirements.md, api-contracts.md | Draft marked approved, with the date |
| 1 | Solution Architect | Fold the owner's answers into the contract and data model. Define the shared totals test vectors (JSON table: empty, one month, several months and categories, month boundary dates such as 2026-01-31 and 2026-02-01, amounts near the 10^12 bound, filters) | Owner answers | Contract and architecture updated, vectors file specified |
| 2 | Backend Engineer | Model, migration `0003` with downgrade, repository (insert-if-absent, keyset list with filters, grouped summary), service (idempotency, 5,000 cap), router with `summary` registered before `/{id}`, schemas reusing `Money`-style strict ints and `today_kl`, OpenAPI export | Approved contract | Backend gates pass. Migration runs twice on a clean DB |
| 3 | Web Engineer | Types, endpoints, queue kinds and `applySuccess`, cache key, pending overlay, hooks, expenses page (list, category and date filters, "This month" and "This year" quick filters, totals by category and by month), create and edit form (default date from `klToday`, MYR parser), delete confirmation, offline and pending states, partial-cache warning, pure `expenseTotals` | Approved contract, generated types | Web gates pass |
| 4 | QA Engineer | Test plan and tests independent of the implementers, mapped to AC-30 to AC-47 (table below). Runs all gates. Reports iPhone checks as deferred | AC list, contract | QA report with commands and results |
| 5 | Security Engineer | Review: validation and bounds, `extra=forbid`, 401 on all routes including `summary`, plain-text rendering (AC-44), query parameter handling, the 5,000-row cap, dependency audit, no personal data in fixtures or docs | Code and contract | Review note. Findings fixed or accepted by the owner |
| 6 | Engineering Lead | Integrate, inspect the changes, confirm the definition of done, report | All of the above | Final report with evidence |

Tasks 2 and 3 run in parallel once task 1 is done. Docs updates (`test-strategy.md` traceability) land with the code.

## Test traceability (proposed additions to `docs/testing/test-strategy.md`)

| Criterion | Verification |
|---|---|
| AC-30, AC-31, AC-32, AC-33 | Backend unit and integration tests (replay 200, conflict 409, each validation case, patch nulls, delete then 404, zero and negative amounts, future date in Asia/Kuala_Lumpur around 00:00 to 08:00 UTC) |
| AC-34 | Backend test over every enum value and an unknown one. Vitest check of labels |
| AC-35, AC-36 | Backend tests for ordering, cursor paging and filters (category, `from`, `to`, `from > to`, bad cursor). Vitest list and filter tests |
| AC-37 | Backend summary tests with the shared vectors, and a check that summary equals the sum of list rows. Never-stored check (no summary column) |
| AC-38 | Vitest form tests (default date, MYR to sen parsing, server field error shown) |
| AC-39, AC-40 | Vitest cache and queue tests (coalescing, exactly once, per-item failure). Playwright offline create, edit and delete, then reconnect, asserting exactly one record on the server |
| AC-41 | Shared vectors run by pytest and Vitest. Vitest partial-cache warning test |
| AC-42 | Backend integration test over every expense route |
| AC-43 | Playwright with a second browser profile. iPhone check **deferred** |
| AC-44 | Vitest and Playwright with the notes `<img src=x onerror=alert(1)>` |
| AC-45 | Backend cap test (lower the cap by setting or seed rows in a disposable DB), including replay at the cap |
| AC-46 | Backend test that expense and service-record tables are independent. Web test that totals exclude service costs |
| AC-47 | `test_migrations.py` (apply, re-run, downgrade) and all gates |

## Risks and inconsistencies found

1. **Double counting with service records.** A service invoice also has a cost. Proposal Q10 keeps them separate and says so on the page; an owner who logs a service in both places will count it twice. An optional link later is additive.
2. **Insurance and road tax overlap with reminders.** Reminders carry the due date, expenses carry the payment. No automatic link is made.
3. **Positive-only amount (Q12)** differs from service records (cost 0 allowed). Refunds are not modelled.
4. **Offline totals and paging.** Totals need all rows. The cache holds only fetched pages, so the page shows a partial warning instead of a wrong total (AC-41). The 5,000 cap keeps a full fetch practical.
5. **Number range.** 5,000 rows x 10^12 sen = 5 x 10^15, under JavaScript's safe integer limit (about 9 x 10^15). The cap and the bound must move together.
6. **Month grouping uses the stored date as-is**, so no time zone drift. Dates are Asia/Kuala_Lumpur calendar dates by rule.
7. **Category list is a guess for a Malaysian EV owner.** An enum change needs a migration and a contract amendment (Q11). `other` plus notes is the escape.
8. **Route order.** `/expenses/summary` must be registered before `/{id}` or it is parsed as a bad UUID (400).
9. **Doc consistency.** The architecture placeholder `expense` row had `vehicle_id`; the draft drops it. It was never implemented. `api-contracts.md` "Not yet specified" was edited to drop expenses and warranty. Approved parts are untouched.
10. **No CSV export** (Q17); users may expect one. Backlog.
