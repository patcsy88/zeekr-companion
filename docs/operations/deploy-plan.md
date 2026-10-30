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
| Migrations applied at API start (`alembic upgrade head`) | `services/api/docker-entrypoint.sh` | Tested; current head `0007` (deployed 2026-10-30) |
| Host firewall steps (`ufw`, SSH from LAN only) | `infra/README.md` step 4a | **Unverified on a real host** |
| Tailscale Serve runbook, header check script | `infra/README.md` steps 4 to 6, `infra/check-https-origin.sh` | **Unverified on a real host** |
| `pg_dump` script, systemd timer and service templates, restore procedure | `infra/backup/` | Restore tested end to end 2026-10-28 (NFR-5 satisfied, off-machine copy) |

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
| Forgotten password | Run `docker compose exec api python -m app.cli.set_owner` on the host (ADR-006, once deployed). Until the ADR-006 redeploy, change `OWNER_PASSWORD_HASH` in `.env` and restart `api` |
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
- 2026-10-24, ADR-006 built locally, not deployed: owner account in the database (migration `0005`), `python -m app.cli.set_owner`, username field on sign-in, link-colour fix. Local gates green (API 1639 passed, web 505 passed, e2e 37 passed, smoke 59 passed with one skip, drift and gitleaks clean). `npm audit fix` changed the web lockfile only (4 indirect dev packages). The host still runs `ff7c5e6` with the single password. Redeploy needs the owner's go-ahead for the push and the deploy; remove `OWNER_PASSWORD_HASH` from the host `.env` afterwards.

### ADR-006 redeploy checklist (in this order, owner approves the push and the deploy)

1. Push `main`; on the host `git pull`.
2. Copy the rebuilt `dist` from the development machine, compare the checksum, run `infra/check-dist.sh`.
3. `docker compose up -d --build --wait`; confirm migration head is `0005`. Sign-in returns 401 until step 4.
4. `docker compose exec api python -m app.cli.set_owner`. The owner types the username and password; nothing goes into chat.
5. Delete the `OWNER_PASSWORD_HASH` line from the host `.env` (it is ignored, but should not linger).
6. Sign in through the tunnel with the new login; check that the data from Phase 4 is still there.
- 2026-10-27, ADR-006 redeploy on the Ubuntu host (owner-run, owner-reported): the three containers were recreated and healthy, `web` publishes `127.0.0.1:8080` only, `alembic current` showed `0005 (head)`, and the owner created the login with `set_owner` and signed in with the username and password. A stale `dist` was re-copied and fixed. **Not shown to the agent:** the `git log` commit, the `dist` checksum comparison, the `pre-adr006.sql` dump and the Phase 4 data check. Still to do: delete `OWNER_PASSWORD_HASH` from the host `.env`; delete `~/pre-adr006.sql` after a few days. Phase 3 backup and restore (NFR-5), the firewall check and Phase 5 remote access are still open.
- 2026-10-27, host cleanup (owner-run, owner-reported "done"; output not shown to the agent): the `OWNER_PASSWORD_HASH` line was deleted from the host `infra/.env`. Still to do: delete `~/pre-adr006.sql` after the owner confirms the Phase 4 data is intact. Phase 3 backup and restore (NFR-5), the firewall check and Phase 5 remote access remain open.
- 2026-10-27, post-migration data check (owner-run, owner-reported: "counts match and the app shows the data"; the counts themselves were not shown to the agent): the Phase 4 records survived migration `0005` and the ADR-006 redeploy. `~/pre-adr006.sql` may now be deleted by the owner. NFR-5 (tested backup and restore), the firewall check and Phase 5 remote access remain open.
- 2026-10-27, backup tooling: added `infra/backup/restore_check.sh` (restore into a throwaway container, compare row counts with the live database). Tested on the development machine only; not yet run on the host. NFR-5 stays outstanding until a dump from the real backup disk passes it on the host. Plan: Stage A (dump to a local folder on the host and run the check, which proves the procedure but is not a backup), then Stage B (backup disk, timer, check again). The owner also wants an off-machine copy; that needs a decision and approval (new storage location or service).
- 2026-10-27, backup Stage A on the host (owner-run; the output was shown to the agent): `pg_dump.sh` wrote a 4.0K dump to a local folder in the owner's home directory, and `restore_check.sh` restored it into a throwaway container and compared counts with the live database. Result: **PASS, exit 0**. Counts (restored = live): alembic_version 1, expense 3, owner_account 1, reminder 1, service_record 1, vehicle 1, warranty_claim 0, warranty_coverage 1. This proves the dump and restore procedure on the real host. It is **not a backup**: the dump sits on the same disk as the database. It also ran `restore_check.sh` through `docker compose exec`, the live-comparison path that had not been tested before. **NFR-5 stays outstanding** until a dump on a separate disk passes the same check (Stage B). Off-machine copy: option not yet chosen by the owner.
- 2026-10-27, off-machine backup tooling (owner decision: no local backup disk; pull to the owner's Mac over SSH, encrypted with `age`, private key on the Mac only): added `infra/backup/offsite_export.sh` (host: dump, encrypt to the public key, remove plaintext, prune), `infra/backup/pull_backup.sh` (Mac: rsync pull, freshness and age-header checks, optional decrypt and throwaway restore) and export service and timer templates. Tested on the development machine only, with throwaway data and `age` run from a container (good export, private key refused, dump failure leaves nothing, wrong key, too-old file, non-age file, empty remote, verify-restore). **Not yet run on the host or the Mac.** NFR-5 stays outstanding until a pulled, decrypted copy restores and its counts match the live database. Phase 3 is replaced by this off-machine plan; no backup disk is needed.
- 2026-10-27, off-machine backup first real run (owner-run; output shown to the agent): host `offsite_export.sh` wrote one 3.5K encrypted file in the staging directory (no plaintext or work files left, folder 750, file 640). After the owner set up key-based SSH from the Mac and installed `rsync` on the host, `pull_backup.sh` with `VERIFY_RESTORE=1` pulled it, decrypted it with the Mac-only private key and restored it into a throwaway database. Restored counts: alembic_version 1, expense 3, owner_account 1, reminder 1, service_record 1, vehicle 1, warranty_claim 0, warranty_coverage 1, equal to the live counts seen in Stage A about 12 minutes earlier. That run did not compare with the live database. **NFR-5 stays outstanding** until `restore_check.sh` passes on a fresh host dump and the nightly timer is enabled. Not yet done: nightly timer, Mac pull routine.
- 2026-10-27, off-machine backup live-count comparison (owner-run; output shown to the agent): a fresh host dump restored into a throwaway container with `restore_check.sh` and **PASSED**: all eight tables matched the live database (alembic_version 1, expense 3, owner_account 1, reminder 1, service_record 1, vehicle 1, warranty_claim 0, warranty_coverage 1). Together with the earlier Mac run (pulled, decrypted with the Mac-only key, restored, same counts), the restore half of NFR-5 is demonstrated. The two runs used different dumps, so the pulled copy itself was not compared with the live database. **NFR-5 is considered satisfied only once the nightly export timer runs and a second pulled copy verifies.** Dump files in the owner's home folder on the host still hold real records and should be deleted after that.
- 2026-10-27, nightly off-machine export enabled on the host (owner-run; journal and timer output shown to the agent): the service was started by hand and succeeded (a second encrypted file was written; the first was from the manual run), then `zeekr-companion-offsite-export.timer` was enabled. The host clock is UTC, so the 03:15 schedule fires at about 11:15 Malaysia time. Still to do for NFR-5: after the first timed run, pull on the Mac with `pull_backup.sh` and confirm the new file decrypts and restores. Mac pull routine and cleanup of the dump files in the owner's home folder on the host are also open.
- 2026-10-28, NFR-5 satisfied (owner-run; output shown to the agent): the nightly timer fired on its own (journal: 2026-10-27 03:19:44 UTC, clean run) and wrote `zeekr-companion-20261027-031944.sql.gz.age`. `pull_backup.sh` with `VERIFY_RESTORE=1` on the Mac pulled it (3 encrypted files held), decrypted it with the Mac-only private key and restored it into a throwaway database. Restored counts: alembic_version 1, expense 3, owner_account 1, reminder 1, service_record 1, vehicle 1, warranty_claim 0, warranty_coverage 1, identical to the live counts from the earlier host check. Combined with the host `restore_check.sh` PASS against the live database, NFR-5 is considered satisfied. **Caveats:** the only off-host copy is on the owner's Mac, which must be on for the pull; there is no automatic Mac pull yet; the private age key must be backed up elsewhere or every backup is unreadable; the timed copy was not itself compared with the live database (the live comparison used a separate dump); a restore over the live database has not been run, by design. Open: Mac pull routine, deleting the dump files in the owner's home folder on the host, firewall check, Phase 5 remote access.
- 2026-10-28, host cleanup (owner-run, owner-reported "done"; output not shown to the agent): the owner deleted the plaintext dump folder and `pre-adr006.sql` from the host home folder. The only remaining copies of the data are the live database, the encrypted files in the host staging directory, and the encrypted copies on the owner's Mac. Still open: Mac pull routine, private age key backup (owner), firewall check, Phase 5 remote access.
- 2026-10-30, ADR-008 steps 1 to 3 deployed on the Ubuntu host (owner-run, owner-reported; the compose and log output below was shown to the agent): commit `ef3fc2e`. Pre-deploy encrypted exports ran cleanly at 00:03:57 and 00:12:58 UTC (journal shown; which of the two preceded the migrations was not stated). After `docker compose up -d --build --wait` the `api` container was recreated and healthy, `web` (34 hours) and `db` (3 days) were left running and healthy, and `web` still publishes `127.0.0.1:8080` only. The API log showed `Running upgrade 0005 -> 0006, expense energy_wh` and `Running upgrade 0006 -> 0007, advisory proposal and model call`. The client `dist` was copied by `rsync` into the bind-mounted folder (`WEB_DIST_DIR`, read-only at `/srv/web`; its host value was not shown to the agent). In the browser the owner reported the Advisory tab showing "Model: off. Calls this month: 0 of 60." and "No open suggestions." The owner then pressed "Run checks now" and reported "Checked: 0 new, 0 already known" with all three checks skipped for "not enough data yet" (expected: the pace check needs 2 service records spanning 30 days, and the charging check needs 5 earlier charges with kWh recorded). **Not shown to the agent:** the `/health` result, the `rsync` output, the check that existing Service, Reminders, Expenses and Warranty data is unchanged, and the Energy (kWh) field on a charging expense. Model is off; no Anthropic key, LangChain, LangGraph or LangSmith is on the host. Migration head is now `0007`.
- 2026-10-30, ADR-008 step 4 built, **not deployed**. Gates: backend 1786 passed and 5 xfailed, ruff, format, mypy, `pip-audit` clean; API image builds on `python:3.13-slim` and imports the new packages; shared-types drift and gitleaks clean. Licences of the new packages (read from installed metadata) are MIT, BSD, Apache-2.0 or `orjson` MPL-2.0 AND (Apache-2.0 OR MIT); the repo has no licence-check script, so this was a manual read. Deploying it needs, from the owner: the Anthropic USD 10.00 cap set and checked in the console; the Anthropic key and a model id in the host `infra/.env` only; optionally the LangSmith region URL, spend limit and key in `infra/.env` only. Deploy changes `docker-compose.yml` (new `egress` network for `api`, new optional variables), so `api` is recreated with `docker compose up -d --build --wait` from `infra/`, after a fresh export. With the switch off nothing leaves the host.
