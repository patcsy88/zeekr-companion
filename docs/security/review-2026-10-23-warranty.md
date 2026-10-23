# Security review: Warranty slice (FR-6, AC-48 to AC-68)

Date: 2026-10-23. Scope: commits f6cfa57, d02564a, c61c3c2, 6c7154d (backend, web client, offline queue, repo hygiene). Reviewer: Security Engineer. Read-only: no application code, test or migration was changed. Nothing was committed.

## Verdict

No Critical or High finding in the code. The warranty API and web client hold up: auth covers every route, input is strict at both the schema and DB level, there is no raw SQL and no HTML injection sink, and the service worker does not cache API responses. The most important finding is not in code: owner-specific warranty facts are in `docs/research/vehicle-integrations.md` in a PUBLIC repo (SEC-W1). Fix that before the unpushed commits go out. SEC-W3 is a silent-data-loss gap in the offline queue.

Counts: Critical 0, High 0, Medium 2, Low 1, Info 3 (SEC-W1 to SEC-W6).

## Method

- Read the code path end to end: router, service, repository, schemas, models, migration 0004, middleware, error handlers; web `client.ts`, `queue.ts`, `engine.ts`, warranty pages, `AccountMenu`, `db.ts`, `session.ts`, `vite.config.ts`, `infra/Caddyfile`, `csp.spec.ts`.
- Ran dependency audits and secret scans (below).
- Probed the Pydantic schemas directly with hostile payloads, and probed auth ordering with an app instance that had no database.
- Grepped for injection sinks, browser storage, raw SQL, logged values and personal identifiers in tracked files and git history.
- The locking review is by reading only. No concurrency stress test was run.

## Commands run

| Command | Result |
|---|---|
| `npm audit --audit-level=high` (apps/web) | 0 vulnerabilities |
| `npm audit --audit-level=high` (packages/shared-types) | 0 vulnerabilities |
| `.venv/bin/pip-audit` (services/api) | No known vulnerabilities; the local package is skipped (not on PyPI) |
| `gitleaks detect --no-git --source . --redact` | no leaks found (about 5.16 MB scanned) |
| `gitleaks detect --source . --redact` (history) | 48 commits scanned, no leaks found |
| Pydantic probe of warranty schemas | Rejected: extra fields (`status`, `claim_count`, `id`, `source_kind`, `template_ref`, `coverage_id`, `created_at`); NUL in name and description; name over 200, notes over 5000, source_note over 200; km as bool, float or str; odometer as bool or above 10,000,000; negative cost; currency USD; dates before 2000 or after 2200; int as date; future claim date; bad enum; null name on patch; lone surrogate. Valid payloads accepted |
| 401 probe (app with dummy password, no DB) | No token gives 401 before validation, including for an invalid body, bad uuid path and bad query. Template GET gives 401. Malformed JSON with no token gives 400 (see SEC-W6). A 70 KiB body gives 400 |
| Grep: `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `window.open`, `localStorage`, `sessionStorage`, `document.cookie`, raw SQL | None in warranty code. The one `text(` hit is a `server_default` |
| Grep: VINs, plates, home paths, tailnet hostnames, private IPs in tracked files | None, apart from the documented example subnets in `infra/.env.example` and the infra README |
| `git log` author scan | See SEC-W2 |

Not run: the test suites and the OpenAPI drift check (covered by the QA reports).

## Findings

| Id | Severity | Location | Description | Recommendation | Status |
|---|---|---|---|---|---|
| SEC-W1 | Medium | `docs/research/vehicle-integrations.md` O2 and O4 (about lines 115-118); commit bfdcdbd | The file holds owner-specific facts: first registration date, extended warranty plan name and price, signing date, and extension period. The file says personal identifiers are deliberately not recorded, but these are personal ownership facts and could help identify the owner. The repo is PUBLIC (`gh repo view`). The text has been in history since bfdcdbd (2026-10-12). Whether bfdcdbd is already pushed was not checked in detail: remote head `080f9bf` is an ancestor of HEAD and 29 commits behind, so assume these lines may already be public. The warranty plan (`docs/product/warranty-slice-plan.md:5`) says no personal identifier belongs in docs. | Generalise O2 and O4 to "owner has an extended plan, details held privately" before pushing. If bfdcdbd is already public, the data has been exposed. A history rewrite plus force-push limits further spread but does not undo exposure. The owner decides. | Open |
| SEC-W2 | Low | git commit metadata (6c7154d, c61c3c2, e73f7ce) | Three unpushed commits are authored with a personal gmail address. Others use a local machine address (44 commits) or the GitHub noreply address (2). The full name appears in all commits. The three gmail commits are the unpushed warranty commits, so the address is not public yet. | Set `git config user.email` to the GitHub noreply address, and rewrite those 3 commits before pushing if the owner wants to keep the address private. | Open |
| SEC-W3 | Medium | `apps/web/src/pages/CoverageDetailPage.tsx:164-171`; `apps/web/src/storage/queue.ts:516-535` | "Discard my change" on a failed coverage create calls `discardFailedCoverage(id)` and ignores its return value `{droppedClaimCreates}`. Queued claim creates entered against that coverage are deleted with no notice. Coverage delete handles the same situation correctly (`CoverageDetailPage.tsx:124-132`, `WarrantyPage.tsx:32`). The blocked-claim text at `CoverageDetailPage.tsx:39-43` says only "Retry or discard the coverage above". Not confirmed: whether a failed coverage create is easy to reach in practice. | Show the same dropped-claims notice after discard, or confirm before discarding when claims depend on the coverage. | Open |
| SEC-W4 | Low | `apps/web/src/components/AccountMenu.tsx:14-15`; `apps/web/src/storage/queue.ts:105-114` | The "unsent changes" warning on "Sign out and clear local data" counts pending plus failed entries only. `countQueue` reports `blocked` separately, and blocked claim writes are not in the warning. They are deleted by `clearAllLocalData()` (`db.ts:101-109`) without being counted. | Include blocked entries in the warning count. | Open |
| SEC-W5 | Info | `apps/web/e2e/csp.spec.ts` | The CSP e2e does not visit any warranty page. The CSP header, Caddyfile and `vite.config.ts` are unchanged since 2d040b7 (`git diff` empty), and no new script or inline-style sources were added, so the risk is low. `warranty.spec.ts` covers XSS text rendering but not CSP. | Add a warranty page to the CSP spec when convenient. | Open |
| SEC-W6 | Info | `services/api/app/main.py` (body limit and JSON parse before auth) | A client with no token sending malformed JSON gets 400, not 401. A 70 KiB body gets 400. Nothing sensitive is returned, and this matches the existing contract for other routes. Noted because AC-64 says 401 on every route. All schema-level checks (invalid body, bad uuid, bad query) do return 401 first. | Accept, or document the exception under AC-64. | Open |

## Verified clean

| Area | Evidence |
|---|---|
| Authentication on all 11 warranty routes, including the template | Router-level `dependencies=[Depends(require_auth)]` at `routers/warranty.py:31`. 401 probe above. Tests `test_warranty.py:106-135`, `test_warranty_qa.py:98-140` |
| Input validation | `_Input` has `extra=forbid` and a NUL check (`schemas.py:46-55`); warranty schemas at `schemas.py:434-604`; `StrictDate` at 206-215. Probe results above |
| DB constraints back the schema bounds | CHECK constraints in `alembic/versions/0004_warranty.py` |
| Mass assignment | Patch schemas exclude `status`, `claim_count`, `source_kind`, `template_ref`, `coverage_id`. Computed fields exist only on the Out schema. Probe rejected each one |
| Cascade delete | DB-level `ON DELETE CASCADE` (`0004_warranty.py:118-123`) |
| SQL injection | No raw SQL; all queries use SQLAlchemy Core/ORM (`repositories/warranty.py`). `db.py` sets `hide_parameters=True` |
| Concurrency and caps | `pg_advisory_xact_lock` keys 726_003 and 726_004 do not collide with 726_001/726_002 (`repositories/warranty.py:13-14`). Order is coverage `FOR SHARE`, then advisory lock (65-88, 150-180), with no cycle. Cap check (50 coverages, 500 claims) and insert share one transaction. Reading only, no stress test |
| Error handling and info leak | Generic 500 body; traceback goes to the log only (`main.py:99`) with DB parameters hidden. `docs_url`, `redoc_url` and `openapi_url` are None (`main.py:111-113`). No warranty data is logged |
| Request size | 64 KiB cap in `middleware.py` (`BodyLimitMiddleware`, `main.py:126`) and in Caddy (65536) |
| Template endpoint | GET only, static data, no personal data. No apply route (`test_warranty_qa.py:1420`) |
| Template source link | Rendered as plain text, not a link (`WarrantyTemplatePage.tsx:134-137`), so no href or `rel`/`target` concern |
| XSS | No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `window.open`. The only `href` is `#main` (`App.tsx:49`). User text is rendered as React text nodes with a `prewrap` class. E2E uses `<img src=x onerror=alert(1)>` (`warranty.spec.ts:99`) |
| Client path allowlist | `assertContractPath` (`client.ts:70-102`) covers `/warranty-coverages`, `/warranty-claims`, `/warranty-templates`. `{uuid}` forms require `isUuid`; `assertUuid` (`client.ts:104`) plus `encodeURIComponent` in `endpoints.ts:136-137`. Pages check route params with `isUuid` |
| Token handling | Held in memory only (`auth/session.ts:2`). No localStorage, sessionStorage or cookies. Authorization header set at `client.ts:144` |
| Service worker | No `runtimeCaching`; `navigateFallbackDenylist` for `/api/` and `/health` (`vite.config.ts:29-37`). Built `dist/sw.js` has 0 CacheFirst, NetworkFirst or StaleWhileRevalidate routes |
| Local data on sign-out | `clearAllLocalData()` clears cache, queue and meta (`db.ts:101-109`). The queue holds only owner-entered bodies plus metadata |
| Dependencies | `npm audit` and `pip-audit` clean (above) |
| Secrets | gitleaks clean on the working tree and the 48-commit history. `infra/.env.example` secrets are empty |
| Test fixtures | Fictional data (`test_warranty.py:3`, "Sample vehicle warranty") |
| Public contacts in docs | Zeekr support email and phone numbers appear only in `docs/research/vehicle-integrations.md:38`; they are public business contacts |
| Multi-tenant (IDOR) | Not applicable: single owner, no `user_id` column or multi-tenant assumptions in the models |

## Accepted or by design (not findings)

- IndexedDB cache is readable on the device without login (ADR-002, owner decision, not new).
- Rate limiting and `Retry-After` apply to login only. Warranty has no specific limit, which fits single-owner use. Caps are 50 coverages and 500 claims.
- Queue data-loss paths other than SEC-W3 and SEC-W4: deleting a coverage drops its pending claim writes (disclosed by a notice); a never-sent create plus delete cancels both; a DELETE that gets 404 counts as success; an identity mismatch holds the queue rather than dropping it.
- `main.py:95` returns `str(exc.detail)` for generic HTTP errors. 404 and 405 are handled separately. Low confidence this leaks anything, since details come from framework or app code that I read; not traced for every exception type.
- The `claim_count` in coverage views can be briefly stale (separate transaction). Correctness, not security.
- The coverage PATCH-vs-DELETE race (500) is already QA-W2 in `qa-report-2026-10-23-warranty-backend.md`.

## Not reviewed

- Deployment, the production reverse proxy (Caddy as run in production), Tailscale and Tailscale Serve (ADR-003), host firewall and SSH (ADR-004), backup scripts, the Docker image.
- iOS Safari and installed-PWA behaviour (storage eviction, service worker, cache).
- Live database concurrency (no deadlock or race stress test was run).
- The OpenAPI drift check and the full test suites.
- Git history on the remote beyond `gh repo view` visibility and the ancestor check.

## Fixes (2026-10-23)

| Id | Status | Change |
|---|---|---|
| SEC-W3 | **Fixed** | "Discard my change" on a failed coverage create now shows a notice naming how many unsent claims were dropped, and returns to the warranty list when any were. Test: `apps/web/test/warranty-sec.test.tsx` (fails without the fix). |
| SEC-W4 | **Fixed** | The sign-out "unsent changes" count now includes blocked entries. Same test file. |
| SEC-W1 | Fixed going forward (owner chose option A) | O2 and O4 in `docs/research/vehicle-integrations.md` now say the details are held privately. M15 stays: it is public programme and press price information. History is not rewritten, so the earlier text remains in `origin/main`. |
| SEC-W2 | Accepted (owner) | The owner chose to keep the gmail address in commits. |
| SEC-W5, SEC-W6 | Open (Info) | CSP e2e does not visit a warranty page. Malformed JSON with no token returns 400, not 401. |
