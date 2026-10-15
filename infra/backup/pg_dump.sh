#!/usr/bin/env bash
# Zeekr Companion: PostgreSQL backup via pg_dump.
#
# ADR-004 (owner decision, 2026-10-15): the backup target is a second local disk or external USB
# drive mounted at a fixed path on the Ubuntu host. This script never touches the live
# "zeekr-companion_pgdata" volume; it only reads the database through "docker compose exec pg_dump"
# over the already-running "db" container and writes a compressed, timestamped dump file to
# BACKUP_DIR.
#
# Usage:
#   BACKUP_DIR=/mnt/backup/zeekr-companion infra/backup/pg_dump.sh
#   (or set BACKUP_DIR, RETENTION_DAYS etc. in infra/.env and run via the systemd unit in this
#   directory, which loads infra/.env as its EnvironmentFile)
#
# Exit codes: non-zero on any failure (missing/unwritable destination, pg_dump failure, compose
# failure). Never continues silently past a failed step (set -euo pipefail + explicit checks).
set -euo pipefail

# --- Configuration (override via environment or infra/.env) ---------------------------------
# Never a real host path: this placeholder must be replaced per-host by the owner.
BACKUP_DIR="${BACKUP_DIR:-/mnt/backup/zeekr-companion}"
# Compose project/service/user/db names must match infra/docker-compose.yml. Do not guess; these
# are read from the compose file's "name:", "db" service, POSTGRES_USER and POSTGRES_DB.
COMPOSE_PROJECT="${COMPOSE_PROJECT:-zeekr-companion}"
DB_SERVICE="${DB_SERVICE:-db}"
DB_USER="${DB_USER:-zeekr}"
DB_NAME="${DB_NAME:-zeekr}"
# How many days of backups to keep. Default: 14 days. Simple age-based pruning via "find -mtime".
RETENTION_DAYS="${RETENTION_DAYS:-14}"
# Directory containing infra/docker-compose.yml. Defaults to this script's parent directory, so
# it works whether invoked directly or via the systemd service (which sets WorkingDirectory).
INFRA_DIR="${INFRA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

log()  { echo "[pg_dump] $*"; }
fail() { echo "[pg_dump] ERROR: $*" >&2; exit 1; }

# --- Preconditions ----------------------------------------------------------------------------
command -v docker >/dev/null 2>&1 || fail "docker is not on PATH"

[ -d "$INFRA_DIR" ] || fail "infra directory not found: $INFRA_DIR"
[ -f "$INFRA_DIR/docker-compose.yml" ] || fail "docker-compose.yml not found under $INFRA_DIR"

if [ ! -d "$BACKUP_DIR" ]; then
  fail "destination directory does not exist: $BACKUP_DIR (create and mount the backup disk first; this script never creates it, to avoid silently writing to the wrong place)"
fi

if [ ! -w "$BACKUP_DIR" ]; then
  fail "destination directory is not writable: $BACKUP_DIR (check mount and permissions)"
fi

# --- Dump ---------------------------------------------------------------------------------------
timestamp="$(date -u +%Y%m%d-%H%M%S)"
dump_name="zeekr-companion-${timestamp}.sql.gz"
dump_path="${BACKUP_DIR}/${dump_name}"
tmp_path="${dump_path}.part"

log "dumping database '$DB_NAME' (user '$DB_USER') from compose service '$DB_SERVICE' (project '$COMPOSE_PROJECT') -> $dump_path"

cleanup_tmp() { rm -f "$tmp_path"; }
trap cleanup_tmp EXIT

if ! (
  cd "$INFRA_DIR" &&
  docker compose -p "$COMPOSE_PROJECT" exec -T "$DB_SERVICE" pg_dump -U "$DB_USER" "$DB_NAME" | gzip -9 > "$tmp_path"
); then
  fail "pg_dump failed (see output above); no partial file left in place"
fi

# pg_dump's exit status is swallowed by the pipe to gzip above the way POSIX sh works, but with
# "set -o pipefail" (on, via set -euo pipefail) bash reports failure of either side, so the "if"
# above already catches a failing pg_dump or a failing gzip. Guard against a silently empty dump
# too (e.g. pg_dump produced no SQL at all), since that would "succeed" but back up nothing.
if [ ! -s "$tmp_path" ]; then
  fail "dump file is empty: $tmp_path (pg_dump likely produced no output)"
fi

mv "$tmp_path" "$dump_path"
trap - EXIT

log "wrote $(du -h "$dump_path" | cut -f1) to $dump_path"

# --- Retention / pruning -------------------------------------------------------------------------
log "pruning backups older than ${RETENTION_DAYS} days in $BACKUP_DIR"
# -mtime +N : files whose modification time is more than N*24h ago. Only this script's own naming
# pattern is touched, so unrelated files in BACKUP_DIR are left alone.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'zeekr-companion-*.sql.gz' -mtime "+${RETENTION_DAYS}" -print -delete

log "done"
