# ADR-006: Owner account with username and password login

- Status: **Proposed** (owner chose the account model, Option B, on 2026-10-22; the details below need owner approval, then a contract re-approval, before any code)
- Date: 2026-10-23
- Amends: the "Authentication" section of `docs/architecture/api-contracts.md` and the `OWNER_PASSWORD_HASH` setting (ADR-001 stack, `infra/.env.example`)

## Context

Today the API has one secret, `OWNER_PASSWORD_HASH`, set in the environment. `POST /api/v1/auth/token` takes `{ "password" }` and returns a one-hour Bearer token. The web client keeps that token in memory only. Failed logins are limited per client address and globally, in memory, per process.

The owner chose Option B: still one owner and no registration, but login uses a **username and a password**. Password reset is a **server command**. The session stays a one-hour, memory-only Bearer token. Lockout is per account and per client address.

Nothing is deployed yet, so no existing login needs migrating.

## Decision (proposed)

1. **One owner account, stored in the database.** A single-row table `owner_account` holds `username`, `password_hash` (the existing scrypt format) and `updated_at`. A database constraint allows at most one row. There is no signup endpoint and no endpoint that creates or changes the account.
2. **Server commands manage the account.** `python -m app.cli.set_owner` creates the account, or resets the username and password if one exists. It prompts for the password (never as an argument, so it stays out of shell history and process lists). Reset takes effect on the next login without a restart. It does not revoke tokens already issued; they expire within one hour. Rotating `TOKEN_SECRET` and restarting revokes them at once.
3. **`OWNER_PASSWORD_HASH` is removed** from settings, `.env.example`, Compose and the README. `TOKEN_SECRET` stays. If no account exists, `POST /auth/token` returns the same `401 unauthenticated` as a wrong login, and the API logs a warning telling the operator to run `set_owner`.
4. **Login request** becomes `{ "username": "string", "password": "string" }`. The response is unchanged. This breaks the old password-only request; the web client and the contract change together.
   - `username`: trimmed, 3 to 64 characters, no control characters or NUL, compared case-insensitively (stored lower-case).
   - `password`: unchanged rules (1 to 1024 characters on login). `set_owner` requires at least 12 characters.
5. **No account enumeration.** An unknown username and a wrong password return the same `401` with the same message. For an unknown username the server still runs one scrypt verification against a dummy hash, so timing does not reveal which usernames exist.
6. **Lockout stays a hard lockout, in memory.** Keys:
   - per client address (as today),
   - per account (new): a limit on failures for the username, counted for unknown usernames too, so locking behaves the same either way,
   - global (as today, 4 times the per-client limit).
   A blocked attempt is refused with `429 rate_limited` even with the right password, as the contract already says.
7. **Token claims.** `sub` stays `owner`. No username goes into the token.
8. **Logging.** Log the client address and the failure count. Never log the password. The submitted username is not logged for failed logins, because people sometimes type a password into the username field.

## Options considered

- **A. Keep the password-only login (status quo).** Simplest. Rejected by the owner.
- **B. Owner-only username and password (chosen by the owner).** One account, no registration.
- **C. Multiple users with roles.** Not needed for a one-owner app; adds registration, ownership of data and an admin surface. Out of scope. It would be a scope expansion and needs approval.
- **Where to store the account.** *Environment variables* (`OWNER_USERNAME`, `OWNER_PASSWORD_HASH`) need no migration, but a reset means editing a secrets file and restarting. *Database row (proposed)* makes reset one command with no restart, and needs migration `0005`. Either meets the owner's "reset is a server command". If you prefer fewer moving parts, the environment option is a smaller change.

## Consequences

- **Lockout can be used against the owner.** Anyone who can reach the API and knows or guesses the username can fill the per-account limit and lock the owner out for the window (15 minutes by default). The global limiter already has this property. Per-account lockout adds protection against a slow guessing attack spread over many addresses, but makes this lock-out easier to cause. The Security Engineer is asked to confirm per-account lockout is worth building. The fallback is to keep only per-client and global limits and rely on the username being a second secret. Because the app is reachable only over the tailnet (ADR-003), the exposure is small either way.
- The username is a weak second factor only; it is not secret.
- The lockout state is lost on restart (unchanged from today). Acceptable for one owner behind the tailnet.
- Work needed after approval: migration `0005`, `set_owner` command, auth service and schema changes, `POST /auth/token` contract section, web login form, tests (unknown user, wrong password, timing path taken, lockout per account, reset, no-account state), infra docs and `.env.example`, a security review.
- Not changed: token lifetime, memory-only token, Bearer scheme, the 401 and 429 shapes, every other endpoint.

## Open questions for the owner

1. Approve storing the account in the database (proposed) rather than the environment?
2. Minimum password length of 12 on `set_owner`: accept?
3. Per-account lockout: build it, or keep only per-client and global limits? (The Security Engineer's view will be added before you decide.)
4. Sequence: build this after the remaining MVP items and the deploy plan, as agreed on 2026-10-22?
