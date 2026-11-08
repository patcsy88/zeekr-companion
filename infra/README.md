# infra

Docker Compose stack: `db` (PostgreSQL), `api` (FastAPI) and `web` (Caddy: static client + reverse proxy). Step-by-step deploy and configuration: `docs/operations/deploy-guide.md`. A one-file install from published images (`docker-compose.release.yml`, ADR-012) is described there too; it is not run yet.

```
./install.sh              # creates .env with random POSTGRES_PASSWORD and TOKEN_SECRET (or: cp .env.example .env and fill them in)
docker compose up -d --build --wait
docker compose exec api python -m app.cli.set_owner    # create the owner login (prompts)
docker compose exec api python -m app.cli.set_mfa      # optional: authenticator-app code at sign-in (ADR-013)
```

- Only `web` publishes a port: `${WEB_BIND_ADDRESS:-127.0.0.1}:${WEB_PORT:-8080}`. Never default it to `0.0.0.0`. `api` and `db` have no `ports`.
- **Owner-approved exception (2026-11-03), ended 2026-11-08:** the owner's host had `WEB_BIND_ADDRESS=0.0.0.0` so the iPhone could reach the app over plain HTTP on the private network. Since 2026-11-08 (owner-reported) it is `127.0.0.1` again and the phone uses HTTPS through the Tailscale sidecar, so the `docker port` and `ss` checks below should pass on that host too.
- `web` forwards `/api/*` and `/health` to `api:8000`; everything else is static files from `/srv/web` with fallback to `index.html`.
- **The web image:** `infra/web.Dockerfile` (build context is the repository root) runs `npm ci` and `npm run build` in `apps/web`, runs `check-dist.sh` on the result, and copies it with the `Caddyfile` and `snippets` into a Caddy image. Nothing is mounted from the host, so there is nothing to build or copy by hand. `VITE_SENTRY_DSN` is read at image build time. `WEB_DIST_DIR` is no longer used. `infra/web-placeholder` is no longer used by the stack or by `smoke.sh` (left in place, not deleted).
- **Headers** (`Caddyfile`): CSP, `nosniff`, `Referrer-Policy: no-referrer` on every response; `no-cache` on `index.html`, `sw.js` and fallback routes; `no-store` on `/api/*`; request body cap 64 KiB (answered as `400 validation_error`, matching the API).
- **HSTS** is off. `WEB_HSTS=on` adds `Strict-Transport-Security` (30 days). Owner decision (ADR-003): keep it off. TLS is not handled here: Tailscale Serve on the host terminates HTTPS and proxies to the loopback port.
- **Client address / login rate limit:** the proxy has a fixed address (`WEB_PROXY_IP` in `WEB_SUBNET`). `api` starts uvicorn with `--proxy-headers --forwarded-allow-ips $FORWARDED_ALLOW_IPS`, set to that address only. The entrypoint refuses `*`. Caddy overwrites any client-sent `X-Forwarded-For`. Behind host `tailscale serve` the API sees the Docker bridge gateway of the `edge` network (observed `172.18.0.1` on Docker Desktop) for every request: one shared login bucket, by owner decision. `FORWARDED_ALLOW_IPS` does not change.
- **Tailscale headers:** Caddy deletes every `Tailscale-*` request header (identity headers carry the account email) before any handler. `infra/smoke.sh` proves it against an echo upstream; the API ignores and never logs them (`services/api/tests/test_tailscale_headers.py`).
- **Networks:** `backend` is `internal: true` (no route out) and holds `db`, `api` and `web`; `edge` holds `web` (and the optional `tailscale` sidecar) and carries the published port; `egress` holds only `api` and gives it a route out for the optional hosted advisory model and tracing (ADR-008 step 4, owner decision 2026-10-30; nothing is published from it and `db` is not on it). `web` is on `backend` and `edge`, `api` on `backend` and `egress`.
- **Post-build check:** the web image build runs `infra/check-dist.sh ../apps/web/dist` and fails if `dist` has no `index.html`, or contains dotfiles or `.map` files. The proxy also answers 404 for any path with a dotfile segment or ending `.map`. `infra/smoke.sh` always tests the real built client and fails if `/` is the placeholder.
- **CSP** also has `form-action 'self'` and `connect-src 'self' https://*.sentry.io` (the only outbound allowance, for optional error reporting, ADR-007; nothing is sent unless a DSN is set). `Permissions-Policy` denies camera, microphone, geolocation, payment and USB, and `Cross-Origin-Opener-Policy: same-origin` is set; the real build was loaded in Chromium under these headers and signed in with no violations.
- **`Cache-Control` on `/api/*`:** the API sets `no-store`; Caddy adds it only if the response lacks one, so it is never duplicated.
- **Trusted proxies:** `FORWARDED_ALLOW_IPS` must be single addresses or networks no wider than IPv4 /24 or IPv6 /120; `0.0.0.0`, `0.0.0.0/0`, `::/0` and `*` stop the container at start (exit 64).
- **Low-memory overlay:** `docker-compose.lowmem.yml` is for a 512 MB host (for example a Raspberry Pi Zero 2 W). It tunes PostgreSQL, sets memory limits and `PASSWORD_HASH_CONCURRENCY=1`. Turn it on with `COMPOSE_FILE=docker-compose.yml:docker-compose.lowmem.yml` in `.env`. Swap or zram is still required. Measurements and steps: `docs/operations/deploy-guide.md`, "On a 512 MB host".
- **Smoke test:** `infra/smoke.sh` (unique project name, throwaway env and secrets, removes everything it created; never touches `zeekr-companion_pgdata`).
- **Backups:** `infra/backup/` has the `pg_dump` script, systemd timer/service templates and the restore procedure (ADR-004: a second local disk or external USB drive mounted at a fixed path on the Ubuntu host, no cloud/paid service). See `infra/backup/RESTORE.md` for the restore walkthrough, which is explicitly marked unverified end-to-end pending a real-host test.
- **macOS/Docker Desktop note:** `docker compose build` (and therefore `infra/smoke.sh`) can fail with `docker-credential-desktop: executable file not found in $PATH` unless `/Applications/Docker.app/Contents/Resources/bin` is on `PATH`. This is specific to macOS with Docker Desktop, not a universal requirement.

## Owner runbook: private HTTPS with the Tailscale sidecar (chosen 2026-11-08)

The owner chose the sidecar on 2026-11-08 (ADR-003 amendment). It **replaces steps 4 and 7** of the host runbook below. Steps 0 (machine name), 5 (no public port, but with no host Tailscale), 6 (header check) and the rate-limit note still apply. Placeholders only: never write the real tailnet name, machine name, account email or auth key in this repo. Nothing here has been run on the host or the Pi.

1. **Admin console first:** enable MagicDNS, pick the tailnet DNS name (randomized option), enable HTTPS certificates, and confirm the policy has no `funnel` attribute (step 0 and ADR-003).
2. **`infra/.env`:** add `COMPOSE_PROFILES=tailscale` and `TS_HOSTNAME=<neutral-name>` (no `zeekr`, personal name, plate or city; it is published in Certificate Transparency logs). Leave `TS_AUTHKEY` empty to log in through a link, or paste a one-off auth key there (see below).
3. **Start it** from `infra/`: `docker compose up -d --wait` (add `--build` on a clone that builds its images, as usual). The `tailscale` service comes from `docker-compose.yml` (or `docker-compose.release.yml`).
4. **Log in (no key):** `docker compose logs tailscale` prints a login URL. Open it in a browser signed in to your Tailscale account. Do not paste the URL anywhere. Until then, `docker compose ps` shows `tailscale` as unhealthy, and `--wait` may time out. That is expected on the first run; run `docker compose up -d --wait` again after logging in. With a key, the login happens by itself. Then delete the key from `.env`: the `tailscale_state` volume keeps the login.
5. **Admin console:** on the new machine, disable key expiry, and set the policy so that only the phone reaches it on `tcp:443`.
6. **Check:** `docker compose exec tailscale tailscale serve status` must say **available within your tailnet** and show a proxy to `http://web:8080`. `docker compose exec tailscale tailscale funnel status` must show nothing. If anything says "on the internet", stop the service (`docker compose stop tailscale`) and check the policy.
7. **Header check and phone:** as in step 6 below (`ORIGIN=https://<name>.<tailnet>.ts.net infra/check-https-origin.sh` from a tailnet device, then the phone on cellular).
8. **Close the plain HTTP port:** once the phone works over HTTPS, set `WEB_BIND_ADDRESS=127.0.0.1` in `infra/.env` and run `docker compose up -d --wait`. This ends the `0.0.0.0` exception.

- **Auth key (optional):** create a one-off key in the admin console (Keys page): not reusable, not ephemeral. It is a secret: keep it only in `infra/.env` and never paste it. It is needed only for the first login.
- **Never delete the `tailscale_state` volume casually.** Without it the container is a new machine (a new name in the CT logs if you reuse the name, and a new login). Never run `docker compose down --volumes`.
- **Back out:** `docker compose stop tailscale`, remove `COMPOSE_PROFILES=tailscale` from `.env`, and remove the machine in the admin console.
- **Updating Tailscale:** change the image tag in both compose files (they must stay in step: `infra/check-release-compose.sh`).
- **Rate limit:** the API sees the sidecar's address for every request: one shared login bucket, as before.

## Owner runbook (previous design, not used): private HTTPS with Tailscale Serve on the Ubuntu host

Placeholders only. Never write the real tailnet name, machine name, account email or device names in this repo. Design and decisions: `docs/architecture/decisions/ADR-003-remote-access-tailscale.md`. Items marked **(unverified)** were not run by the engineer; check them with `tailscale serve --help` on your version. Source for `serve` syntax: Tailscale "tailscale serve command" page, last validated Jan 2026.

### 0. Before anything else: the machine name

> **WARNING.** The certificate Tailscale issues is recorded in public Certificate Transparency logs **with the machine name**, and a name already issued stays there. Before the first `tailscale serve`, check the machine name is neutral (for example `app-1`): no `zeekr`, no personal name, no registration, no city. The machine has not been renamed yet. Rename it in the admin console (Machines page) and confirm with `tailscale status`; also choose the tailnet DNS name before enabling HTTPS certificates. Both become permanent once the PWA is installed on the phone (the origin is `https://<host>.<tailnet>.ts.net`).

### 1. Secrets (two, kept only in `infra/.env`, which is gitignored) and the owner login

```
cd infra && cp .env.example .env
python3 -c "import secrets; print(secrets.token_urlsafe(24))"   # POSTGRES_PASSWORD
python3 -c "import secrets; print(secrets.token_urlsafe(48))"   # TOKEN_SECRET
```

Paste each value into `infra/.env`. The owner login is not a secret in `.env`: once the stack is up (step 3), create it with `docker compose exec api python -m app.cli.set_owner`. It prompts for a username (3 to 64 characters, not case-sensitive) and a password (at least 12 characters, typed twice, never echoed or stored in plain text). Run the same command to reset a forgotten password; it takes effect on the next sign-in with no restart. Tokens already issued stay valid for up to an hour; to end them at once, change `TOKEN_SECRET` and run `docker compose up -d`. Until `set_owner` has run, every sign-in returns 401 and the API log says so. Leave `WEB_BIND_ADDRESS=127.0.0.1`, `WEB_PORT=8080`, `WEB_HSTS=off`.

### 2. The client

Nothing to do. The web image builds the client itself in step 3 (see "The web image" above).

### 3. Start the stack and check it locally

```
cd infra && docker compose up -d --build --wait
curl -s http://127.0.0.1:8080/health          # {"status":"ok"}
docker port zeekr-companion-web-1             # must show 127.0.0.1:8080 only, never 0.0.0.0
./smoke.sh                                    # optional; uses its own throwaway project
```

### 4. Publish to the tailnet only

Tailscale on the host is installed from the official Tailscale apt repository (follow Tailscale's Ubuntu install instructions) and runs as a systemd service: `sudo systemctl enable --now tailscaled`, then `sudo tailscale up` to sign in (ADR-004; plain CLI/systemd, no plugin) **(unverified on the owner's host)**.

```
tailscale serve --bg --https=443 http://127.0.0.1:8080     # (unverified on your version)
tailscale serve status
tailscale funnel status
```

- `serve status` must say the site is available **within your tailnet** and proxies to `http://127.0.0.1:8080`.
- `funnel status` must show nothing / off. If anything is listed as available on the internet, run `tailscale funnel reset` **(unverified)** and `tailscale serve reset` and stop. Never run `tailscale funnel 443`. Also check the tailnet policy has no `funnel` node attribute.
- Serve only supports `http://127.0.0.1` as a proxy target (documented).
- `--bg` keeps Serve across reboot and `tailscale down`/`up` (documented).
- The interactive flow may offer to change the tailnet policy or enable HTTPS certificates: read the prompt, say yes only to certificates, and re-check the policy afterwards.

### 4a. Host firewall (ufw)

On a plain Ubuntu host nothing is pre-configured, so `ufw` is the explicit host firewall layer (ADR-004). The owner has decided: Ubuntu Server **24.04 LTS**, and SSH is reachable from the **LAN subnet only** (not from the tailnet, not from the public internet, not disabled). The architecture does not change: `web` still only publishes `127.0.0.1:${WEB_PORT:-8080}` (loopback only), and remote access is still exclusively through Tailscale Serve (step 4), which terminates HTTPS in `tailscaled` and proxies to that loopback port. None of the commands below were run or tested on a real host; everything in this step is **(unverified; owner must test on the real host)**.

Replace `<lan-subnet>` with the real LAN subnet in CIDR form (e.g. `192.168.1.0/24`); never write the real subnet in this repo.

```
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <lan-subnet> to any port 22 proto tcp
```

- **Do not** add a `ufw allow` rule for port 8080 or 443, to the LAN or to anywhere. The app is reached only through Tailscale Serve: Serve terminates HTTPS in `tailscaled` on the `tailscale0` interface and proxies to `127.0.0.1:8080` (ADR-003), a loopback address that is never reachable from another host's network interface, so no inbound `ufw` rule should be needed for it. **(unverified; owner must test on the real host)** — Tailscale's own setup guidance for some platforms recommends explicitly allowing the `tailscale0` interface when a default-deny firewall is enabled, in case the daemon itself (not just the loopback-bound proxy target) needs an inbound allow to accept tailnet traffic on `tailscale0`. If step 6 (header check) or the phone smoke test fails after `ufw enable`, check `sudo ufw status verbose` and `tailscale serve status` first, and only then consider adding an explicit allow for the `tailscale0` interface (e.g. `sudo ufw allow in on tailscale0`) **(unverified; not a default part of this ruleset, add only if Serve traffic is observed to be blocked)**.
- Enable and confirm:

  Before running this, keep a local console or KVM session open as a fallback in case a typo in `<lan-subnet>` locks out SSH access with no other way in.

```
sudo ufw enable
sudo ufw status verbose
```

  Expected (**unverified; owner must test on the real host**): default incoming is `deny`, default outgoing is `allow`, and the only listed rule is SSH (`22/tcp`) allowed from `<lan-subnet>`. Nothing else should be listed — no rule for 8080, no rule for 443, no `0.0.0.0/0` entry.

- Before relying on `ufw`, re-run step 6's header check (or at minimum `tailscale serve status` and a phone smoke test) with `ufw` enabled, to confirm Serve traffic still reaches the app.
- Rollback if something breaks: `sudo ufw disable` removes the firewall entirely (SSH and everything else become reachable again as before `ufw` was enabled); re-enable only after fixing the rule that caused the problem.

### 5. Verify there is no public port

1. `docker port zeekr-companion-web-1` shows `127.0.0.1:8080` only; `docker ps` shows no `0.0.0.0` binding for this stack; `api` and `db` publish nothing.
2. On the Ubuntu host: `ss -ltnp | grep 8080` shows `127.0.0.1:8080`, not `0.0.0.0` or `[::]`.
3. Router: no port forward to the server.
4. From the phone on cellular **with Tailscale turned off**: `https://<host>.<tailnet>.ts.net` must not load, and the server's public IP must not answer.
5. Tailnet policy: phone to server `tcp:443` only (ADR-003).
6. Host firewall: `ufw status verbose` (step 4a) shows deny-incoming by default, SSH allowed from `<lan-subnet>` only, and nothing else — remote app access still comes only from the tailnet policy in point 5, not from any `ufw` rule.

### 6. Header check from a tailnet device

The phone cannot run scripts; use any laptop on the tailnet (you chose phone-only access, so join one temporarily, or run `curl -sI` by hand from the server itself, where the name resolves). The URL is read from the environment and never stored in the repo:

```
ORIGIN=https://<host>.<tailnet>.ts.net infra/check-https-origin.sh
```

It sends unauthenticated GETs to `/`, `/sw.js`, `/health` and `/api/v1/vehicle` and asserts: CSP, `nosniff`, `Referrer-Policy`, `Permissions-Policy` and COOP each appear exactly once; `Cache-Control` appears once with the expected value (`no-cache` for `/` and `/sw.js`, `no-store` for the API; `/health` is only checked for no duplicate); no `Strict-Transport-Security`; no `Server`; no `Tailscale-*` response header. Exit 0 means all pass. Whether Serve itself adds or alters response headers is **unverified**; this script is how you find out.

Then on the phone (cellular, Tailscale on): open the `https://` name, check the lock, sign in, install to Home Screen, and run the manual AC-6/AC-7 checks.

### 7. Back out

```
tailscale serve --https=443 http://127.0.0.1:8080 off      # remove the one mapping (documented `off` form)
tailscale serve reset                                       # or clear all Serve config
tailscale serve status                                      # must be empty
cd infra && docker compose down                             # stops the stack, KEEPS the database volume
```

Never add `--volumes` or run `docker volume rm zeekr-companion_pgdata` unless you intend to delete the data. To also leave the tailnet: remove the machine in the admin console, or `tailscale down`. Lost phone: remove it from the tailnet first (ADR-003).

### Rate-limit behaviour you should expect

Serve connects to the loopback port on the host, so the API sees one address (the Docker gateway) for every request. Five wrong passwords lock login for everyone, including you, for 15 minutes (`429` with `Retry-After`). This is the accepted single shared bucket.

## Optional error reporting (ADR-007)

Set `SENTRY_DSN_API` in `infra/.env` to turn on API error reporting; leave it empty to send nothing. The web client reports only if `VITE_SENTRY_DSN` was set when it was built. Events are scrubbed to the exception type, stack frames and the URL path. See `docs/architecture/decisions/ADR-007-sentry-error-reporting.md`.
