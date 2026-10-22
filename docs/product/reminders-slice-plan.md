# Reminders slice plan

Status: **approved 2026-10-22**, drafted by the Engineering Lead. Covers FR-7, FR-8 and FR-12. The owner answered Q1 to Q9 and approved the contract ("Reminders" in `docs/architecture/api-contracts.md`) and AC-10 to AC-29 in `docs/product/requirements.md`, including the Asia/Kuala_Lumpur date rule. Implementation may start.

## Task breakdown

Order follows `.opencode/agents/engineering-lead.md`: contract, then implementation in parallel, then independent QA, then security review.

| # | Owner | Task | Inputs | Output / done when |
|---|---|---|---|---|
| 0 | Owner | Answer Q1 to Q6, approve AC-10 to AC-29 and the contract draft | requirements.md, api-contracts.md | Draft marked approved, with the date |
| 1 | Solution Architect | Fold the owner's answers into the contract and data model. Write an ADR only if Q1 changes the vehicle contract. Define the shared overdue test vectors (JSON table) | Owner answers | Contract and architecture updated, vectors file specified |
| 2 | Vehicle Researcher | Re-read the Zeekr Malaysia schedule PDF for odd-checkpoint work items and for what the year count starts from (Q5a, Q5d). Update entry M12 only with verified facts | M12 | Research doc updated, or "not stated" confirmed |
| 3 | Backend Engineer | Model, migration `0002` with downgrade, repository, service (status rule, current odometer read via the service-record repository), router, schemas, the static template endpoint, OpenAPI export | Approved contract | Gates for the backend pass. Migration runs twice on a clean DB |
| 4 | Web Engineer | Types, endpoints, queue kinds and `applySuccess`, cache key, hooks, offline status function using the shared vectors, reminders page (Overdue, Upcoming, Completed filter), create and edit form, delete confirmation, template review screen with explicit accept, offline and pending states | Approved contract, generated types | Gates for the web app pass |
| 5 | QA Engineer | Test plan and tests independent of the implementers, mapped to AC-10 to AC-29 (table below). Runs all gates. Reports blocked iPhone checks as blocked | AC list, contract | QA report with commands and results |
| 6 | Security Engineer | Review: input validation and bounds, `extra=forbid`, 401 on all new routes, plain-text rendering of title and notes (AC-28), the 500-row cap, that the template endpoint cannot create data, dependency audit, no personal data in fixtures or docs | Code and contract | Review note. Findings fixed or accepted by the owner |
| 7 | Engineering Lead | Integrate, inspect the changes, confirm the definition of done, report | All of the above | Final report with evidence |

Tasks 3 and 4 run in parallel once task 1 is done. Task 2 can run in parallel with task 1 and only gates the template content (AC-23).

## Test traceability (proposed additions to `docs/testing/test-strategy.md`)

| Criterion | Verification |
|---|---|
| AC-10, AC-11, AC-12, AC-13, AC-14 | Backend unit and integration tests (including replay and conflict) |
| AC-15, AC-28 | Vitest component tests, one Playwright check with a script-like title |
| AC-16, AC-17 | Shared test vectors run by pytest and Vitest, including boundary cases (equal odometer, due today, unknown odometer, both fields set) |
| AC-18, AC-19 | Vitest component tests and a Playwright flow |
| AC-20, AC-21, AC-22, AC-23 | Backend test for the template endpoint (no rows created), Vitest for the review screen, Playwright: open the template, cancel, assert zero reminders; accept one item, assert one |
| AC-24, AC-25 | Vitest queue and cache tests, Playwright offline create, edit, complete and delete, then reconnect, asserting exactly one record on the server |
| AC-26 | Backend integration test over every new route |
| AC-27 | Playwright with a second browser profile. iPhone check **blocked on HTTPS** |
| AC-29 | Migration gate and all gates |

## Risks and inconsistencies found

1. **Stale current odometer (Q1).** The latest service record may be old, so odometer-based overdue is late. The UI shows the basis to keep this visible.
2. **"Today" differs from the service-record rule (Q3).** The UTC rule was an explicit owner decision, so this is raised, not changed.
3. **FR-12 text says "not part of the initial vertical slice".** That meant the first slice. The owner's 2026-10-22 approval is read as covering it here, to be confirmed (Q6).
4. **The architecture placeholder `reminder` row** had `vehicle_id` and `completed_at`. The draft replaces them. That row was never implemented, so no approved contract changes.
5. **No push or background notification on iOS Safari.** Reminders show in the app only, as the architecture risk table already says. Say so in the UI.
6. **Offline status can differ from the server** until the next sync (device date and cached records).
7. **The M12 PDF says requirements vary.** The template is a suggestion with the caveat shown (AC-20, AC-23).
8. **Doc consistency.** `docs/architecture/api-contracts.md` "Not yet specified" was edited to drop reminders. Nothing else approved was touched.
9. **The test strategy's "Not yet covered" list** already names push notification delivery. It stays out of scope.
