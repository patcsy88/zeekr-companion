# Deploy plan: first deployment to the Ubuntu host

- Status: **Approved by the owner on 2026-10-23, with the decisions below.** Phase 0 can run now. Each later phase still needs the owner to start it, and the push to GitHub needs a separate go-ahead when Phase 1 begins.

## Owner decisions (2026-10-23)

1. Code reaches the host by pushing `main` to GitHub and running `git clone` on the host (the recommended option). The push itself waits for a separate go-ahead.
2. Local-only access first (`127.0.0.1:8080`). Tailscale (Phase 5) is later and optional.
3. Backup disk: **nothing for now.** Phase 3 is deferred, the backup timer stays off, and NFR-5 stays outstanding. Until a backup and a tested restore exist, the host holds the only copy of the data, so do not enter records you cannot afford to lose.
4. Machine name `app-1`, to be applied before any `tailscale serve`.
5. Deploy with the current single password. ADR-006 replaces it afterwards.
- Date: 2026-10-23
- Scope: first deployment of Reminders, Expenses, Warranty and the vehicle/service-record slice to the standalone Ubuntu Server 24.04 host (ADR-004). Placeholders only: the real host name, tailnet name, LAN subnet, mount path and account details never go in this repo.
- Not in scope: the ADR-006 account model (built after this plan), vehicle integrations, native clients.

## Host selection (2026-10-23)

The first candidate host was checked read-only and rejected by the owner (option A). It runs Debian 12 on a NAS-style appliance with vendor services and several other containers on common ports (including 8080), and it has no firewall. That is the kind of host ADR-004 moved away from, and `ufw` could break its vendor services. Nothing was installed or changed on it, and no stack was started there.

**Phase 1 waits for a suitable host:** a standalone Ubuntu Server 24.04 LTS machine or VM (ADR-004) with nothing else of value on it. Before Phase 1 the owner sends read-only output of `cat /etc/os-release | head -3`, `sudo ss -ltnp` and `docker compose version`. The agent checks that the port `WEB_PORT` will use (default 8080) is free, and that no firewall other than `ufw` is active. Host details (addresses, container names, hostnames) are not recorded in this repo.

## What already exists (no new work)

| Piece | Where | Status |
|---|---|---|
| Compose stack: `db`, `api`, `web` (Caddy), internal backend network, only `web` publishes `127.0.0.1:8080` | `infra/docker-compose.yml`, `infra/Caddyfile` | Built and smoke-tested on the development machine (`infra/smoke.sh`) |
| Migrations applied at API start (`alembic upgrade head`) | `services/api/docker-entrypoint.sh` | Tested; current head `0004` |
| Host firewall steps (`ufw`, SSH from LAN only) | `infra/README.md` step 4a | **Unverified on a real host** |
| Tailscale Serve runbook, header check script | `infra/README.md` steps 4 to 6, `infra/check-https-origin.sh` | **Unverified on a real host** |
| `pg_dump` script, systemd timer and service templates, restore procedure | `infra/backup/` | **Restore never run end to end** (NFR-5 outstanding) |

## Decisions needed from the owner

1. **How the code reaches the host.** Options: (a) push `main` to the public GitHub repo and `git clone` on the host (recommended: simple, repeatable updates with `git pull`; the repo is already public and gitleaks is clean, but a push is itself an approval gate and the history keeps the SEC-W1 text); (b) copy a release archive with `rsync` or `scp` from the development machine (nothing leaves your network, more manual). 
2. **Remote access now or later.** Tailscale is deferred and optional. Without it the app is reachable only from the host itself (`127.0.0.1:8080`), so the phone cannot use it. Options: (a) deploy with local-only access first, to prove the stack and the backup, then add Tailscale; (b) do Tailscale in the same session. Tailscale is a free-tier external service already approved in ADR-003, but you have not yet run it.
3. **Backup disk.** The second disk or USB drive and its mount path (kept private). The backup timer should not be enabled until it exists.
4. **Machine name.** It goes into a public Certificate Transparency log once Tailscale issues a certificate. It must be neutral (for example `app-1`) before the first `tailscale serve`. Not needed for option 2(a).
5. **Login before or after ADR-006.** Deploying now uses the current single password (`OWNER_PASSWORD_HASH`). ADR-006 later replaces it with a username and a database account. The change then needs one config edit and one `set_owner` run on the host. Accepting that costs little; waiting would delay the deployment.

## Phases

Each phase ends with a check. Do not start the next phase until the check passes. Commands are in `infra/README.md`; this plan does not repeat them.

### Phase 0: preparation on the development machine (agents, no approval needed)
- Run all gates on the commit to deploy: API (ruff, format, mypy, pytest, pip-audit), web (lint, format, tsc, vitest, build, e2e, audit), shared-types drift, gitleaks.
- `npm run build` in `apps/web` and `infra/check-dist.sh ../apps/web/dist`.
- Record the commit hash to deploy.
- Check: every gate green, hash recorded.

### Phase 1: the host (owner, on the Ubuntu host)
1. Install Docker Engine and the Compose plugin from Docker's apt repository (ADR-004).
2. Set up `ufw` as in README step 4a, keeping a console session open as a fallback. SSH is allowed from the LAN subnet only.
3. Get the code onto the host (decision 1).
- Check: `docker compose version` works; `sudo ufw status verbose` shows default deny incoming and only SSH from the LAN; no other rule.

### Phase 2: secrets and first start (owner)
1. Create `infra/.env` from `.env.example`: generate `POSTGRES_PASSWORD` and `TOKEN_SECRET` with the commands in the file, and the owner password hash with `python -m app.cli.hash_password` (prompts; stores no password). Never paste secrets into chat, a ticket or the repo.
2. Build the client on the host or copy `apps/web/dist`; set `WEB_DIST_DIR`.
3. `docker compose up -d --build --wait`.
- Check: `curl -s http://127.0.0.1:8080/health` returns `{"status":"ok"}`; `docker port` shows `127.0.0.1:8080` only; `ss -ltnp | grep 8080` shows loopback; `docker compose ps` shows all three healthy; the API log shows migrations reaching `0004`.

### Phase 3: backup and a tested restore (owner, with an agent walking through it) — DEFERRED by the owner
1. Mount the backup disk; configure and enable the systemd timer from `infra/backup/`.
2. Run one backup by hand; confirm the `.sql.gz` file exists and is not empty.
3. Restore it into a **throwaway** container (`infra/backup/RESTORE.md` step 1), compare row counts.
- Check: the restored database has the same tables and row counts as the live one. Only then mark NFR-5 satisfied. A restore over the live database is destructive and needs separate approval.

### Phase 4: first use (owner)
1. Sign in at the host, add the vehicle profile, one service record, one reminder, one expense and one coverage. Open each list again after a page reload.
2. Stop the API (`docker compose stop api`), confirm the offline indicator and that an offline write is queued, start the API, confirm the write is sent once.
- Check: data survives `docker compose restart` and a host reboot.

### Phase 5: remote access (optional, decision 2)
- Follow README steps 0, 4 to 6. The machine name check comes first. Funnel must stay off.
- Check: README step 5 (no public port, phone on cellular with Tailscale off cannot reach it) and step 6 (`check-https-origin.sh`). Then the deferred iPhone checks (AC-6, AC-7, AC-27, AC-43, AC-65), reported as passed only if you ran them.

## Updating later

1. Back up first: run the backup script by hand and confirm the new file. Migrations run automatically when the API container starts, so the backup is the rollback point.
2. Pull or copy the new commit; rebuild the client; `docker compose up -d --build --wait`.
3. Check health and the migration head in the API log.

## Rollback

- Stack broken, data fine: `docker compose down` (keeps the `pgdata` volume), check out the previous commit, `up -d --build`.
- A bad migration: restore the pre-update dump into a throwaway container first, verify, then (with owner approval) restore over the live database as in `RESTORE.md` step 2. Downgrade migrations exist but are not a substitute for a backup.
- Never run `docker compose down -v`, `docker volume prune` or `docker volume rm` on `zeekr-companion_pgdata` unless you mean to delete the data (the project config denies these for agents).

## Risks and known gaps

| Risk | Handling |
|---|---|
| `ufw`, Tailscale and restore steps have never run on a real host | Each has a check above; failures are reported as failures, not passed |
| Login lockout is one shared bucket behind Tailscale Serve (accepted); anyone on the tailnet can lock the owner out for 15 minutes | Accepted by the owner earlier; the tailnet policy limits who can reach the app |
| Lockout state resets on restart | Accepted |
| Password reset is not available until ADR-006 | Until then change `OWNER_PASSWORD_HASH` in `.env` and restart `api` |
| Backups on a local disk do not protect against losing the host site | Accepted in ADR-004; offsite would need a new approval |
| The public repo history includes the SEC-W1 text | Accepted (option A) |
| The `pgdata` volume has no encryption at rest | Out of scope; rely on the host's disk encryption if the owner enables it |

## What I will not do without approval

Push to GitHub, install anything on or connect to the host, create a Tailscale account or device, change DNS or the router, run a restore over live data, or enable the backup timer.

## Deployment log

- 2026-10-23, Phase 1 on the new Ubuntu 24.04.3 host: Docker 29.9.2 and Compose v5.6.1 installed and active; clone at `ff7c5e6`; `dist` copied from the development machine (11 files, checksum `3a9269e899c82cc3` matched, `check-dist.sh` ok). Only SSH and the local DNS resolver were listening before the stack started. **Firewall: unverified** (`ufw` not installed, no other firewall output seen).
- 2026-10-23, Phase 2: the owner ran `docker compose up -d --build --wait` and the health, `docker compose ps`, loopback-binding and migration-head checks, and reported "findings as expected". **Owner-reported; the outputs were not shown to the agent.** Compose v5.6.1 raised no reported difference.
- Phase 3 (backup and tested restore) is still deferred, so NFR-5 stays outstanding. Phases 4 and 5 are not yet run.
- 2026-10-24, Phase 4 (owner-run, screenshots and `docker compose ps` output seen): records for vehicle, service, reminder, expense and coverage were entered and displayed consistently. Offline write test passed (API stopped: "Server unreachable", "1 waiting to sync", total counted offline; API started: Online, one expense added once, no duplicate). `docker compose restart` and a host reboot both kept the data; all three containers came back healthy on their own; `web` publishes `127.0.0.1:8080` only. The owner mentioned 4 containers; `ps` lists 3, so this was probably a miscount (to be confirmed with `docker ps`).
- Still open: firewall unverified (`ufw` not installed); Phase 3 backup and restore deferred (NFR-5 outstanding); Phase 5 remote access and the iPhone checks not run.
- Cosmetic finding: the "Suggested service schedule" and "Suggested factory warranty terms" links use the browser's default link colours.
