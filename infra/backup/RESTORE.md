# Restore procedure: PostgreSQL `.sql.gz` dump

Companion doc to `infra/backup/pg_dump.sh` and the systemd timer templates in this directory.
Background: `docs/architecture/decisions/ADR-004-ubuntu-standalone-host.md` (backup target: a
second local disk or external USB drive mounted at a fixed path on the Ubuntu host).

> **This procedure has NOT been run end-to-end against a real dump or a real host.** There is no
> standalone Ubuntu host available in this environment, and restoring is inherently destructive to
> whatever database it targets, so nothing here was executed against real data. Every command
> below is **(unverified)**. The owner or QA must run a full restore test (ideally into a
> throwaway/disposable instance first, per step 2) before NFR-5 (backup/restore) can be considered
> satisfied.

## Before you start

- Identify the dump file you intend to restore, e.g. `/mnt/backup/zeekr-companion/zeekr-companion-20261015-031500.sql.gz`.
- Decide: are you restoring into a **throwaway instance** to verify the dump is good (recommended,
  and the only option you should use for a first test), or doing a **real restore** onto the live
  stack (only after the dump has been verified, and only with the owner's explicit approval per
  `AGENTS.md`'s human approval gates — restoring over a live database is a destructive operation)?

## 1. (Recommended first) Restore into a throwaway instance to verify the dump

**Scripted version:** `infra/backup/restore_check.sh [dump-file]` does this whole step. It restores into a throwaway container with no network, stops at the first SQL error, removes the container on exit, and compares each table's row count with the live database. Exit 0 is a pass, 1 is a failure or a mismatch, 2 means the restore worked but the counts were not compared (not a full pass). With no argument it uses the newest dump in `BACKUP_DIR`. It was tested on a development machine against throwaway Postgres containers (good dump, changed live data, corrupt gzip, empty and missing files, valid gzip with bad SQL). It has not yet run on the real host. The manual commands below remain as the fallback.

This proves the dump is valid and restorable without touching the real `zeekr-companion_pgdata`
volume or the running `db` container.

```bash
# From infra/, start an isolated, disposable Postgres container with its own throwaway volume
# and a different project/container name so it can never collide with the real stack.
docker run -d --name zc-restore-check \
  -e POSTGRES_USER=zeekr -e POSTGRES_PASSWORD=throwaway -e POSTGRES_DB=zeekr \
  postgres:17-alpine

# Wait for it to be ready.
docker exec zc-restore-check pg_isready -U zeekr -d zeekr

# Restore the dump into the throwaway container.
gunzip -c /path/to/zeekr-companion-YYYYmmdd-HHMMSS.sql.gz | \
  docker exec -i zc-restore-check psql -U zeekr -d zeekr

# Spot-check: row counts, a few known tables, etc.
docker exec zc-restore-check psql -U zeekr -d zeekr -c '\dt'

# Clean up the throwaway container and its volume once you're satisfied. This does NOT touch the
# real stack: "zc-restore-check" is a standalone container, not part of the "zeekr-companion"
# compose project, and has no named volume to leak.
docker rm -f zc-restore-check
```

## 2. Real restore onto the compose stack (only after step 1 passes, and only with approval)

This replaces the contents of the live database. Stop the API first so nothing writes to the
database mid-restore, and make sure you have a *recent* dump of the current state before
overwriting it, in case you need to roll back.

```bash
cd infra

# 1. Stop the API so nothing writes during the restore. Leave "db" running.
docker compose stop api

# 2. Optional but recommended: take a fresh dump of the current (pre-restore) state first, in
#    case you need to undo this.
BACKUP_DIR=/mnt/backup/zeekr-companion ./backup/pg_dump.sh

# 3. Drop and recreate the schema inside the existing database (keeps the same container/volume;
#    does not touch "zeekr-companion_pgdata" at the Docker-volume level, only the SQL objects
#    inside it). Review this against your actual schema/ownership before running on real data.
docker compose exec -T db psql -U zeekr -d zeekr -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'

# 4. Restore the dump.
gunzip -c /path/to/zeekr-companion-YYYYmmdd-HHMMSS.sql.gz | \
  docker compose exec -T db psql -U zeekr -d zeekr

# 5. Run any pending Alembic migrations if the dump predates the current schema version.
#    (Check services/api/alembic for the current head; do not guess the command here.)

# 6. Restart the API and verify.
docker compose start api
curl -s http://127.0.0.1:8080/health
```

### Rollback if the restore goes wrong

If step 2 was run, you have a pre-restore dump; repeat the "real restore" steps above pointing at
that pre-restore dump file instead.

## Never do this

- Never run `docker compose down -v` or `docker volume rm zeekr-companion_pgdata` as part of a
  restore. The named volume holding the live cluster must stay intact; restoring is a SQL-level
  operation against the running `db` container, not a volume-level operation.
- Never test a restore procedure for the first time against the live stack. Always prove the dump
  restores cleanly into a throwaway instance (step 1) first.

## Outstanding / unverified

- No real Ubuntu host, systemd timer, or real backup disk was available to test any of this. The
  `pg_dump.sh` script's dump logic was exercised against a disposable local Postgres container as
  a non-destructive smoke test only (see the top-level report for this task); the restore flow in
  this document was reviewed but not executed.
- The owner/QA should, on the real host: run `pg_dump.sh` once manually, then perform a full step-1
  restore of the resulting file into a throwaway container, before relying on the systemd timer in
  production. Only after that should NFR-5 be marked satisfied.

## Off-machine backup (owner decision 2026-10-27: no local backup disk)

The only backup is an encrypted copy pulled to the owner's Mac. The host holds the public `age` key only, so it cannot read what it writes.

**One-time setup**
1. Mac: `brew install age`, then `age-keygen -o <private-key-file>`. Keep the private key on the Mac and **back it up somewhere other than the host** (for example a password manager). If it is lost, every backup is unreadable. Never paste it into chat or copy it to the host. Only the public key (starts `age1`) goes to the host.
2. Host: `sudo apt install age rsync` (rsync must exist on both ends), `git pull`, then add `AGE_RECIPIENT=age1...` to `infra/.env`.
   The Mac also needs key-based SSH to the host (`ssh-keygen -t ed25519`, then `ssh-copy-id`). This is a different key from the age key. Test with `ssh -o BatchMode=yes <user>@<host> true`.
3. Host: run once by hand: `cd ~/zeekr-companion/infra && sudo env AGE_RECIPIENT=age1... BACKUP_DIR=/var/backups/zeekr-companion ./backup/offsite_export.sh`. It writes `zeekr-companion-*.sql.gz.age`, removes the plaintext and prunes files older than `RETENTION_DAYS` (14).
4. Mac: `REMOTE=<user>@<host>:/var/backups/zeekr-companion AGE_IDENTITY=<private-key-file> VERIFY_RESTORE=1 infra/backup/pull_backup.sh`. SSH must be key-based (`BatchMode`). It copies new files (never deletes), checks the newest is under `MAX_AGE_HOURS` (36) old, decrypts, and restores into a throwaway container. Counts are not compared with the live database in this mode, so also run `restore_check.sh` on a fresh host dump.
5. Once step 4 passes, install the timer templates `zeekr-companion-offsite-export.service` and `.timer` (instructions are in the service file), and run `pull_backup.sh` from a launchd job or by hand. A stopped host timer shows up as a "too old" failure on the Mac.

**Restoring from an off-machine copy:** decrypt on the Mac with `age -d -i <private-key-file> -o dump.sql.gz <file>.age`, copy `dump.sql.gz` to the host, then follow the steps above.

Dumps contain the owner password hash and the owner's records. Treat both the encrypted and decrypted files as sensitive.

Status: first real run 2026-10-27 (owner-run). The host export wrote an encrypted file, the Mac pulled it, decrypted it and restored it into a throwaway database with the expected counts. The comparison against a fresh host dump (`restore_check.sh`) and the nightly timer are still to do.
