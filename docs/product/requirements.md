# Requirements

Status: **confirmed**, **proposed** or **unverified**. Each requirement has an ID so tests can trace to it.

## Functional requirements: MVP

| ID | Requirement | Status |
|---|---|---|
| FR-1 | Create, view, edit the vehicle profile: model, variant, drive (AWD), steering side (RHD), registration, VIN, purchase date, purchase price, tyre specification | proposed |
| FR-2 | Record a service: date, odometer, provider, description, cost, notes | proposed |
| FR-3 | List service history, newest first, and view one record | proposed |
| FR-4 | Edit and delete a service record, with confirmation before delete | proposed |
| FR-5 | Record an expense: date, category, amount, notes | proposed |
| FR-6 | Record warranty details and warranty claims | proposed |
| FR-7 | Create reminders (service, insurance renewal, road tax renewal) with a due date or due odometer (km). Malaysian context: road tax is administered by JPJ. | proposed |
| FR-8 | Show upcoming and overdue reminders | proposed |
| FR-9 | Record tyre changes and rotations | proposed |
| FR-10 | Attach a photo or document to a service record or expense | proposed |
| FR-11 | Authenticate before any data is accessible | proposed |
| FR-12 | Offer the official AWD Performance service schedule (every 20,000 km or 1 year, whichever comes first; research M12) as a suggested reminder template. The owner reviews, edits and explicitly accepts it before any reminder is created. It is never applied silently. Not part of the initial vertical slice. Included in the Reminders slice (owner approved the slice 2026-10-22; see AC-10 to AC-29). | proposed |

## Non-functional requirements

| ID | Requirement | Status |
|---|---|---|
| NFR-1 | Cached data stays readable when the server is unreachable | proposed |
| NFR-2 | Offline writes are queued and synced when connectivity returns, with visible sync state | proposed |
| NFR-3 | No secrets or personal identifiers in source control | confirmed |
| NFR-4 | All schema changes use migrations | confirmed |
| NFR-5 | Backend can be backed up and restored, and a restore has been tested | proposed |
| NFR-6 | The API is not exposed directly to the public internet | proposed |
| NFR-7 | Money stored as integer minor units, timestamps in UTC | proposed |

## Constraints

- No vehicle integration is required for any MVP requirement.
- No undocumented Zeekr API is used.
- No vehicle control capability.

## Acceptance criteria: initial vertical slice

The slice covers FR-1, FR-2, FR-3 and FR-11.

| ID | Criterion |
|---|---|
| AC-1 | `docker compose up` starts PostgreSQL and the API, and `GET /health` returns 200 |
| AC-2 | Migrations apply cleanly to an empty database and can be re-run without error |
| AC-3 | An unauthenticated request to any data endpoint returns 401 |
| AC-4 | A vehicle can be created, then retrieved, with the same values |
| AC-5 | A service record with a negative cost or a missing date is rejected with a validation error |
| AC-6 | After a service record is created in the web app, it is still listed after a full page reload and after closing and reopening the app (installed to the Home Screen on the owner's iPhone once an HTTPS origin exists). It is also returned by `GET /api/v1/service-records` from a different browser profile, which shows it is stored on the server. |
| AC-7 | After the web app has been opened once while online, and with the API unreachable, reopening it from a cold start still shows the previously loaded vehicle and service records from the local cache, with a visible offline indicator. |
| AC-8 | Lint, type checks and tests pass for both the web client and the backend |
| AC-9 | A service record created while offline is shown as pending, and is sent exactly once, with no duplicate, when the API becomes reachable again (covers NFR-2). Added by the owner 2026-10-11. |

## Acceptance criteria: Reminders slice (approved 2026-10-22)

Status: **approved by the owner 2026-10-22**. It covers FR-7, FR-8 and FR-12. The contract is "Reminders" in `docs/architecture/api-contracts.md`. Items marked "(proposal)" were settled by the owner's answers to the questions below. Field names: `due_date`, `due_odometer` (km), `completed_on`, as in the draft contract.

| ID | Criterion |
|---|---|
| AC-10 | A reminder can be created with `kind` (`service`, `insurance_renewal` or `road_tax_renewal`), a title, and a due date only, a due odometer (km) only, or both. `GET /api/v1/reminders/{id}` then returns the same values. A replay of the same `POST` (same `id`, same content) returns `200` with the existing reminder and creates no second row; the same `id` with different content returns `409 conflict`. |
| AC-11 | A reminder with neither `due_date` nor `due_odometer` is rejected with `400 validation_error`, and the detail names the missing due fields. A `PATCH` that would leave neither field set is rejected the same way, and the reminder is unchanged. |
| AC-12 | Validation returns `400 validation_error` for: negative `due_odometer`; `due_odometer` above 10,000,000; a non-integer `due_odometer` (for example `1.5` or `"100"`); an unknown `kind`; a malformed date; an empty or whitespace-only title, or one over 200 characters; notes over 5,000 characters; unknown fields (including a client-supplied `status`); and a `due_odometer` on an `insurance_renewal` or `road_tax_renewal` reminder (proposal, Q4). A `due_date` in the past is accepted, so an already-overdue item can be recorded (proposal, Q8). |
| AC-13 | A reminder can be edited (title, kind, due fields, notes) with `PATCH`. Omitted fields are unchanged, `due_date`, `due_odometer` and `notes` can be set to null while the AC-11 rule still holds, and `PATCH` of an unknown id returns `404 not_found`. The web edit form shows the saved values and saves the changes. |
| AC-14 | A reminder can be deleted. The web app asks for confirmation first. `DELETE` returns `204`, then `GET` of that id returns `404`. A replayed `DELETE` that returns `404` is treated as success by the sync queue (existing rule). |
| AC-15 | The three kinds are selectable in the web app. For `road_tax_renewal` the UI may show the label "Road tax (JPJ)" as context only. The app does not contact JPJ, does not state fees, rates or renewal periods, and does not claim any rule it cannot source. |
| AC-16 | Current odometer (proposal, Q1) is the `odometer` of the service record with the latest `date` (ties broken by `created_at`, then `id`), which is the first row of the service history order. It is `null` when there are no service records. The list response returns it together with the `service_record_id` and `date` it came from, and the web app shows that basis next to any odometer-based reminder. |
| AC-17 | Overdue rules, as one pure function with a shared table of test vectors used by both the backend and the web tests. A reminder with `completed_on` set is `completed`, never overdue. Otherwise it is `overdue` when `today > due_date`, or when the current odometer is known and `> due_odometer` (strictly greater). A reminder due today, or at exactly its due odometer, is `upcoming`. With both due fields, either one makes it overdue, and the response says which (`overdue_by`: `date`, `odometer`). If the current odometer is unknown, the odometer condition is not evaluated, the reminder is not overdue by odometer, and the UI says "odometer unknown". "Today" is the current date in Asia/Kuala_Lumpur (UTC+8; owner decision 2026-10-22). The client may send it, and the server defaults to the same zone. |
| AC-18 | The reminders page shows an Overdue group and an Upcoming group. Within a group, items are ordered by earliest `due_date` first, with items that have only a due odometer after them, ordered by `due_odometer` ascending. Each item shows its kind, title, due date and/or due km, and how many days or km remain or are overdue. Completed reminders are hidden by default and shown under a "Completed" filter. Reminders appear in the app only; there is no push, email or other notification in this slice. |
| AC-19 | A reminder can be marked complete (sets `completed_on`, not in the future by the Asia/Kuala_Lumpur date, like service dates) and reopened (sets it back to null). Marking one complete moves it out of Upcoming and Overdue. It does not create the next reminder (proposal, Q2). |
| AC-20 | The FR-12 suggested template is shown as a suggestion only. Opening the template screen sends no create request and creates no reminder. The screen lists the proposed reminders from the template with every value editable (kind, title, due date, due odometer, notes), and shows the source (Zeekr Malaysia AWD Performance service schedule PDF, research entry M12, `verified`) and the caveat that requirements vary by build date, operating conditions and local rules, so the owner should confirm against their own booklet or service centre. |
| AC-21 | Reminders from the template are created only when the owner explicitly confirms on the review screen, and only for the items the owner selected, using the values as edited. Cancelling or leaving the screen creates none. Each accepted item is an ordinary reminder (AC-10) with `template_ref` set, and can then be edited or deleted like any other. |
| AC-22 | The template is never applied silently. After the vehicle is saved, after service records are added, and after the app starts, the reminders list stays empty until the owner accepts a template. A test asserts that no reminder is created by any event other than an explicit accept. |
| AC-23 | The template content is data with a source reference, not an unconditional rule. Values come only from research M12: checkpoints every 20,000 km or 12 months, whichever comes first, for 8 checkpoints (20,000 km / year 1 to 160,000 km / year 8). Work items listed only where M12 states them: inspection, cabin air filter, brake fluid and front and rear reducer lubricant at even checkpoints; coolant at checkpoints 4 and 8. Odd-checkpoint work is shown as "not stated" and nothing is invented. Due dates are computed from a baseline date the owner enters or confirms; any prefill (for example the vehicle `purchase_date`) is labelled as a guess. The baseline is required before the owner can accept. |
| AC-24 | Offline read (extends AC-7, NFR-1): after the reminders page has been opened once online, a cold start with the API unreachable still lists the cached reminders, with the offline indicator. Overdue and upcoming are computed on the device from cached reminders, cached service records and the device date, and the page says the status is computed offline. If the template was never fetched, the template screen says it needs one online visit. |
| AC-25 | Offline write (extends AC-9, NFR-2): a reminder created, edited, completed, reopened or deleted while offline is shown as pending, persists across a reload, and is sent when the API is reachable again exactly once, with no duplicate. Create then edit of the same reminder offline is coalesced into one request. Accepting template items offline queues each as its own create, and a failure on one item is shown for that item without blocking the others. |
| AC-26 | Every reminder and template endpoint returns `401` without a valid token (extends AC-3). |
| AC-27 | A reminder created in the web app is stored on the server: it is returned by `GET /api/v1/reminders` from a different browser profile and survives a reload and reopening the app. The iPhone installed-app check is deferred (owner decision 2026-10-22) until an HTTPS origin exists, and is reported as deferred, not passed. |
| AC-28 | Title, notes and template text are rendered as plain text. A title such as `<img src=x onerror=alert(1)>` appears literally and runs nothing. No third-party script or raw HTML injection is added. |
| AC-29 | Migrations for the reminder table apply to an empty database and re-run without error (extends AC-2). Lint, type checks, tests, the OpenAPI drift check and the other gates in `docs/testing/test-strategy.md` pass for both the backend and the web client (extends AC-8). |

### Reminders slice: verification status (2026-10-22)

Implemented and verified by the Engineering Lead on disposable data. Details in `docs/testing/qa-report-2026-10-22-reminders.md`. This is not yet an independent QA pass.

| AC | Status |
|---|---|
| AC-10 to AC-26, AC-28, AC-29 | Verified (backend pytest, Vitest, Playwright on `localhost`, gates) |
| AC-27 | Server storage and second-profile read verified on `localhost`. **iPhone installed-app check: DEFERRED (optional, not passed)** until an HTTPS origin exists |


### Open questions for the owner: Reminders slice (block approval)

Owner answers 2026-10-22: **Q1 accepted** (odometer derived from the latest service record), **Q2 yes** (complete and reopen in scope, no auto-repeat), **Q3 local date** (the reminder rule uses the owner's local date, accepting the difference from the UTC service-date rule), **Q4 yes** (only `service` reminders may have a due odometer). **Q5 to Q9 accepted as proposed** (owner, 2026-10-22): the template baseline date is entered by the owner and prefilled from the purchase date, only the next checkpoint is preselected, the API serves the template as static data, the vehicle-researcher re-reads the PDF for odd-checkpoint work items, FR-12 is in this slice, "due soon" is 30 days or 1,000 km, past due dates are accepted on create, and JPJ and insurance reminders carry labels only. The owner approved the reminders contract and AC-10 to AC-29 on 2026-10-22, including the Asia/Kuala_Lumpur date rule. Implementation may start.

1. **Q1 Odometer source (decided: derive).** Proposal: derive it from the latest service record, which needs no change to the approved vehicle contract. Weakness: it goes stale if the owner has not logged a service for a while, so odometer reminders may be late or "unknown". Alternative: an owner-entered current odometer (a new optional field on the approved `PUT /vehicle` contract, or a separate reading), which changes an approved part. Which one?
2. **Q2 Completion and repeat.** Is mark-complete and reopen in scope (FR-7 and FR-8 do not say so, but overdue needs a way to clear)? Proposal: yes, and no automatic repeat reminder, so after a service the owner creates or accepts the next one.
3. **Q3 "Today" for overdue.** Proposal: the owner's local date (Malaysia is UTC+8), supplied by the client. This differs from the service-record rule, which judges "not in the future" against the UTC date (decision 2026-10-11). Accept the difference?
4. **Q4 Odometer on renewals.** Proposal: only `service` reminders may have a due odometer. Confirm.
5. **Q5 Template details.** (a) Baseline date: owner enters it, prefilled from the vehicle purchase date as a guess; M12 does not say whether years count from delivery, registration or first service. (b) On the review screen, preselect only the next checkpoint (proposal) or none or all? (c) Served by the API as static data and cached on the device (proposal) or bundled in the web app? (d) Should the vehicle-researcher re-read the PDF for the work done at odd checkpoints, which M12 does not list?
6. **Q6 Scope.** FR-12 said "not part of the initial vertical slice". Confirm that the owner's 2026-10-22 approval covers the template feature in this slice.
7. **Q7 Highlight threshold (not blocking).** Show "due soon" at 30 days or 1,000 km (proposal), display only.
8. **Q8 Past due dates.** Accept a `due_date` in the past on create (proposal), so already-overdue items can be entered.
9. **Q9 JPJ and insurance wording.** Confirm the label-only approach (AC-15): no JPJ or insurer integration, no stated fees or renewal periods.

## Acceptance criteria: Expenses slice (approved by the owner 2026-10-22)

Status: **approved by the owner on 2026-10-22 ("Approve all"; Q10 to Q25 accepted as proposed)**. Drafted 2026-10-22 by the Engineering Lead. Covers FR-5. Build order: Expenses first, then Warranty. The draft contract is "Expenses" in `docs/architecture/api-contracts.md`; the plan is `docs/product/expenses-slice-plan.md`. Items marked (proposal, Qn) depend on the open questions at the end of this section group. Attachments (FR-10) are out of scope. Field names: `date`, `category`, `amount_minor`, `currency`, `notes`.

| ID | Criterion |
|---|---|
| AC-30 | An expense can be created with `id` (client UUID), `date`, `category`, `amount_minor`, optional `currency` (default `MYR`) and optional `notes`. `GET /api/v1/expenses/{id}` returns the same values. A replay of the same `POST` (same `id`, same content) returns `200` with the existing expense and creates no second row; the same `id` with different content returns `409 conflict`. |
| AC-31 | Validation returns `400 validation_error` with field details for: a missing or malformed `date`; a `date` after today in Asia/Kuala_Lumpur (UTC+8); a `date` before 2000-01-01; a missing or unknown `category`; `amount_minor` missing, not a strict integer (for example `1.5` or `"100"`), below 1 (zero and negatives, proposal Q12) or above 10^12; `currency` other than `MYR`; `notes` over 5,000 characters; NUL characters; unknown fields. Today's date and past dates are accepted. |
| AC-32 | An expense can be edited with `PATCH` (`date`, `category`, `amount_minor`, `currency`, `notes`). Omitted fields are unchanged, `notes` can be set to null, and `date`, `category`, `amount_minor` cannot be null. The AC-31 rules apply to the patched values. `PATCH` of an unknown id returns `404 not_found`. The web edit form shows the saved values and saves the changes. |
| AC-33 | An expense can be deleted. The web app asks for confirmation first. `DELETE` returns `204`, then `GET` of that id returns `404`. A replayed `DELETE` that returns `404` is treated as success by the sync queue (existing rule). |
| AC-34 | `category` is a fixed enum (proposal, Q11): `charging`, `insurance`, `road_tax`, `parking`, `tolls`, `tyres`, `accessories`, `cleaning`, `fines`, `warranty`, `other`. The web app shows readable labels and all values are selectable. The label for `road_tax` may read "Road tax (JPJ)" as context only. The app does not contact JPJ or any insurer and states no fees, rates or renewal periods. Adding a category later is a contract amendment. |
| AC-35 | `GET /api/v1/expenses` returns newest first by `date`, then `created_at`, then `id`, all descending, with `limit` (1 to 100, default 50) and `cursor` paging like service records. An invalid cursor returns `400 validation_error`. The web list shows date, category label, amount in `RM 1,234.50` form and notes. |
| AC-36 | The list can be filtered by `category` (one value), `from` and `to` (inclusive dates, either or both). `from` later than `to`, an unknown category or a malformed date returns `400 validation_error`. Filters combine with AND and work with `cursor`. The web list offers the same filters and shows the active filters. |
| AC-37 | `GET /api/v1/expenses/summary` (same filters, no paging) returns `total_minor`, `count`, totals and counts `by_category` and `by_month` (`YYYY-MM` of the expense `date`, no time zone conversion). The values are computed from the rows on every request and never stored. Sums use integer arithmetic. An empty selection returns zeros and empty arrays. The numbers equal the sum of the matching list rows. The page states that service record costs are not included (proposal, Q10). |
| AC-38 | The new-expense form defaults the date to the current Asia/Kuala_Lumpur date. The amount is entered in MYR (up to 2 decimals, optional `RM` prefix, the existing parser) and sent as integer sen with no floating point. The amount is displayed as `RM 1,234.50`. A field error from the server is shown next to the field. |
| AC-39 | Offline read (extends AC-7, NFR-1): after the expenses page has been opened once online, a cold start with the API unreachable still lists the cached expenses, with the offline indicator. The filters work on the cached data. |
| AC-40 | Offline write (extends AC-9, NFR-2): an expense created, edited or deleted while offline is shown as pending, persists across a reload, and is sent when the API is reachable again exactly once, with no duplicate. Create then edit of the same expense offline is coalesced into one request. A delete of an unsent create cancels both. A `400` or `409` on one item is shown for that item without blocking the others. |
| AC-41 | Offline totals: the device computes totals by category and by month from the cached expenses plus pending ones, with the same pure function as the server, tested against one shared vector file. If the cache does not hold every expense (not all pages were fetched), the page says "partial: N expenses loaded" instead of showing the totals as complete. The page says the totals are computed offline. |
| AC-42 | Every expense route (including `summary`) returns `401` without a valid token (extends AC-3). |
| AC-43 | An expense created in the web app is stored on the server: it is returned by `GET /api/v1/expenses` from a different browser profile and survives a reload and reopening the app. The iPhone installed-app check is deferred (owner decision 2026-10-22) until an HTTPS origin exists, and is reported as deferred, not passed. |
| AC-44 | `notes` is rendered as plain text. A value such as `<img src=x onerror=alert(1)>` appears literally and runs nothing. No third-party script or raw HTML injection is added. |
| AC-45 | At most 5,000 expenses are stored (proposal, Q18). A create beyond that returns `400 validation_error` on field `body`. An idempotent replay of an existing expense is still accepted at the cap. |
| AC-46 | Scope boundary: an expense is independent of service records (proposal, Q10). Creating, editing or deleting an expense never changes a service record, and a service record cost never appears in expense totals. There is no attachment, no CSV export (proposal, Q17) and no link field in this slice. |
| AC-47 | The migration for the expense table applies to an empty database and re-runs without error (extends AC-2). Lint, type checks, tests, the OpenAPI drift check and the other gates in `docs/testing/test-strategy.md` pass for both the backend and the web client (extends AC-8). |

## Acceptance criteria: Warranty slice (approved by the owner 2026-10-22)

Status: **approved by the owner on 2026-10-22 ("Approve all"; Q10 to Q25 accepted as proposed)**. Drafted 2026-10-22 by the Engineering Lead. Covers FR-6. It starts after the Expenses slice is accepted. The draft contract is "Warranty" in `docs/architecture/api-contracts.md`; the plan is `docs/product/warranty-slice-plan.md`. A **coverage** is one warranty entry (for example a factory warranty or an extended plan). A **claim** is a record of a claim made under one coverage. Factory terms come from research M8 to M10 (`verified`, official Malaysia warranty PDF) and are offered only as an editable, explicitly accepted template. The owner's extended warranty is entered by the owner as ordinary data; it is not in the template and no personal identifier, certificate number or provider name is stored in the repository.

| ID | Criterion |
|---|---|
| AC-48 | A coverage can be created with `id` (client UUID), `name`, `provider_type` (`factory` or `extended`), `start_date`, optional `end_date`, optional `km_limit`, optional `notes`, `source_kind` and `verification_status` (defaults below). `GET /api/v1/warranty-coverages/{id}` returns the same values plus the computed fields. A replay of the same `POST` returns `200` with the existing coverage and creates no second row; the same `id` with different content returns `409 conflict`. |
| AC-49 | Coverage validation returns `400 validation_error` for: `name` empty or whitespace-only or over 200 characters; unknown `provider_type`, `source_kind` or `verification_status`; missing or malformed `start_date`; both `end_date` and `km_limit` null (the detail names both fields); `end_date` before `start_date`; `km_limit` not a strict integer, below 1 or above 10,000,000; a date outside 2000-01-01 to 2200-12-31; `notes` over 5,000 characters; NUL characters; unknown fields, including a client-supplied `status`; and a create beyond 50 coverages (field `body`). A `start_date` in the future and an `end_date` in the past are accepted, because an extended plan can start years ahead and old coverage can be recorded. |
| AC-50 | A coverage can be edited with `PATCH` (all content fields; `end_date`, `km_limit` and `notes` can be null while the AC-49 "end date or km limit" and "end not before start" rules still hold after the patch). `template_ref` cannot be changed after create. `PATCH` of an unknown id returns `404 not_found`. A coverage can be deleted: the web app asks for confirmation that states how many claims will also be deleted (proposal, Q14), `DELETE` returns `204` and the claims go with it, then `GET` returns `404`. |
| AC-51 | Computed status is one pure function with a shared table of test vectors used by the backend and the web tests. Inputs: coverage, current odometer (or unknown) and `today` (Asia/Kuala_Lumpur date). Result: `expired` when `today > end_date` (`expired_by` includes `date`) or when the odometer is known and `> km_limit` (includes `odometer`); equality is not expired. Otherwise `not_started` when `today < start_date`. Otherwise `expiring_soon` when `end_date` is within 90 days of today or the odometer is known and within 5,000 km of `km_limit` (proposal, Q19; display only; `expiring_soon_by` says which). Otherwise `active`. Status is computed on read, never stored or accepted in a request. If the odometer is unknown, the km condition is not evaluated and the UI says "odometer unknown". |
| AC-52 | The current odometer is defined exactly as for reminders (AC-16): the `odometer` of the service record with the latest `date` (ties by `created_at`, then `id`), `null` when there are no service records. The coverage list returns it with the `service_record_id` and `date` it came from, and the web app shows that basis next to any coverage that has a `km_limit`. The warranty and reminder code share one implementation of this read. Warranty claims never change the current odometer. |
| AC-53 | Wording: the app shows status as "Active by the dates and km you entered", "Expiring soon", "Not started", "Expired by date", "Expired by km", never "covered" or "not covered", and never states what a warranty includes, excludes or requires. Each coverage shows its `source_kind`, its `verification_status` label (`confirmed`, `proposed` or `unverified`) and the optional `source_note`. A fixed line says that terms and exclusions are in the warranty documents. |
| AC-54 | The factory template is shown as a suggestion only. Opening the template screen sends no create request and creates no coverage. The screen lists the proposed coverages with every value editable (name, start date, end date, km limit, notes) and shows the source (Zeekr Malaysia Warranty PDF, research entries M8 to M10, `verified`) and the caveat that terms, scope, exclusions and conditions vary by build date, usage, local rules and the warranty booklet, so the owner should confirm against their own documents. A baseline date (the owner's warranty start) is required before the owner can accept. Any prefill (for example the vehicle `purchase_date`) is labelled as a guess. |
| AC-55 | Template content is data with a source reference, not a rule, and is limited to what M8 to M10 state: general vehicle warranty 60 months / 150,000 km; paint and surface corrosion 60 months / 150,000 km; electric powertrain 96 months / 160,000 km; wear-and-tear 6 months / 10,000 km and 12 months / 20,000 km groups. Template rows carry a name and the duration and km only. They carry no list of covered or excluded parts, no price and no claim about what is covered; the wear-and-tear part lists are not placed in the template (the owner may type them into `notes`). The "genuine replacement parts, up to 2 years / 20,000 km, varies by part type" item is shown as "enter manually" with no number applied. The template contains no owner data and no extended warranty. A test asserts that no coverage is created by any event other than an explicit accept (after the vehicle is saved, after service records are added, at app start, when the screen is opened or cancelled). |
| AC-56 | Coverages from the template are created only when the owner confirms on the review screen, only for selected items, with the values as edited, each as an ordinary coverage (AC-48) with `template_ref` set, `provider_type` `factory`, `source_kind` `template` and `verification_status` `proposed`. The owner can then edit or delete them like any other and can set the label to `confirmed`. Cancelling or leaving creates none. |
| AC-57 | The owner's extended warranty is entered by the owner through the ordinary coverage form (`provider_type` `extended`, own name, dates, km limit, notes). Nothing in the app, template or fixtures pre-fills it. A test with fictional data shows an extended coverage whose `start_date` is in the future reads `not_started` and does not change the status of a factory coverage. The two layers (original and extension) are separate coverages; the app does not merge them or compute a combined result. |
| AC-58 | A claim can be created with `id` (client UUID), `coverage_id`, `date`, `odometer` (km), `description`, `status`, optional `cost_covered_minor`, optional `currency` (default `MYR`), optional `notes`. `GET /api/v1/warranty-claims/{id}` returns the same values. Replay and conflict behave as for AC-48. A `coverage_id` that does not exist returns `400 validation_error` on field `coverage_id`. |
| AC-59 | Claim validation returns `400 validation_error` for: a missing, malformed or future (Asia/Kuala_Lumpur) `date`, or one before 2000-01-01; `odometer` not a strict integer, below 0 or above 10,000,000; `description` empty or over 500 characters; `status` not one of `submitted`, `approved`, `rejected`, `completed` (proposal, Q21); `cost_covered_minor` not a strict integer, negative or above 10^12 (zero and null are accepted: null means not known yet); `currency` other than `MYR`; `notes` over 5,000 characters; NUL; unknown fields; and a create beyond 500 claims (field `body`). A claim `date` outside the coverage dates is accepted (the web form shows a hint only). `coverage_id` cannot be changed by `PATCH`. |
| AC-60 | A claim can be edited with `PATCH` (including `status`) and deleted. The web app asks for confirmation before delete. `DELETE` returns `204`, then `GET` returns `404`; a replayed `DELETE` returning `404` counts as success for the queue. Claims of one coverage are listed newest first by `date`, then `created_at`, then `id`, on that coverage's detail page, and the coverage list shows a `claim_count`. Claim `cost_covered_minor` is a record only: it does not create an expense, does not change expense totals and does not change any service record. |
| AC-61 | Offline read (extends AC-7, NFR-1): after the warranty pages have been opened once online, a cold start with the API unreachable still lists the cached coverages and claims, with the offline indicator. If the template was never fetched, the template screen says it needs one online visit. |
| AC-62 | Offline write (extends AC-9, NFR-2): a coverage or claim created, edited or deleted while offline is shown as pending, persists across a reload, and is sent exactly once, with no duplicate. Create then edit is coalesced. Queue order keeps a coverage create before its claim creates. If a coverage create fails (`400` or `409`), its dependent claim creates are shown as blocked by that coverage and are not sent. A delete of an unsent coverage cancels it together with its unsent claims. Accepting template items offline queues each as its own create, and a failure on one item does not block the others. |
| AC-63 | Offline status: the device computes the status of each coverage from the cached coverages, the cached and pending service records and the device date (Asia/Kuala_Lumpur), using the shared vectors, and the page says the status is computed offline and may differ from the server until the next sync. |
| AC-64 | Every warranty route (coverages, claims, template) returns `401` without a valid token (extends AC-3). |
| AC-65 | A coverage and a claim created in the web app are stored on the server: they are returned by the list endpoints from a different browser profile and survive a reload and reopening the app. The iPhone installed-app check is deferred (owner decision 2026-10-22) until an HTTPS origin exists, and is reported as deferred, not passed. |
| AC-66 | `name`, `notes`, `source_note`, `description` and template text are rendered as plain text. A value such as `<img src=x onerror=alert(1)>` appears literally and runs nothing. No third-party script or raw HTML injection is added. |
| AC-67 | Scope boundary: no attachment (FR-10), no reminder is created automatically from a warranty end date, no document or certificate number field, no provider name field, no import from a Zeekr or provider source, and no statement of coverage. The app never contacts the warranty provider or Zeekr. |
| AC-68 | Migrations for the two warranty tables (with the foreign key from claim to coverage) apply to an empty database, re-run without error and downgrade cleanly (extends AC-2). Lint, type checks, tests, the OpenAPI drift check and the other gates in `docs/testing/test-strategy.md` pass for both the backend and the web client (extends AC-8). |

### Open questions for the owner: Expenses and Warranty (all accepted as proposed by the owner, 2026-10-22)

**Blocking** (needed before the AC rows and contract drafts can be approved):

- **Q10 Expense and service record.** Are they separate? Proposal: yes, separate. An expense has no link to a service record, and expense totals exclude service record costs, so nothing is counted twice. The page says so. An optional link is a later, additive change.
- **Q11 Categories.** Fixed enum or free text? Proposal: fixed enum, `charging`, `insurance`, `road_tax`, `parking`, `tolls`, `tyres`, `accessories`, `cleaning`, `fines`, `warranty`, `other`. A fixed list keeps the category totals meaningful and the validation testable; free detail goes in `notes`. `warranty` is there so a plan purchase (such as the extended warranty price already recorded in the research) can be entered as an expense. Which values to add or drop?
- **Q12 Amount.** Positive only (at least 1 sen)? Proposal: yes. Refunds, rebates and zero-value entries are not modelled; a refund can be left out or noted in `notes`. (Service records allow cost 0; expenses do not.)
- **Q13 Warranty model.** Two entities, coverage and claim, as in the AC rows? Proposal: yes. `km_limit` is compared with the odometer reading (the latest service record), not with km driven since the start date. This matches how research M8 to M10 and the owner's documents state limits for a vehicle with a near-zero odometer at registration. It can be wrong for a coverage that began with a non-zero odometer; the UI shows the basis. The original warranty and the extension stay separate coverages.
- **Q14 Deleting a coverage that has claims.** Proposal: allowed, with a confirmation that says how many claims will also be deleted (cascade), because no new error code is wanted. Alternative: refuse until claims are deleted.
- **Q15 Factory template.** Offer the M8 to M10 durations as a suggested template (rows listed in AC-55), never applied silently, with the "requirements vary" caveat and no coverage scope text? Proposal: yes. The extended warranty is typed in by the owner and is not in the template.
- **Q16 Approval and order.** Approve AC-30 to AC-47 and the Expenses contract draft, and AC-48 to AC-68 and the Warranty contract draft, build Expenses first and start Warranty after Expenses is accepted? Proposal: yes. Both need the owner's re-approval of the "DRAFT" sections of `api-contracts.md`.

**Non-blocking** (defaults apply if unanswered):

- **Q17 CSV export.** Proposal: not in this slice (backlog). If wanted later, build it on the device from the cache, with spreadsheet formula injection guarded (cells starting `=`, `+`, `-` or `@` are prefixed).
- **Q18 Caps.** 5,000 expenses, 50 coverages, 500 claims. Proposal: accept (keeps full offline caching and the totals within safe integer range).
- **Q19 "Expiring soon".** Proposal: within 90 days of the end date or 5,000 km of the km limit, display only. (Reminders use 30 days / 1,000 km; warranty decisions need more lead time.)
- **Q20 Labels.** `verification_status` defaults: `unverified` for owner-entered, `proposed` for template-accepted; the owner can set `confirmed` after checking a document. Optional free-text `source_note` (max 200), for example the name of the document type. Proposal: accept. The UI should discourage typing certificate numbers.
- **Q21 Claim statuses.** `submitted`, `approved`, `rejected`, `completed`. Proposal: accept.
- **Q22 Claim odometer.** Required (as on a service invoice). Proposal: accept.
- **Q23 Expense summary default view.** Whole history with by-month rows; quick filters "This month" and "This year" use the Asia/Kuala_Lumpur date. Proposal: accept.
- **Q24 Warranty reminders.** No automatic "warranty ending" reminder (reminder kinds are fixed by the approved contract). Proposal: leave to the backlog; the status badge is the signal.
- **Q25 Template baseline.** The owner enters the warranty start; the vehicle `purchase_date` is a labelled guess (M8 says coverage starts at first registration or entry into service, whichever is earlier, and the vehicle profile holds no registration date). Proposal: accept.

## Open questions for the owner

Resolved:

- Distance unit is kilometres (confirmed 2026-10-11).
- ADR-001 and the API contract are approved (2026-10-11).

- Service schedule is offered as a suggested template that the owner can accept or edit (owner decision 2026-10-22, FR-12). Reason: Zeekr's PDF says requirements vary by build date, conditions and local rules. Source: research M12, `verified` against the official Malaysia PDF.
- Authentication is a single owner password for now (confirmed 2026-10-11). The owner chose a full account model on 2026-10-22, but it is sequenced after the remaining MVP items (expenses, warranty, reminders). The single-password mode stays until then. Owner answers of 2026-10-22, which feed a future ADR-006 and API contract amendment (not yet written, no code until the contract is re-approved):
  - Users: one, the owner (confirmed 2026-10-22, option B: username plus password instead of a password alone). No second user is planned. The scope is therefore small: no roles table, no per-user data and no cache scoping are needed. The admin role and shared-car answers below apply only if a second user is ever added, which would need a new ADR and an ADR-003 amendment.
  - Accounts are created by the admin; login identifier is a username.
  - Password reset is a server command run by the admin. No email service.
  - Data model: one shared car (no per-user data), with an admin role.
  - Sessions: keep the one-hour memory-only Bearer token, no refresh.
  - Lockout: both per account and per client address (owner answer). With one user, the per-account limit mostly duplicates the existing limiter; the Security Engineer should confirm whether it is worth building.
  - Existing data is owned by the admin account.
  - Order: expenses, warranty and reminders come before accounts.
  - Tailscale (ADR-003) is unchanged while there is a single user.
- Client is a mobile-responsive web app instead of a native iOS app, to avoid the Apple Developer fee (confirmed 2026-10-11). The web stack is a React + Vite + TypeScript PWA (ADR-002, approved 2026-10-11), served same-origin through a reverse proxy container.
- Cached data is readable without an app lock; the owner relies on the phone lock (confirmed 2026-10-11).
- `gitleaks` and Playwright browser downloads are approved as free tools (confirmed 2026-10-11).
- Owner decision 2026-10-22: Tailscale setup is no longer a requirement for completing a slice. ADR-003 stays as the intended design for later. The phone-side checks for AC-6, AC-7 and AC-27 are **deferred (optional)**: they do not gate acceptance of a slice, but they are still not passed. Report them as "deferred, not run", never as passed. The automated `localhost` checks remain the gates.
- Remote access: Tailscale, free Personal plan (owner decision 2026-10-13, ADR-003). Funnel stays off and nothing is exposed to the public internet (NFR-6). The repository is public, so the real tailnet name, hostnames, account email and device names must never appear in it; use placeholders.

- The owner's market is Malaysia, not the UK, and the currency is MYR with the `currency` field kept and defaulting to MYR (confirmed 2026-10-11). The earlier UK research is void for the owner's market.

- **Superseded 2026-10-22:** all calendar-date rules (service-record "not in the future", reminder "today" and `completed_on`) are judged against the current date in Asia/Kuala_Lumpur (UTC+8, no daylight saving). Timestamps stay UTC in storage. The default date in the new-record form becomes the Asia/Kuala_Lumpur date, and the UTC-window hint is removed. Existing code and tests (`schemas.py`, `RecordForm.tsx`, `dates.ts`, `default-date.test.tsx`, `qa-task5.test.tsx`, `slice.spec.ts`) must be updated as part of the reminders slice. The next two paragraphs record the earlier decisions for history.
- (Superseded) The service-record rule "date not in the future" stays as written, judged against the current UTC date, with no tolerance (owner decision 2026-10-11). Known consequence: between 00:00 and 08:00 Malaysian time, today's local date is ahead of the UTC date and is rejected with `validation_error`. The web client should show that error clearly. Owner decision 2026-10-12: the new-record form defaults its date to the current UTC date, so the default is never rejected, and a hint under the field explains the window.

- Login lockout stays a hard lockout (owner decision 2026-10-11). After too many failed attempts, login returns 429 even for the correct password until the window passes. Known trade-off: someone who can reach the API could keep the owner locked out, so reachability limits (NFR-6) are the main protection. The limiter is in memory and resets on restart.

Deferred:

1. Remote access: decided, see above (Tailscale). The open sub-questions (where TLS terminates, tailnet naming, HSTS, key expiry, identity provider) are listed in ADR-003.
