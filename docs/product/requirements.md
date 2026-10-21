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

## Acceptance criteria: Reminders slice (proposed, pending owner approval)

Status: **proposed**, drafted 2026-10-22 after the owner approved doing this slice next. It covers FR-7, FR-8 and FR-12. The contract is a DRAFT in `docs/architecture/api-contracts.md` ("Reminders (DRAFT)"); no code starts until the owner approves both. Items marked "(proposal)" depend on an open question below. Field names: `due_date`, `due_odometer` (km), `completed_on`, as in the draft contract.

| ID | Criterion |
|---|---|
| AC-10 | A reminder can be created with `kind` (`service`, `insurance_renewal` or `road_tax_renewal`), a title, and a due date only, a due odometer (km) only, or both. `GET /api/v1/reminders/{id}` then returns the same values. A replay of the same `POST` (same `id`, same content) returns `200` with the existing reminder and creates no second row; the same `id` with different content returns `409 conflict`. |
| AC-11 | A reminder with neither `due_date` nor `due_odometer` is rejected with `400 validation_error`, and the detail names the missing due fields. A `PATCH` that would leave neither field set is rejected the same way, and the reminder is unchanged. |
| AC-12 | Validation returns `400 validation_error` for: negative `due_odometer`; `due_odometer` above 10,000,000; a non-integer `due_odometer` (for example `1.5` or `"100"`); an unknown `kind`; a malformed date; an empty or whitespace-only title, or one over 200 characters; notes over 5,000 characters; unknown fields (including a client-supplied `status`); and a `due_odometer` on an `insurance_renewal` or `road_tax_renewal` reminder (proposal, Q4). A `due_date` in the past is accepted, so an already-overdue item can be recorded (proposal, Q8). |
| AC-13 | A reminder can be edited (title, kind, due fields, notes) with `PATCH`. Omitted fields are unchanged, `due_date`, `due_odometer` and `notes` can be set to null while the AC-11 rule still holds, and `PATCH` of an unknown id returns `404 not_found`. The web edit form shows the saved values and saves the changes. |
| AC-14 | A reminder can be deleted. The web app asks for confirmation first. `DELETE` returns `204`, then `GET` of that id returns `404`. A replayed `DELETE` that returns `404` is treated as success by the sync queue (existing rule). |
| AC-15 | The three kinds are selectable in the web app. For `road_tax_renewal` the UI may show the label "Road tax (JPJ)" as context only. The app does not contact JPJ, does not state fees, rates or renewal periods, and does not claim any rule it cannot source. |
| AC-16 | Current odometer (proposal, Q1) is the `odometer` of the service record with the latest `date` (ties broken by `created_at`, then `id`), which is the first row of the service history order. It is `null` when there are no service records. The list response returns it together with the `service_record_id` and `date` it came from, and the web app shows that basis next to any odometer-based reminder. |
| AC-17 | Overdue rules, as one pure function with a shared table of test vectors used by both the backend and the web tests. A reminder with `completed_on` set is `completed`, never overdue. Otherwise it is `overdue` when `today > due_date`, or when the current odometer is known and `> due_odometer` (strictly greater). A reminder due today, or at exactly its due odometer, is `upcoming`. With both due fields, either one makes it overdue, and the response says which (`overdue_by`: `date`, `odometer`). If the current odometer is unknown, the odometer condition is not evaluated, the reminder is not overdue by odometer, and the UI says "odometer unknown". "Today" is the owner's local date supplied by the client (proposal, Q3); the server defaults to the UTC date. |
| AC-18 | The reminders page shows an Overdue group and an Upcoming group. Within a group, items are ordered by earliest `due_date` first, with items that have only a due odometer after them, ordered by `due_odometer` ascending. Each item shows its kind, title, due date and/or due km, and how many days or km remain or are overdue. Completed reminders are hidden by default and shown under a "Completed" filter. Reminders appear in the app only; there is no push, email or other notification in this slice. |
| AC-19 | A reminder can be marked complete (sets `completed_on`, not in the future by the UTC date, like service dates) and reopened (sets it back to null). Marking one complete moves it out of Upcoming and Overdue. It does not create the next reminder (proposal, Q2). |
| AC-20 | The FR-12 suggested template is shown as a suggestion only. Opening the template screen sends no create request and creates no reminder. The screen lists the proposed reminders from the template with every value editable (kind, title, due date, due odometer, notes), and shows the source (Zeekr Malaysia AWD Performance service schedule PDF, research entry M12, `verified`) and the caveat that requirements vary by build date, operating conditions and local rules, so the owner should confirm against their own booklet or service centre. |
| AC-21 | Reminders from the template are created only when the owner explicitly confirms on the review screen, and only for the items the owner selected, using the values as edited. Cancelling or leaving the screen creates none. Each accepted item is an ordinary reminder (AC-10) with `template_ref` set, and can then be edited or deleted like any other. |
| AC-22 | The template is never applied silently. After the vehicle is saved, after service records are added, and after the app starts, the reminders list stays empty until the owner accepts a template. A test asserts that no reminder is created by any event other than an explicit accept. |
| AC-23 | The template content is data with a source reference, not an unconditional rule. Values come only from research M12: checkpoints every 20,000 km or 12 months, whichever comes first, for 8 checkpoints (20,000 km / year 1 to 160,000 km / year 8). Work items listed only where M12 states them: inspection, cabin air filter, brake fluid and front and rear reducer lubricant at even checkpoints; coolant at checkpoints 4 and 8. Odd-checkpoint work is shown as "not stated" and nothing is invented. Due dates are computed from a baseline date the owner enters or confirms; any prefill (for example the vehicle `purchase_date`) is labelled as a guess. The baseline is required before the owner can accept. |
| AC-24 | Offline read (extends AC-7, NFR-1): after the reminders page has been opened once online, a cold start with the API unreachable still lists the cached reminders, with the offline indicator. Overdue and upcoming are computed on the device from cached reminders, cached service records and the device date, and the page says the status is computed offline. If the template was never fetched, the template screen says it needs one online visit. |
| AC-25 | Offline write (extends AC-9, NFR-2): a reminder created, edited, completed, reopened or deleted while offline is shown as pending, persists across a reload, and is sent when the API is reachable again exactly once, with no duplicate. Create then edit of the same reminder offline is coalesced into one request. Accepting template items offline queues each as its own create, and a failure on one item is shown for that item without blocking the others. |
| AC-26 | Every reminder and template endpoint returns `401` without a valid token (extends AC-3). |
| AC-27 | A reminder created in the web app is stored on the server: it is returned by `GET /api/v1/reminders` from a different browser profile and survives a reload and reopening the app. The iPhone installed-app check stays blocked until the Tailscale HTTPS origin exists, and is reported as blocked, not passed. |
| AC-28 | Title, notes and template text are rendered as plain text. A title such as `<img src=x onerror=alert(1)>` appears literally and runs nothing. No third-party script or raw HTML injection is added. |
| AC-29 | Migrations for the reminder table apply to an empty database and re-run without error (extends AC-2). Lint, type checks, tests, the OpenAPI drift check and the other gates in `docs/testing/test-strategy.md` pass for both the backend and the web client (extends AC-8). |

### Open questions for the owner: Reminders slice (block approval)

Owner answers 2026-10-22: **Q1 accepted** (odometer derived from the latest service record), **Q2 yes** (complete and reopen in scope, no auto-repeat), **Q3 local date** (the reminder rule uses the owner's local date, accepting the difference from the UTC service-date rule), **Q4 yes** (only `service` reminders may have a due odometer). Q5 to Q9 are still open; the proposals below stand until answered.

1. **Q1 Odometer source (decided: derive).** Proposal: derive it from the latest service record, which needs no change to the approved vehicle contract. Weakness: it goes stale if the owner has not logged a service for a while, so odometer reminders may be late or "unknown". Alternative: an owner-entered current odometer (a new optional field on the approved `PUT /vehicle` contract, or a separate reading), which changes an approved part. Which one?
2. **Q2 Completion and repeat.** Is mark-complete and reopen in scope (FR-7 and FR-8 do not say so, but overdue needs a way to clear)? Proposal: yes, and no automatic repeat reminder, so after a service the owner creates or accepts the next one.
3. **Q3 "Today" for overdue.** Proposal: the owner's local date (Malaysia is UTC+8), supplied by the client. This differs from the service-record rule, which judges "not in the future" against the UTC date (decision 2026-10-11). Accept the difference?
4. **Q4 Odometer on renewals.** Proposal: only `service` reminders may have a due odometer. Confirm.
5. **Q5 Template details.** (a) Baseline date: owner enters it, prefilled from the vehicle purchase date as a guess; M12 does not say whether years count from delivery, registration or first service. (b) On the review screen, preselect only the next checkpoint (proposal) or none or all? (c) Served by the API as static data and cached on the device (proposal) or bundled in the web app? (d) Should the vehicle-researcher re-read the PDF for the work done at odd checkpoints, which M12 does not list?
6. **Q6 Scope.** FR-12 said "not part of the initial vertical slice". Confirm that the owner's 2026-10-22 approval covers the template feature in this slice.
7. **Q7 Highlight threshold (not blocking).** Show "due soon" at 30 days or 1,000 km (proposal), display only.
8. **Q8 Past due dates.** Accept a `due_date` in the past on create (proposal), so already-overdue items can be entered.
9. **Q9 JPJ and insurance wording.** Confirm the label-only approach (AC-15): no JPJ or insurer integration, no stated fees or renewal periods.

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
- Phone-side checks for AC-6 and AC-7 are blocked until the Tailscale HTTPS origin is set up (owner chose Tailscale on 2026-10-13, see ADR-003). They are reported as blocked, not passed.
- Remote access: Tailscale, free Personal plan (owner decision 2026-10-13, ADR-003). Funnel stays off and nothing is exposed to the public internet (NFR-6). The repository is public, so the real tailnet name, hostnames, account email and device names must never appear in it; use placeholders.

- The owner's market is Malaysia, not the UK, and the currency is MYR with the `currency` field kept and defaulting to MYR (confirmed 2026-10-11). The earlier UK research is void for the owner's market.

- The service-record rule "date not in the future" stays as written, judged against the current UTC date, with no tolerance (owner decision 2026-10-11). Known consequence: between 00:00 and 08:00 Malaysian time, today's local date is ahead of the UTC date and is rejected with `validation_error`. The web client should show that error clearly. Owner decision 2026-10-12: the new-record form defaults its date to the current UTC date, so the default is never rejected, and a hint under the field explains the window.

- Login lockout stays a hard lockout (owner decision 2026-10-11). After too many failed attempts, login returns 429 even for the correct password until the window passes. Known trade-off: someone who can reach the API could keep the owner locked out, so reachability limits (NFR-6) are the main protection. The limiter is in memory and resets on restart.

Deferred:

1. Remote access: decided, see above (Tailscale). The open sub-questions (where TLS terminates, tailnet naming, HSTS, key expiry, identity provider) are listed in ADR-003.
