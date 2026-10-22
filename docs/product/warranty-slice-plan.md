# Warranty slice plan

Status: **proposed, pending owner approval**, drafted 2026-10-22 by the Engineering Lead. Covers FR-6. Acceptance criteria AC-48 to AC-68 in `docs/product/requirements.md`. Contract: "Warranty (DRAFT)" in `docs/architecture/api-contracts.md`. Data model: "Warranty data model" in `docs/architecture/architecture.md`. Starts after the Expenses slice (`expenses-slice-plan.md`) is accepted. Attachments (FR-10) are out of scope.

Privacy rule for this slice: no personal identifier, certificate number, provider name, VIN or plate goes into code, fixtures, tests or docs. Tests use fictional names and dates. The owner's extended warranty is entered by the owner in the running app as ordinary data; the repository only knows its plan type, price and dates already recorded in research O4.

## Task breakdown

| # | Owner | Task | Inputs | Output / done when |
|---|---|---|---|---|
| 0 | Owner | Answer the blocking questions (Q13 to Q16), approve AC-48 to AC-68 and the Warranty contract draft | requirements.md, api-contracts.md | Draft marked approved, with the date |
| 1 | Solution Architect | Fold in the owner's answers. Define the shared status test vectors (JSON): equal end date, equal km, `not_started`, both limits, only one limit, odometer unknown, 90-day and 5,000-km boundaries, extension coverage in the future beside an expired factory one. Specify the shared current-odometer function | Owner answers | Contract and architecture updated, vectors file specified |
| 2 | Vehicle Researcher | Re-check M8 to M10 wording on the official PDF for the template rows (months and km only, the "genuine replacement parts" row, and whether "first registration or entry into service, whichever is earlier" is stated as the start). Update research only with verified facts. Confirm no private data enters the repo | M8 to M10, O2 to O5 | Research doc updated, or "no change" confirmed |
| 3 | Backend Engineer | Models, migration `0004` with downgrade (both tables, foreign key with cascade), repositories, services (status rule via the shared vectors, claim parent check, caps), extract the current-odometer read into a function shared with reminders (no behaviour change), routers, schemas, static template endpoint, OpenAPI export | Approved contract | Backend gates pass. Migration runs twice on a clean DB. Reminder tests unchanged and green |
| 4 | Web Engineer | Types, endpoints, queue kinds for both entities with the coverage-before-claim dependency and blocked state, cache keys, overlays, hooks, pure `warrantyStatus` with the shared vectors, coverage list and detail (claims listed on the detail page), coverage and claim forms, delete confirmation naming the claim count, template review screen with explicit accept, status wording per AC-53, offline and pending states | Approved contract, generated types | Web gates pass |
| 5 | QA Engineer | Test plan and tests independent of the implementers, mapped to AC-48 to AC-68 (table below). Runs all gates. Reports iPhone checks as deferred | AC list, contract | QA report with commands and results |
| 6 | Security Engineer | Review: validation and bounds, `extra=forbid`, 401 on all routes, plain-text rendering (AC-66), cascade delete behaviour, caps, template endpoint cannot create data, no personal data in fixtures or docs, dependency audit | Code and contract | Review note. Findings fixed or accepted by the owner |
| 7 | Engineering Lead | Integrate, inspect the changes, confirm the definition of done, report | All of the above | Final report with evidence |

Tasks 2 and 1 run in parallel; tasks 3 and 4 run in parallel after task 1. Task 2 gates only the template content (AC-55).

## Test traceability (proposed additions to `docs/testing/test-strategy.md`)

| Criterion | Verification |
|---|---|
| AC-48, AC-49, AC-50 | Backend unit and integration tests (replay, conflict, each validation case, "end or km" rule after a patch, cascade delete). Web form and delete confirmation tests |
| AC-51, AC-52 | Shared vectors `packages/shared-types/test-vectors/warranty-status.json` run by pytest and Vitest, including boundary cases. Test that the reminders and warranty code use the same odometer read |
| AC-53, AC-66 | Vitest wording and plain-text tests, one Playwright check with a script-like name |
| AC-54, AC-55, AC-56 | Backend test of template content against M8 to M10 (and that it has no part lists, price or provider text). Vitest review screen (baseline required, labelled guess, one POST per selected item, cancel creates none). Playwright: open, cancel, assert zero; accept one, assert one with `proposed` label |
| AC-55 (no silent create) | Test that no coverage is created after vehicle save, service record save, app start or opening the screen |
| AC-57 | Fictional-data test: extended coverage starting in the future is `not_started` and the factory coverage status is unchanged |
| AC-58, AC-59, AC-60 | Backend tests (parent must exist, cost null or 0, status enum, `coverage_id` immutable, ordering, delete, no expense side effect) |
| AC-61, AC-62, AC-63 | Vitest cache and queue tests (coalescing, dependency order, blocked claims, cancel with unsent coverage, exactly once). Playwright offline create of a coverage and claim, then reconnect, asserting one of each on the server |
| AC-64 | Backend integration test over every warranty route |
| AC-65 | Playwright with a second browser profile. iPhone check **deferred** |
| AC-67 | Review checklist plus a schema test that no provider, certificate or document field exists |
| AC-68 | `test_migrations.py` (apply, re-run, downgrade) and all gates |

## Risks and inconsistencies found

1. **Km basis.** `km_limit` is compared with the odometer reading, not with km since start. This fits a vehicle that started near zero (research O2, O3) but is not a general rule (Q13). The UI shows the basis and the "odometer unknown" case.
2. **Stale odometer.** Same weakness as reminders Q1: if no recent service record exists, the km condition is late or unknown. Warranty claims do not update the odometer.
3. **Wording risk.** A "covered" or "active" badge could be read as a guarantee. AC-53 fixes the wording and adds a fixed disclaimer. The template carries durations only, with the "requirements vary" caveat (M8 to M10, O5).
4. **Template start date.** M8 says coverage begins at first registration or entry into service, whichever is earlier. The vehicle profile has no registration date, so `purchase_date` is a labelled guess and the owner enters the baseline (Q25).
5. **Genuine replacement parts row (M10)** is "varies by part type", so no numbers are applied (AC-55).
6. **Layers.** The original warranty and the owner's extension are separate coverages. A combined view is not computed, so the app can show one expired and one not started. This is accurate to the entered data but may look odd.
7. **Cascade delete** removes claims with their coverage (Q14); the confirmation names the count. A refuse-until-empty alternative is available.
8. **Offline dependency.** A claim create that references an unsent or failed coverage is the first dependent-write case in the queue; it needs the new blocked state (AC-62). It is the highest implementation risk.
9. **Refactor of approved reminders code.** Sharing the odometer read touches the Reminders service. No contract change; protected by the existing reminder tests.
10. **Privacy.** Certificate numbers and the provider name are deliberately not stored (AC-67). The research doc O4 already names the provider type only. `source_note` is free text (200 characters), so the UI warns against typing identifiers; this cannot be enforced.
11. **Claim cost versus expenses.** `cost_covered_minor` is not an expense and does not change expense totals (AC-60).
12. **Research O8** says only part of the leaflets was read. Template content uses M8 to M10 only.
13. **Doc consistency.** Reminder kinds are fixed by the approved contract, so no automatic warranty-ending reminder is offered (Q24). `api-contracts.md` "Not yet specified" now lists only tyres and attachments.
