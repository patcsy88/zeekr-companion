# QA report: Expenses web client (FR-5), independent pass

Date: 2026-10-22. Scope: `apps/web` only. Tests: `apps/web/test/expenses-qa.test.tsx` (87 tests: 79 pass, 8 `test.fails` that each mark a defect). No application code or existing test was changed.

## Checked (all passing unless listed under defects)

- Money parsing: RM prefix, commas, `0.1`, `0.29`, 10^12 boundary, every `w.ff` for w 0 to 200, rejects `0.105`, `1e3`, `-1`, empty, `1,23`, Arabic-Indic and full-width digits, `+5`, `5.`, `.5`, `NaN`, `Infinity`, very large values. `senToInput` round trip.
- `formatMyr`: 0, 1 sen, 9 sen, thousands, 10^12, 2x10^12+1.
- KL date: `klToday` at 15:59:59Z and 16:00:00Z, month/year ends; form refuses tomorrow (KL) and accepts today at the boundary; before-2000, impossible and empty dates; category, amount and notes-length validation.
- Filters: from = to inclusive, from > to message, "This month" at month end, "This year" at 16:00Z on 31 Dec.
- Totals: shared vectors invariants (sums, order independence), list total equals sum of rows, 1 sen, 2x10^12+1 display, Partial warning when `next_cursor` is set.
- Queue: create+edit+delete, delete then recreate same id, delete of attempted create, edit after failed attempt resets and merges, a failed create does not block another expense, an edit behind a failed create is held.
- UI: notes as plain text (script, svg, entities, 5000 characters), accessible names on all controls, double-click Save sends one POST, unmount during in-flight save, whitespace notes become null, future date refused with nothing queued, offline cold start with empty cache, pending delete removes amount from totals, sign out and clear local data clears expense cache and queue.

## Defects

| Id | Severity | Summary | Repro |
|---|---|---|---|
| QA-W8 | Medium | Edit then delete of an already-attempted create loses the DELETE. `enqueueExpenseEdit` folds into the create and `reset()` sets `attempts: 0`, so `enqueueExpenseDelete` treats it as never sent and drops both. If the first POST reached the server (lost response), the expense stays on the server and returns on refresh. Same pattern exists for records and reminders. | Enqueue create; set `attempts: 1`; `enqueueExpenseEdit`; `enqueueExpenseDelete`; queue is empty. |
| QA-W1 | Low | Leading zeros count toward the 13-digit limit: `0000000000000001` is rejected as "too large". | `parseMyrToSen('0000000000000001')` |
| QA-W2 | Low | Malformed grouping `0,100` is accepted as RM 100.00. | `parseMyrToSen('0,100')` |
| QA-W3 | Low | NUL in notes passes local validation; the server returns 400 (contract), so the item fails after queueing instead of being blocked in the form. | `validateExpense({... notes: 'a\0b'})` |
| QA-W4 | Low | Notes length is counted in UTF-16 units; 2501 emoji (under 5000 characters) is refused locally. | `validateExpense` with `'😀'.repeat(2501)` |
| QA-W5 | Low | Partial warning reads "1 expenses loaded". | Cache with one item and a cursor, offline. |
| QA-W6 | Low | The filter control and the form field are both named "Category". Not ambiguous on one page, but the filter name is not distinguishable out of context. Suggest "Filter by category". | `getByRole('combobox')` in the Filters form has name "Category". |
| QA-W7 | Low | The clear-local-data dialog text names only service records and vehicle, not expenses, though expenses are cleared (verified). | Open "Sign out and clear local data". |

## Not checked

- Playwright e2e, real browsers, iOS Safari, layout overflow for long notes (out of scope).
- AC-43 cross-profile persistence and the iPhone installed-app check (deferred by the owner).
- 5,000-expense volume and the 50-page fetch cap in the UI.
- Backend behaviour (done separately); the fake API in `test/server.ts` was used, so server-side parity is unverified.
- Concurrent tabs and Web Locks.
