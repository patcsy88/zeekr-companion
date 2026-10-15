# infra

Docker Compose stack: `db` (PostgreSQL), `api` (FastAPI) and `web` (Caddy: static client + reverse proxy).

```
cp .env.example .env     # fill in POSTGRES_PASSWORD, OWNER_PASSWORD_HASH, TOKEN_SECRET
docker compose up --build
```

- Only `web` publishes a port: `${WEB_BIND_ADDRESS:-127.0.0.1}:${WEB_PORT:-8080}`. Never default it to `0.0.0.0`. `api` and `db` have no `ports`.
- `web` forwards `/api/*` and `/health` to `api:8000`; everything else is static files from `/srv/web` with fallback to `index.html`.
- **Wiring `apps/web`:** run `npm run build` in `apps/web`, then set `WEB_DIST_DIR=../apps/web/dist` in `infra/.env` (path relative to `infra/`). Until then a placeholder page in `infra/web-placeholder` is served.
- **Headers** (`Caddyfile`): CSP, `nosniff`, `Referrer-Policy: no-referrer` on every response; `no-cache` on `index.html`, `sw.js` and fallback routes; `no-store` on `/api/*`; request body cap 64 KiB (answered as `400 validation_error`, matching the API).
- **HSTS** is off. `WEB_HSTS=on` adds `Strict-Transport-Security` (30 days). Owner decision (ADR-003): keep it off. TLS is not handled here: Tailscale Serve on the host terminates HTTPS and proxies to the loopback port.
- **Client address / login rate limit:** the proxy has a fixed address (`WEB_PROXY_IP` in `WEB_SUBNET`). `api` starts uvicorn with `--proxy-headers --forwarded-allow-ips $FORWARDED_ALLOW_IPS`, set to that address only. The entrypoint refuses `*`. Caddy overwrites any client-sent `X-Forwarded-For`. Behind host `tailscale serve` the API sees the Docker bridge gateway of the `edge` network (observed `172.18.0.1` on Docker Desktop) for every request: one shared login bucket, by owner decision. `FORWARDED_ALLOW_IPS` does not change.
- **Tailscale headers:** Caddy deletes every `Tailscale-*` request header (identity headers carry the account email) before any handler. `infra/smoke.sh` proves it against an echo upstream; the API ignores and never logs them (`services/api/tests/test_tailscale_headers.py`).
- **Networks:** `backend` is `internal: true` (no route out) and holds `db`, `api` and `web`; `edge` holds only `web` and carries the published port. `web` is the only service on both.
- **Post-build check:** after `npm run build` in `apps/web`, run `infra/check-dist.sh ../apps/web/dist`. It fails if `dist` has no `index.html`, or contains dotfiles or `.map` files. The proxy also answers 404 for any path with a dotfile segment or ending `.map`. `infra/smoke.sh` fails if `WEB_DIST_DIR` is set but `/` is still the placeholder: `SMOKE_WEB_DIST_DIR=../apps/web/dist infra/smoke.sh` tests the real build.
- **CSP** also has `form-action 'self'`. `Permissions-Policy` denies camera, microphone, geolocation, payment and USB, and `Cross-Origin-Opener-Policy: same-origin` is set; the real build was loaded in Chromium under these headers and signed in with no violations.
- **`Cache-Control` on `/api/*`:** the API sets `no-store`; Caddy adds it only if the response lacks one, so it is never duplicated.
- **Trusted proxies:** `FORWARDED_ALLOW_IPS` must be single addresses or networks no wider than IPv4 /24 or IPv6 /120; `0.0.0.0`, `0.0.0.0/0`, `::/0` and `*` stop the container at start (exit 64).
- **Smoke test:** `infra/smoke.sh` (unique project name, throwaway env and secrets, removes everything it created; never touches `zeekr-companion_pgdata`).
- **macOS/Docker Desktop note:** `docker compose build` (and therefore `infra/smoke.sh`) can fail with `docker-credential-desktop: executable file not found in $PATH` unless `/Applications/Docker.app/Contents/Resources/bin` is on `PATH`. This is specific to macOS with Docker Desktop, not a universal requirement.

## Owner runbook: private HTTPS with Tailscale Serve on the Ubuntu host

Placeholders only. Never write the real tailnet name, machine name, account email or device names in this repo. Design and decisions: `docs/architecture/decisions/ADR-003-remote-access-tailscale.md`. Items marked **(unverified)** were not run by the engineer; check them with `tailscale serve --help` on your version. Source for `serve` syntax: Tailscale "tailscale serve command" page, last validated Jan 2026.

### 0. Before anything else: the machine name

> **WARNING.** The certificate Tailscale issues is recorded in public Certificate Transparency logs **with the machine name**, and a name already issued stays there. Before the first `tailscale serve`, check the machine name is neutral (for example `app-1`): no `zeekr`, no personal name, no registration, no city. The machine has not been renamed yet. Rename it in the admin console (Machines page) and confirm with `tailscale status`; also choose the tailnet DNS name before enabling HTTPS certificates. Both become permanent once the PWA is installed on the phone (the origin is `https://<host>.<tailnet>.ts.net`).

### 1. Secrets (three, kept only in `infra/.env`, which is gitignored)

```
cd infra && cp .env.example .env
python3 -c "import secrets; print(secrets.token_urlsafe(24))"   # POSTGRES_PASSWORD
python3 -c "import secrets; print(secrets.token_urlsafe(48))"   # TOKEN_SECRET
cd ../services/api && python -m app.cli.hash_password           # OWNER_PASSWORD_HASH (prompts; stores no password)
```

Paste each value into `infra/.env`. Leave `WEB_BIND_ADDRESS=127.0.0.1`, `WEB_PORT=8080`, `WEB_HSTS=off`.

### 2. Build the client and point the stack at it

```
cd apps/web && npm ci && npm run build && cd ../..
infra/check-dist.sh ../apps/web/dist
echo 'WEB_DIST_DIR=../apps/web/dist' >> infra/.env     # path is relative to infra/
```

### 3. Start the stack and check it locally

```
cd infra && docker compose up -d --build --wait
curl -s http://127.0.0.1:8080/health          # {"status":"ok"}
docker port zeekr-companion-web-1             # must show 127.0.0.1:8080 only, never 0.0.0.0
SMOKE_WEB_DIST_DIR=../apps/web/dist ./smoke.sh   # optional; uses its own throwaway project
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
