# ADR-013: Second factor for the owner login (authenticator-app code, with QR setup)

- Status: **Proposed, not approved. No code written.** The owner chose the method on 2026-11-06 ("MFA with Google Authenticator with QR"). Every other point below is the architect's proposal and needs the owner's decision where listed under "Open questions".
- Date: 2026-11-06
- Amends (once approved): the "Authentication" section of `docs/architecture/api-contracts.md`. Builds on ADR-006.
- Related: ADR-003 (a passkey was discussed and set aside for now, see "Options considered").

## Context

Sign-in is a username and a password (ADR-006). A correct pair returns a one-hour Bearer token kept in memory (`services/api/app/services/auth.py`). ADR-006 calls the username "a weak second factor only". Failed logins are limited per client address and globally, in memory.

The host publishes `0.0.0.0:8080` with no firewall (owner decision), so on the network the password is the only barrier. A second factor protects against a guessed, reused or leaked password. It does not protect against a stolen, still-valid token: tokens last one hour and are unchanged by this ADR.

Facts checked in the repo on 2026-11-06:

- **confirmed** The API has no TOTP, QR or encryption library. `pyproject.toml` lists `fastapi`, `uvicorn`, `sqlalchemy`, `alembic` and `psycopg`, among others; `pyotp`, `qrcode` and `cryptography` are not installed in the venv.
- **confirmed** Passwords use scrypt from the standard library (`app/security.py`). `app/cli/set_owner.py` is the model for a setup command.
- **confirmed** The next migration follows head `0015`.

## Decision (proposed)

1. **Method: time-based one-time password (TOTP, RFC 6238)**, read by Google Authenticator and any compatible app. Parameters Google Authenticator supports: SHA-1, 6 digits, 30-second step. **Owner chose this method.**
2. **Code on every login, once MFA is set up.** No "trust this device". The second step comes after a correct password.
3. **Setup and reset are server commands, as `set_owner` is.** There is no endpoint that turns MFA on, off or resets it, so a stolen token cannot change it. Proposed command name: `python -m app.cli.set_mfa` (**proposed, not found in the repo**).
4. **QR code is shown in the terminal by the setup command only.** It is never served over HTTP, never written to a file, and never logged. The command also prints the secret as text, as a fallback for an app that cannot scan.
5. **Setup confirms before it saves.** The command asks for a current code from the app, and stores the secret only if the code is right. A bad scan therefore cannot lock the owner out.
6. **Recovery codes.** Setup prints 8 one-time recovery codes once and stores only their hashes. Each works once, in place of the app code. They are the way back in if the phone is lost; the other way is the server reset command.
7. **Replay protection.** The database keeps the last accepted time step; a code for that step or an earlier one is refused. The server accepts the current step and one either side, for clock drift.
8. **Lockout.** A wrong or missing code counts as a failed login in the existing per-client and global limiters, so the 5-in-900-seconds hard lockout covers it. Nothing new is added to lockout.
9. **No new information to an attacker.** A correct password with a wrong, missing or reused code returns the same `401 unauthenticated`, "Invalid credentials.", as a wrong password. Failed attempts log the client address and the failure count only, never the password, the username or the code.
10. **Storage.** A new table holds the secret, the last accepted step and the recovery-code hashes. The secret is stored as-is in the database (see "Open questions" 1). The database export is already encrypted at rest. The secret is never logged, never returned by the API, and never put in the repo.
11. **QR library: `segno`.** It draws the QR as terminal text. Facts from PyPI on 2026-11-06: version 1.6.6, BSD licence, no runtime dependencies on Python 3.10 and newer, last release 2025-03-12. **This is a new dependency and needs the owner's approval.** `pip-audit` runs on it with the other gates. The TOTP calculation itself uses the standard library (`hmac`, `hashlib`, `struct`) and is checked against the RFC 6238 test vectors.
12. **Web form.** The sign-in form always shows a "Code" field. It is labelled so it is clear it is needed only when MFA is set up. Showing it always means the form never has to ask the server whether MFA is on, which would tell an attacker.

## Proposed contract amendment (not yet applied to `api-contracts.md`)

`POST /api/v1/auth/token`

- Request: `{ "username": "string", "password": "string", "code": "string (optional)" }`
  - `code`: trimmed. Either 6 digits (the app code) or a recovery code. Absent or empty is allowed by the schema and is treated as "no code supplied".
- Response `200`: unchanged, `{ "access_token": "string", "expires_in": 3600 }`.
- Response `401 unauthenticated`: also returned when MFA is set up and the code is missing, wrong, expired or already used.
- Response `429 rate_limited`: unchanged; wrong codes count toward it.
- With MFA not set up, a supplied `code` is ignored and the old behaviour is unchanged. No other endpoint changes.
- Validation errors stay `400 validation_error`, never `422`.

## Options considered

- **A. Authenticator-app code (TOTP) with QR (chosen by the owner).** Works over plain HTTP today, no outside service.
- **B. Passkey (WebAuthn).** Stronger against phishing, but browsers allow it only over HTTPS, on a real domain name, never an IP address. The app is plain HTTP on an address today, and Tailscale Serve is deferred (ADR-003). It also needs a new dependency and an iPhone check. Set aside until HTTPS exists; it could be added later next to TOTP.
- **C. Code by SMS or email.** Needs an outside service (approval gate) and is weaker. Rejected.
- **Secret storage.** _Plain in the database (proposed)_: simple, reset is a command with no restart. _Host `.env`_: never in the database, but a change needs an edit and a restart. _Encrypted in the database_: best, but needs the `cryptography` package, another new dependency.
- **QR without a library.** Writing a QR encoder by hand is error-prone. Rejected.

## Consequences

- **Locked out if the phone is lost.** Recovery codes or the server reset command are the only ways in. Keep the recovery codes off the phone.
- **Clock matters.** The host clock must be right, within about 30 seconds. NTP on the host is **unverified**.
- **A stolen unexpired token is not stopped** by this change.
- **Needs a migration**, so a fresh encrypted export is required before deploy. The migration adds one table and changes no existing data.
- **Tokens issued before MFA is turned on stay valid** until they expire (one hour), as with a password reset in ADR-006. Rotating `TOKEN_SECRET` ends them at once.
- **A real code from the owner's phone is needed to prove it works.** The agent cannot check the Google Authenticator side; the owner reports that result.

## Work after approval (in this order)

1. Apply the amendment to `api-contracts.md` and update `docs/`.
2. Migration, model, repository, TOTP functions with RFC 6238 test vectors.
3. Auth service change, schema change, lockout wiring, `set_mfa` command.
4. Web sign-in form and its tests (unit and e2e).
5. Tests: right code, wrong code, missing code, reused code, clock drift, recovery code used once, lockout, MFA off unchanged, nothing logged.
6. A security review in `docs/security/`, then the full quality gates.
7. Owner-run deploy: fresh encrypted export, `git pull`, `docker compose up -d --build --wait`, then the setup command, then a real sign-in with the phone.

## Not verified

- That the `segno` terminal QR scans reliably in the owner's terminal (font and size). The text secret is the fallback.
- That Google Authenticator accepts the generated `otpauth://` link. Proven only when the owner scans it.
- The host clock accuracy.
- The `segno` dependency: licence and maintenance were read from PyPI metadata only.

## Open questions for the owner

1. **Secret storage:** plain in the database (proposed), host `.env`, or encrypted with a new `cryptography` dependency?
2. **Approve `segno`** as a new dependency?
3. **Mandatory once set up, every login, no trusted devices** (proposed)?
4. **Approve the contract amendment** above, and approve implementation.
