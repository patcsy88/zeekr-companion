#!/usr/bin/env bash
# Zeekr Companion: prove that a backup dump restores, without touching the live database.
#
# It restores a pg_dump .sql.gz file into a throwaway Postgres container (no network, no published
# port, removed on exit), then compares per-table row counts with the live database. It never
# writes to the live database or its volume.
#
# Usage:
#   infra/backup/restore_check.sh [dump-file]
#   With no argument it uses the newest zeekr-companion-*.sql.gz in BACKUP_DIR.
#
# Environment (all optional):
#   BACKUP_DIR        where to look for the newest dump (default /mnt/backup/zeekr-companion)
#   LIVE_COMPARE      "auto" (default) compares with the live db; "off" restores only
#   LIVE_CONTAINER    compare with this container (docker exec) instead of the compose "db" service
#   COMPOSE_PROJECT, DB_SERVICE, DB_USER, DB_NAME, INFRA_DIR, PG_IMAGE
#
# Exit codes: 0 restore ok and counts equal; 1 restore failed or counts differ;
#             2 restore ok but counts were not compared (live db not reachable, or LIVE_COMPARE=off).
# Exit 2 is NOT a pass for NFR-5 on its own.
#
# A mismatch is expected if records were added after the dump was taken. Take a fresh dump just
# before the check when you want a clean comparison.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/mnt/backup/zeekr-companion}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-zeekr-companion}"
DB_SERVICE="${DB_SERVICE:-db}"
DB_USER="${DB_USER:-zeekr}"
DB_NAME="${DB_NAME:-zeekr}"
PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"
LIVE_COMPARE="${LIVE_COMPARE:-auto}"
LIVE_CONTAINER="${LIVE_CONTAINER:-}"
INFRA_DIR="${INFRA_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

log()  { echo "[restore_check] $*"; }
fail() { echo "[restore_check] FAIL: $*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "docker is not on PATH"

# --- Pick and sanity-check the dump -----------------------------------------------------------
dump="${1:-}"
if [ -z "$dump" ]; then
  [ -d "$BACKUP_DIR" ] || fail "BACKUP_DIR does not exist: $BACKUP_DIR"
  dump="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'zeekr-companion-*.sql.gz' -print | sort | tail -1)"
  [ -n "$dump" ] || fail "no zeekr-companion-*.sql.gz file in $BACKUP_DIR"
fi
[ -f "$dump" ] || fail "dump file not found: $dump"
[ -s "$dump" ] || fail "dump file is empty: $dump"
gzip -t "$dump" 2>/dev/null || fail "dump is not a valid gzip file: $dump"
log "dump: $dump ($(du -h "$dump" | cut -f1))"

# --- Throwaway Postgres ------------------------------------------------------------------------
name="zc-restore-check-$$-$RANDOM"
password="$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# --network none: nothing can reach it, and it cannot reach anything. psql runs through docker exec.
docker run -d --name "$name" --network none \
  -e POSTGRES_USER="$DB_USER" -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB="$DB_NAME" \
  "$PG_IMAGE" >/dev/null || fail "could not start the throwaway container"

# The image starts a temporary server for initialisation, then restarts. Wait for the second start.
ready=0
for _ in $(seq 1 90); do
  n="$(docker logs "$name" 2>&1 | grep -c 'database system is ready to accept connections' || true)"
  if [ "$n" -ge 2 ]; then ready=1; break; fi
  sleep 1
done
[ "$ready" -eq 1 ] || fail "throwaway Postgres did not become ready within 90 seconds"

rpsql() { docker exec -i "$name" psql -X -q -U "$DB_USER" -d "$DB_NAME" "$@"; }

log "restoring into $name (stops at the first SQL error)"
if ! gunzip -c "$dump" | rpsql -v ON_ERROR_STOP=1 >/dev/null; then
  fail "restore reported an error; this dump cannot be relied on"
fi

tables=()
while IFS= read -r line; do
  [ -n "$line" ] && tables+=("$line")
done < <(rpsql -At -c "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1")
[ "${#tables[@]}" -gt 0 ] || fail "restore finished but the database has no tables"
printf '%s\n' "${tables[@]}" | grep -qx alembic_version || fail "restored database has no alembic_version table"
for t in "${tables[@]}"; do
  [[ "$t" =~ ^[a-z0-9_]+$ ]] || fail "unexpected table name in the restored database: $t"
done

# --- Live database access ----------------------------------------------------------------------
live_ok=0
lpsql() {
  if [ -n "$LIVE_CONTAINER" ]; then
    docker exec -i "$LIVE_CONTAINER" psql -X -q -U "$DB_USER" -d "$DB_NAME" "$@"
  else
    (cd "$INFRA_DIR" && docker compose -p "$COMPOSE_PROJECT" exec -T "$DB_SERVICE" psql -X -q -U "$DB_USER" -d "$DB_NAME" "$@")
  fi
}
if [ "$LIVE_COMPARE" != "off" ] && lpsql -At -c 'select 1' >/dev/null 2>&1; then live_ok=1; fi

# --- Compare ------------------------------------------------------------------------------------
status=0
printf '%-24s %10s %10s\n' table restored live
for t in "${tables[@]}"; do
  r="$(rpsql -At -c "select count(*) from public.\"$t\"")"
  if [ "$live_ok" -eq 1 ]; then
    l="$(lpsql -At -c "select count(*) from public.\"$t\"" 2>/dev/null || echo '?')"
    mark=""
    if [ "$r" != "$l" ]; then mark="  <-- differs"; status=1; fi
    printf '%-24s %10s %10s%s\n' "$t" "$r" "$l" "$mark"
  else
    printf '%-24s %10s %10s\n' "$t" "$r" "-"
  fi
done

if [ "$live_ok" -eq 1 ]; then
  live_tables="$(lpsql -At -c "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")"
  if [ "$live_tables" != "${#tables[@]}" ]; then
    echo "[restore_check] table count differs: restored=${#tables[@]} live=$live_tables" >&2
    status=1
  fi
fi

if [ "$live_ok" -eq 0 ]; then
  log "RESTORE OK, COUNTS NOT COMPARED (live database not compared: LIVE_COMPARE=$LIVE_COMPARE, or not reachable). This is not a full pass."
  exit 2
fi
if [ "$status" -ne 0 ]; then
  echo "[restore_check] FAIL: row counts differ from the live database. If records were added after this dump was taken, take a fresh dump and run again." >&2
  exit 1
fi
log "PASS: dump restored cleanly and every table count matches the live database"
