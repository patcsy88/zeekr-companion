# Tyres slice plan

Status: **approved by the owner 2026-11-08**. Covers FR-9 and completes the MVP list in `product-brief.md`. Acceptance criteria AC-75 to AC-86 in `docs/product/requirements.md`. Contract: "Tyre events" in `docs/architecture/api-contracts.md`. Data model: "Tyres data model" in `docs/architecture/architecture.md`.

## Owner answers (2026-11-08)

| # | Question | Answer |
|---|---|---|
| T1 | Should a tyre cost also create an expense? | No. Kept separate, and the page says so |
| T2 | Rotation reminder | Agree: no new reminder kind. "Add rotation reminder" opens the normal Service reminder form prefilled with "Rotate tyres" and the event odometer + N km. The owner types N; the app suggests none |
| T3 | Event kinds | Replace, Rotate, Repair, Alignment, Balancing (Alignment and Balancing are separate) |
| T4 | Wheels on a rotation | All four ticked by default; no swap pattern (use notes) |
| T5 | Odometer prefill | Agree: the current odometer (larger of the latest service record and the newest live reading), editable |
| T6 | Vehicle tyre specification (FR-1) | Unchanged; used only to prefill the size on Replace |

## Placement

No new tab. The Vehicle page's "Tyres" group links to `/vehicle/tyres` (list and "Current tyres"), with `/vehicle/tyres/new`, `/vehicle/tyres/:id` and `/vehicle/tyres/:id/edit`.

## Test traceability

| Criterion | Verification |
|---|---|
| AC-75, AC-76, AC-77, AC-78 | `services/api/tests/test_tyre_events.py`: create, replay 200, conflict 409, every validation case, wheel order, patch rules, delete then 404. Kuala Lumpur future-date case |
| AC-79 | Backend ordering, cursor and `current_odometer` tests (service record, live reading, provider off) |
| AC-80 | Vitest `tyre-status.test.ts` (pure `currentTyres`) and page test, including partial warning and unknown odometer |
| AC-81 | Vitest queue and overlay tests; Playwright offline create then reconnect, exactly one event on the server |
| AC-82 | Backend test that expenses are untouched; Vitest note on the page |
| AC-83 | Vitest: the prefilled reminder form, nothing saved until Save |
| AC-84 | Vitest: odometer and size prefill |
| AC-85 | Backend 401 over every route and the cap test; Vitest plain-text rendering |
| AC-86 | `test_migrations.py` (apply, re-run, downgrade) and all gates |

## Risks

1. **Current odometer can be stale** when no live reading and no recent service record exist. The page shows the basis, as reminders do.
2. **Current tyres depends on correct wheels.** A Replace logged with the wrong wheels shows the wrong tyre until edited.
3. **Kind list is fixed.** A new kind needs a migration and a contract amendment.
4. **Double entry of cost.** The owner may also log a "Tyres" expense; the two are never linked (T1).
5. **iPhone checks** (installed app, offline) are owner checks, reported as deferred until done.
