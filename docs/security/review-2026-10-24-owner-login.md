# Security review: Owner username/password login (ADR-006)

Date: 2026-10-24. Scope: the UNCOMMITTED ADR-006 working tree (migration 0005, `set_owner`, auth service, schema, web sign-in, infra docs and smoke test). Reviewer: Security Engineer. Read-only: no code, test or migration was changed. Nothing was committed.

## Verdict

No Critical or High finding. The design holds: one generic 401 for unknown user, wrong password and missing account; one scrypt verification on every path; the password never appears in logs, argv (except in the smoke test) or the token; the singleton row is enforced by the database; the upsert is atomic; the web client keeps no credentials in storage. Nothing blocks the redeploy.

Fix before or soon after deploy: SEC-L1 (the lockout can be overshot by a parallel burst), SEC-L2 (a reset does not cut off a stolen token) and SEC-L3 (the first unknown-user login is measurably slower). The rest are hardening or documentation.

Counts: Critical 0, High 0, Medium 0, Low 8, Info 3 (SEC-L1 to SEC-L11).

## Method

Read end to end: ADR-006, the Authentication section of `api-contracts.md`, `services/auth.py`, `security.py`, `schemas.py` (TokenRequest), `models.py` (OwnerAccount), `repositories/owner_account.py`, migration 0005, `cli/set_owner.py`, `routers/auth.py`, `services/rate_limit.py`, `tests/test_owner_account.py`, `SignIn.tsx`, `infra/README.md`, `infra/smoke.sh`. Grepped for leftover `OWNER_PASSWORD_HASH`, browser storage and secrets. No shell was used, so no scanner, test suite or timing measurement was run. Timing statements are from reading the code.

## Findings

| Id | Severity | Location | Description | Recommendation | Status |
|---|---|---|---|---|---|
| SEC-L1 | Low | `services/auth.py:47-63`; `routers/auth.py:17`; `security.py:21` | The limiter is check-then-act. `retry_after` runs at line 47; `record_failure` runs only after the scrypt check (line 60). The endpoint is a sync `def`, so FastAPI runs it in a thread pool. A burst of parallel requests all pass the check before the first failure is recorded. Scrypt is capped at 2 at a time (`_scrypt_slots`), so the burst is slowed, but every request already past line 47 still gets a guess. The guesses per window can therefore exceed `LOGIN_MAX_FAILURES` by roughly the thread-pool size (the default size of 40 is assumed, not confirmed). The waiting threads can also hold the whole pool for several seconds, so other requests stall. | Reserve a slot before verifying: record a provisional failure under the limiter lock, then reset it on success. Or add a small per-process in-flight cap on `login` and answer 429 above it. Add a test with parallel wrong guesses. | Open |
| SEC-L2 | Low | `cli/set_owner.py:1-6`; `security.py:105-111`; `tests/test_owner_account.py:112-118` | A reset does not revoke tokens already issued. They stay valid for up to an hour, and the only remedy is rotating `TOKEN_SECRET` and restarting. This is documented (ADR-006 decision 2, README), but it matters most in the case where the owner resets because they think the password or a token leaked. The `sub` is a constant, so nothing in the token ties it to the credential. | Short term: have `set_owner` print "Tokens stay valid for up to one hour; rotate TOKEN_SECRET to end them now" on every run. Better: put a credential version (the `updated_at` epoch) in the token and compare it on each request with a cached read of the row. Or derive the signing key from `TOKEN_SECRET` plus the password hash. Owner decision; the current behaviour is pinned by a test. | Open |
| SEC-L3 | Low | `services/auth.py:39-44, 54-57` | The dummy hash is built lazily on the first unknown-user or no-account login. That request does one scrypt to build it plus one to verify, so it takes about twice as long as a wrong password for the real user. A prober who sees the API right after a restart can tell that the first unknown name was unknown. Also, the dummy always uses the default cost, while the real hash uses the cost stored in the row. Tests that seed a cheaper hash would not show a mismatch, but after a future cost change the two paths would differ. | Build the dummy hash once at startup, before serving requests. Derive its n, r and p from the stored hash, or re-hash with the same parameters. | Open |
| SEC-L4 | Low | `services/auth.py:58-59`; `security.py:76` | `account.username != username` is a plain comparison, as the review brief noted, and it happens after scrypt. Because of `or` short-circuiting it only runs when the password already verified, so the only timing it could reveal is "right password, wrong name". An attacker who holds the right password has already won. Exploitable in practice: no. | Use `hmac.compare_digest` on the UTF-8 bytes anyway, so the code does not depend on that reasoning. Evaluate all three conditions without short-circuit. | Open |
| SEC-L5 | Low | `services/auth.py:48-50, 55` | Log volume. Every blocked attempt writes a warning (line 49). While no account exists, every attempt that gets past the limiter also writes the `set_owner` warning (line 55), up to the failure limit per window. Blocked requests are unbounded in rate: an attacker on the tailnet can fill the log at the proxy's speed (64 KiB body cap). The warnings carry the client address and the retry time only, no secret, so this is a flooding concern, not a leak. Whether Compose sets log rotation was not confirmed. | Log the first block per window at warning and count the rest. Log the no-account warning once at startup plus once per window. Confirm `json-file` rotation in Compose. | Open |
| SEC-L6 | Low | `cli/set_owner.py:23-45` | Hardening gaps. (a) There is no maximum length, but login accepts at most 1024 characters (`schemas.py:99`), so a longer password is stored and can never sign in. (b) Length is counted in characters, with no check that the password differs from the username and no common-password check. (c) Ctrl-C, EOF, a missing `TOKEN_SECRET` or a DB error ends in a traceback; the exit code is still non-zero, but the message may print settings validation input. That was not traced. (d) The `existed` read and the upsert are not atomic, so the "created/updated" message can be wrong on a race. This is cosmetic. Verified good: the password comes from `getpass`, never argv; it is checked before any DB access; it is never printed; the stored value is `scrypt:` with a random salt; a bad input returns 1 and changes nothing (`test_owner_account.py:228-248`). | Reject passwords over 1024 characters. Reject a password equal to the username. Catch `EOFError`, `KeyboardInterrupt` and DB errors and exit with a short message. Use distinct exit codes (1 input, 2 environment or DB). | Open |
| SEC-L7 | Low | `alembic/versions/0005_owner_account.py:33-36`; `security.py:83-90`; `models.py:60-63` | The database CHECK uses PostgreSQL `lower(username)`, while the application uses Python `str.lower()`. They differ for some non-ASCII characters and depend on the database locale. A username that Python accepts can then fail the CHECK, and `set_owner` ends in an `IntegrityError` traceback. It fails closed. There is also no Unicode normalisation (NFC or NFKC), so two forms of the same visible name are different. That is usability, not an exploit. | Restrict usernames to ASCII letters, digits and `._-` in `normalise_username`, and mirror it in the CHECK (`username ~ '^[a-z0-9._-]{3,64}$'`). | Open |
| SEC-L8 | Info | `security.py:43-51, 67`; `services/auth.py:57` | `password_hash` has no format CHECK. A malformed value (for example one written by hand) makes `_parse_hash` raise `ValueError` inside `login`, which is a 500, not a recorded failure. Only someone with database write access can cause it, so it is not an attack. | Add `CHECK (password_hash LIKE 'scrypt:%')`, or catch `ValueError` in `login` and treat it as a failure plus an error log. | Open |
| SEC-L9 | Low | `infra/smoke.sh:19, 51` | The throwaway password is passed as an argument to `compose exec`, so it is visible in the host process list (`docker compose exec ... "$user" "$pass"`) and in the container's process list while the command runs. The same applies to the `curl -d` bodies at lines 68, 102 and 116, which hold the wrong password only. The password is `smoke-test-password-$RANDOM` (about 15 bits), used for a stack that is destroyed on exit, and the script says it never touches the real project. The risk is low but it teaches a bad pattern, and the script is the template for operator commands. | Pass it through the environment (`compose exec -T -e SMOKE_PW ...` with `os.environ`) or on stdin. Use `/dev/urandom` for the password like the other secrets in the file. | Open |
| SEC-L10 | Info | `services/auth.py:65`; `infra/README.md:16, 139` | Lockout trade-off, accepted by the owner (ADR-006 decision 6). With Tailscale Serve every request has one client address, so the per-client bucket and the global bucket are effectively one: 5 failures per 15 minutes blocks everyone, including the owner. Anyone on the tailnet can therefore lock the owner out by failing 5 times. Without per-account lockout, the only effect of the username is that it must also be guessed. Two side effects: a successful login calls `reset(client)` (line 65), which clears the shared failure count, so failures interleaved with the owner's real logins are forgiven (the global bucket, at 4 times the limit, is not reset and is the real ceiling); and the per-account design correctly avoids an attacker locking the owner out by naming the account. Net: acceptable for a tailnet-only, single-owner app with a 12+ character password. | None required. Note the global ceiling (20 per 15 minutes) in the ADR. | Accepted |
| SEC-L11 | Info | `docs/operations/deploy-plan.md:38, 96, 113` | Stale-looking references to `OWNER_PASSWORD_HASH`. They are intentional (the host still runs the old build), but the redeploy needs an ordered note: run migrations, run `set_owner`, then remove the variable. Until `set_owner` runs, every sign-in returns 401. `.env.example` could not be confirmed free of the variable, because my grep may skip hidden files. | Add a numbered redeploy checklist. Check `infra/.env.example` by hand. | Open |

## Points from the brief, with the answer

1. **Timing, unknown vs wrong password.** Both paths do one DB read and one scrypt at default cost. The username compare happens after scrypt and only when the password verified (SEC-L4). The one measurable gap is the first lazy dummy build (SEC-L3).
2. **Enumeration.** Status (401), body and message are identical for unknown user, wrong password and no account (`test_owner_account.py:46-50, 89-101`). Unknown names count towards lockout (`:82-86`). The 400 for a malformed username only reveals the format rules. The server never logs the submitted username (`:70-79`). Whether the 400 body echoes the input value was not traced.
3. **Lockout.** Still effective and tested, but it can be overshot by a parallel burst (SEC-L1). Trade-off of no per-account lockout: see SEC-L10.
4. **No-account warning.** No identifier or secret is logged. Flooding: SEC-L5.
5. **`set_owner`.** See SEC-L6. Password handling is correct.
6. **DB constraints and upsert.** The `singleton` bool with a CHECK and a UNIQUE constraint allows exactly one row (`0005:32-38`; tested at `test_owner_account.py:136-148`). `INSERT ... ON CONFLICT (singleton) DO UPDATE` (`repositories/owner_account.py:24-27`) is atomic, so two concurrent `set_owner` runs cannot create two rows or fail: the last one wins and `created_at` is kept. Gaps: SEC-L7, SEC-L8.
7. **Token lifetime after a reset.** SEC-L2.
8. **Web.** `SignIn.tsx` is correct: `autoComplete="username"` and `"current-password"` (lines 44, 63), `type="password"`, `autoCapitalize/Correct/spellCheck` off, the password state is cleared after login (line 21), the token is in module memory only (`auth/session.ts:2`; no `localStorage`/`sessionStorage` in `src`), and a 401 shows the generic "Wrong username or password." (line 25). 429 shows the retry message (`api/errors.ts:18`). The error text does not distinguish the cases.
9. **Secrets in the repo.** None found in the files read. Test constants are fixtures (`tests/conftest.py:28-29`), and the smoke username is a placeholder. gitleaks was not run (no shell).
10. **smoke.sh argv.** SEC-L9.

## Verified clean

| Area | Evidence |
|---|---|
| Single generic error for all failure causes | `services/auth.py:59-63`; test `test_owner_account.py:46-50` |
| One scrypt per login on every path | `services/auth.py:56-57`; test `:53-67` |
| Constant-time hash compare | `hmac.compare_digest` at `security.py:76` |
| Password not logged | `auth.py:49, 62, 67` log client and counts only; test `:70-79, 89-101` |
| Password not in argv for `set_owner`, not echoed, not stored in clear | `cli/set_owner.py:29-33, 41`; tests `:219-225`, `:199-216` |
| Stored hash uses default cost, random salt | `security.py:35`; test `:209` |
| Request schema strict | `TokenRequest` has `extra=forbid`, length bounds, no stripping of the password (`schemas.py:94-104`); NUL and control characters rejected (`security.py:88`) |
| No signup or account-changing endpoint | `routers/auth.py` has only `POST /token` |
| Token has no username | `security.py:107-109`; test `test_owner_account.py:121-125` |
| Memory ceiling on scrypt | `_scrypt_slots` limits parallel hashes to 2 (`security.py:21`) |
| Limiter memory bound | `_MAX_TRACKED_KEYS` pruning (`rate_limit.py:11, 48-50`) |

## Accepted or by design (not findings)

- No per-account lockout (owner decision; see SEC-L10).
- Lockout state is lost on restart and is per process.
- Tokens are not revoked on reset (documented; improvement proposed in SEC-L2).
- A username is not a secret.

## Not reviewed

- Timing was not measured; no test suites, pip-audit, npm audit or gitleaks were run (no shell).
- Whether error bodies echo the submitted value (`main.py` validation handler was not read).
- `infra/.env.example`, `docker-compose.yml`, the entrypoint and Compose log settings.
- Web `api/client.ts` and `api/endpoints.ts` beyond the `login` signature, and the sign-out path.
- Deployment, Tailscale, host firewall, backups (backup contents now include the password hash).
- Thread-pool size and real concurrency behaviour under load.

## Resolution (2026-10-24)

Fixed: SEC-L3 (dummy hash built at startup), SEC-L4 (`hmac.compare_digest`), SEC-L6 (maximum length, password equal to username refused, clean exit on Ctrl-C or EOF), SEC-L7 (usernames restricted to ASCII), SEC-L9 (`smoke.sh` sends the throwaway credentials on stdin and uses a random password), SEC-L2 (partly: `set_owner` now says that signed-in sessions last up to an hour and how to end them; revoking them automatically is not built).

Accepted by design, to be confirmed by the owner: SEC-L1 (a burst of parallel guesses can overshoot the lockout by a few attempts; the global limit still caps it), SEC-L5 (log volume under attack; no secrets or usernames are logged), SEC-L8 (needs database write access), SEC-L10 (no per-account lockout; one shared bucket behind Tailscale Serve).

SEC-L11 is handled in the deploy plan as an ordered redeploy checklist.

Verification after the fixes: API tests 1643 passed, 5 xfailed; ruff, format and mypy clean; `infra/smoke.sh` passed (59, 1 skip); gitleaks clean.
