# QA report: Warranty web client (FR-6), independent pass

Date: 2026-10-23. Scope: `apps/web` only (commit d02564a and later). No application code under `apps/web/src` and no existing test was changed. Nothing is committed.

Tests were written from the acceptance criteria (AC-48..AC-68, `docs/product/requirements.md`) and the contract (`docs/architecture/api-contracts.md`, "Warranty"), not from the existing `test/warranty*.test.*`. All data is fictional.

## Added files

| File | Tests | Notes |
|---|---|---|
| `test/warranty-status-qa.test.ts` | 21 pass | `warrantyStatus`, date math, KL date, status labels |
| `test/warranty-forms-qa.test.ts` | 38 pass + 3 `test.fails` | `validateCoverage`, `validateClaim`, `outsideCoverageDates` |
| `test/warranty-queue-qa.test.ts` | 35 pass + 3 `test.fails` | offline queue, flush order, odometer, `claim_count` |
| `test/warranty-qa.test.tsx` | 29 pass + 1 `test.fails` | template page, wording, plain text, delete dialog, a11y |
| `test/warranty-qa-helpers.ts` | n/a | shared fixtures and request trace |

Total new: 123 passing, 7 expected failures (each marks a defect below).

## Commands and results

All run in the foreground in `apps/web` unless stated; a process check for vitest, playwright and stack.mjs was empty before each test run.

| Command | Result |
|---|---|
| `npm run lint` | No issues (after fixing 4 `no-unnecessary-type-assertion` errors in my own new files) |
| `npm run format:check` | All matched files use Prettier code style |
| `npx tsc --noEmit` | Exit 0, no output |
| `npm test` (default workers), final code, 8 runs | **2 of 8 green** (496 passed, 10 expected fail, 27 files). **6 of 8 failed** with 1 failure in the existing `test/expenses.test.tsx` (see "Flake" below). Earlier, before I split two tests, 3 of 5 runs were green. |
| `npx vitest run --maxWorkers=2` (whole suite), 6 runs | 6 of 6 green: 496 passed, 10 expected fail (506) |
| `npx vitest run --exclude 'test/warranty-*qa*'` (suite without my files), 5 runs | 5 of 5 green: 373 passed, 3 expected fail |
| `test/warranty-qa.test.tsx` alone, 8 runs | 8 of 8 green: 29 passed, 1 expected fail |
| `npm run build` | Built; PWA precache 12 entries (390.99 KiB) |
| `npm run e2e` | 37 passed (1.5 m) |
| `docker ps -a` | 0 `zc-e2e-pg-*` containers left. 5 `divesafe-*` containers exist and were not touched. |
| `npm audit --audit-level=high` | found 0 vulnerabilities |
| `gitleaks detect --no-git --source . --redact` (repo root) | no leaks found (~5.15 MB scanned) |

Each of the 7 `test.fails` was verified by temporarily running it as a plain `test`; each failed on the expected assertion (temporary copies were deleted).

### Flake: the full `npm test` is not reliably green with these files added

`test/expenses.test.tsx` (an existing file) fails intermittently in a full parallel run. Seen failures: "create then edit offline sends one POST carrying the final content" (`listQueue()` has length 0, expected 1, line 522) and once "create offline is pending, survives a reload…" (`sync-pending` not found). The same file passes 6 of 6 when run alone.

What I can and cannot say:

- Without my five files the suite was green 5 of 5. Excluding one file at a time (4 runs each): without `warranty-queue-qa.test.ts` 3 green and 1 red; without `warranty-status-qa.test.ts` 1 green and 3 red; without `warranty-forms-qa.test.ts` 4 green; without `warranty-qa.test.tsx` 4 green. Four runs each is too few to say which file matters. Only the file count (more parallel jsdom workers) is a consistent suspect.
- With `--maxWorkers=2` the full suite is green 6 of 6. Together this points to load/timing sensitivity of the expenses test (it races a queue read against an in-flight save under CPU contention; the machine has 12 cores), made more likely by the added test files, not to a logic error in them.
- I did not find the root cause. I did not edit the expenses test (out of scope). This is **open** and the gate "`npm test` green 5 times" is **not met** with default workers. See QA-WW7.

## Findings

| Id | Severity | AC | Description | Reproduction | Status |
|---|---|---|---|---|---|
| QA-WW1 | Medium | AC-62 | Deleting a coverage whose create was rejected (400) leaves the failed create in the queue, so the failed item and its notice stay after the owner deleted it. | `enqueueCoverageCreate`; flush with a 400; `enqueueCoverageDelete`; flush. Queue still has 1 entry. Test `QA-WW1` in `warranty-queue-qa.test.ts`. | Open |
| QA-WW2 | Medium/Low | AC-62 | Same for a claim whose create failed with 400, then `enqueueClaimDelete`. | As above for claims. Test `QA-WW2`. | Open |
| QA-WW3 | Medium | AC-48, AC-62 | Lost create response (attempted), then an edit is folded into the create (attempts kept), then a delete. The replayed POST has different content, so the server answers 409 (AC-48). The queued DELETE for the same id is then skipped (engine `blocked.has(record_id)`), so the coverage stays on the server. | Test `QA-WW3` with an msw handler that returns 409 on a content mismatch. | Open |
| QA-WW4 | Low | AC-49 | Source note length is counted in UTF-16 units: 150 emoji (150 characters, valid per contract) is refused as over 200. Same class as expenses QA-W4; also applies to name, notes and claim description. | `validateCoverage({... source_note: '🚗'.repeat(150)})` returns "At most 200 characters." | Open |
| QA-WW5 | Low | AC-49, AC-57 | NUL in name, notes or claim description passes local validation; the contract forbids NUL, so the server returns 400 after the item is queued instead of being refused in the form. Same class as expenses QA-W3. | `validateCoverage({... name: 'bad\u0000name'})`; `validateClaim({... description: 'a\u0000b'})` (tests `QA-WW5`, `QA-WW5b`). | Open |
| QA-WW6 | Low | a11y | On the template page each selectable row repeats the labels "Name", "Start date", "End date", "Km limit" and "Notes", so three fields share each accessible name and a screen-reader user cannot tell which row a field belongs to. | `getAllByLabelText('Name')` on `/warranty/template` returns 3. Suggest a row-specific `aria-label` such as "Name, Vehicle warranty". | Open |
| QA-WW7 | Medium (test infrastructure) | gate | Full parallel `npm test` is intermittently red because of `test/expenses.test.tsx` (see "Flake"). | `npm test` repeated; see counts above. | Open; root cause not found |

QA-WW2, QA-WW5b are variants listed with their parent.

## Checked and passing

- Status function: equality of today with start and end; the 90-day boundary (90 expiring, 91 active); the 5000 km boundary and equality with the limit; unknown odometer; both `expired_by` values and both together; expired wins over not started; no end and no km never expires. Month-end clamp and leap-year addition (31 Jan + 1 month = 28 Feb; 29 Feb 2024 + 12 months = 28 Feb 2025; +60 and +96 months). `klToday` at 15:59:59Z and 16:30Z, and with the faked Date clock at the year end.
- Status labels are exactly as specified and none contains "covered" or "guarantee".
- Coverage form validation: name blank, whitespace, 200 and 201; start required, impossible and out-of-range dates; end before start (equal accepted); neither end nor km; km 0, 10,000,001, 1.5, `1e3`, `-1`, `+5`, full-width digits, `1,000`; notes 5000/5001; source note 200/201.
- Claim form validation: date empty, impossible, before 2000, today accepted, tomorrow refused; odometer bounds; description 500/501; cost `''`, `0`, `12.5`, `1,234.50`, `RM 12`, leading zeros, `0,100`, `1.234`, huge values; claim date outside the coverage dates is a hint only.
- Template page: opening, cancelling and leaving POST nothing (every POST spied); empty or impossible baseline refused; end date follows the baseline plus months with the clamp rule; km prefill; only edited and selected values are posted with `factory`, `template`, `proposed` and `template_ref` `my-factory-warranty:<key>`; deselecting everything posts nothing; one invalid row blocks the whole accept; `genuine_parts` has no checkbox or input and is never posted; one rejected item does not block the others; the purchase-date prefill is labelled a guess and the label goes away once the owner types a date.
- Wording: no "not covered", "guarantee" or "is covered" on the list, five detail pages (all statuses) or the template page; status headings and both `expired_by` labels; fixed documents line on every detail page; source kind, verification and source note shown; no provider-name or certificate-number input on the coverage or claim form.
- Plain text (AC-66): `<img src=x onerror=alert(1)>` and `<script>` strings in name, notes, source note, claim description and claim notes render as text with no element created and no script run.
- Delete confirmation: 0, 1 (singular) and 3 claims; cancel deletes nothing.
- Accessibility: every control on both forms has exactly one label and labels are unique per form; status is text, not colour only.
- Queue (see `warranty-queue-qa.test.ts`): a claim queued before its coverage is sent after it; a 400 or 409 coverage failure blocks its claims while other items flow; a successful retry sends the claim once; network errors do not block permanently; 5xx stops the run; coalescing; delete of an unsent coverage cancels its claims and edits; delete of a sent coverage drops pending claim writes; a replayed DELETE 404 counts as success; the queue survives closing and reopening the database; concurrent `flush()` calls send once; a write during a flush is kept; 401 pauses the queue; sign out and clear local data wipes cache and queue; offline current odometer (latest date, then `created_at`, then id; includes pending records; claims never change it); `claim_count` stays consistent after offline create and delete.
- E2E (existing suite, not extended): 37 passed.

## Not checked

- An extra Playwright spec was not added; the existing `e2e/warranty.spec.ts` (3 cases) ran and passed. Offline blocked claim end to end and page reload keeping pending are covered only at the component and queue level.
- iPhone and HTTPS installed-app behaviour (AC-65, deferred by the owner); real-browser layout and long-text overflow.
- Backend parity: the fake API in `test/server.ts` was used, so server-side validation (for example the real 409 and 400 rules) is unverified here. The fake only checks name, end/km presence and end before start.
- Multi-tab behaviour and Web Locks.
- The 50-coverage and 500-claim caps and large data volumes.
- Contrast and keyboard focus order (only labels and names were checked).

## Fixes (2026-10-23)

| Id | Status | Change |
|---|---|---|
| QA-WW1, QA-WW2 | **Fixed** | Deleting a coverage or claim whose create was refused (4xx other than 409) cancels it outright. Otherwise (a 409, or an attempted create) the failed create is removed and a DELETE is queued, so the failed item no longer sits next to the DELETE. |
| QA-WW3 | **Fixed** | An edit is no longer folded into a create that was attempted and may have reached the server (lost response). It is queued as its own PATCH, so the replay of the create keeps its original content (no 409) and a later delete still reaches the server. A failed create still takes the edit, which is how the owner fixes a rejected item. A test covers a 409'd coverage create followed by a delete. |
| QA-WW7 | **Resolved (test race)** | Not an app defect. The "app-start sync finished" helpers returned when a request arrived, and the response then marked the API reachable again, undoing a following `reportReachable(false)`. The helpers in `expenses`, `expenses-qa` and `reminders` tests now also wait for the last request and let the response land. 8 of 8 full-suite runs passed after the change (6 of 8 failed before it). |
| QA-WW4, WW5, WW6 | Open (Low) | UTF-16 length counting, NUL accepted by local validation (the server refuses it), and repeated labels on the three template rows. Known limits. |

After the fixes: 500 passed and 7 expected failures in 5 consecutive runs; lint, format, tsc, build and `npm audit` clean; Playwright e2e 37 passed with no leftover containers; gitleaks clean.
