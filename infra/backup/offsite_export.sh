#!/usr/bin/env bash
# Zeekr Companion: dump the database and encrypt it for an off-machine copy (run on the HOST).
#
# Only the encrypted file is kept. The plaintext dump exists for a moment in a private temporary
# directory and is always removed. The host holds the PUBLIC key only, so it cannot decrypt what it
# wrote; the private key stays on the owner's Mac. The Mac then pulls the files (pull_backup.sh).
#
# Usage:   sudo env AGE_RECIPIENT=age1... BACKUP_DIR=/var/backups/zeekr-companion infra/backup/offsite_export.sh
# Needs:   age (apt install age), docker compose, the running "db" container.
#
# Environment:
#   AGE_RECIPIENT       the public key, a string starting "age1" (or use AGE_RECIPIENT_FILE)
#   AGE_RECIPIENT_FILE  a file holding that public key
#   BACKUP_DIR          staging directory for the encrypted files (default /var/backups/zeekr-companion)
#   RETENTION_DAYS      delete encrypted files older than this on the host (default 14)
#   READER_USER         the account the Mac logs in as; files are handed to it so rsync can read them
#                       (default: $SUDO_USER, if any)
#   PG_DUMP_SCRIPT      the dump script to call (default: pg_dump.sh next to this file; for tests)
#
# Exit codes: non-zero on any failure. It never leaves a partial or plaintext file behind.
set -euo pipefail
umask 077

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/zeekr-companion}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
READER_USER="${READER_USER:-${SUDO_USER:-}}"
PG_DUMP_SCRIPT="${PG_DUMP_SCRIPT:-$here/pg_dump.sh}"

log()  { echo "[offsite_export] $*"; }
fail() { echo "[offsite_export] ERROR: $*" >&2; exit 1; }

command -v age >/dev/null 2>&1 || fail "age is not installed (sudo apt install age)"

recipient="${AGE_RECIPIENT:-}"
if [ -z "$recipient" ] && [ -n "${AGE_RECIPIENT_FILE:-}" ]; then
  [ -f "$AGE_RECIPIENT_FILE" ] || fail "AGE_RECIPIENT_FILE not found: $AGE_RECIPIENT_FILE"
  recipient="$(grep -v '^#' "$AGE_RECIPIENT_FILE" | head -1 | tr -d '[:space:]')"
fi
[ -n "$recipient" ] || fail "no public key: set AGE_RECIPIENT or AGE_RECIPIENT_FILE (never a private key)"
case "$recipient" in
  age1*) ;;
  AGE-SECRET-KEY*) fail "that is a PRIVATE key. Put only the public key (starts with age1) on the host" ;;
  *) fail "the recipient does not look like an age public key (it must start with age1)" ;;
esac

mkdir -p "$BACKUP_DIR"
chmod 750 "$BACKUP_DIR"
[ -w "$BACKUP_DIR" ] || fail "not writable: $BACKUP_DIR"

tmp="$(mktemp -d "$BACKUP_DIR/.work.XXXXXX")"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

log "dumping the database"
BACKUP_DIR="$tmp" "$PG_DUMP_SCRIPT" >/dev/null || fail "the dump failed; nothing was written to $BACKUP_DIR"
dump="$(find "$tmp" -maxdepth 1 -type f -name 'zeekr-companion-*.sql.gz' -print | sort | tail -1)"
[ -n "$dump" ] && [ -s "$dump" ] || fail "no dump was produced"
gzip -t "$dump" || fail "the dump is not a valid gzip file"

out="$BACKUP_DIR/$(basename "$dump").age"
age -r "$recipient" -o "$out.part" "$dump" || { rm -f "$out.part"; fail "encryption failed"; }
[ -s "$out.part" ] || { rm -f "$out.part"; fail "the encrypted file is empty"; }
head -c 21 "$out.part" | grep -q 'age-encryption.org/v1' || { rm -f "$out.part"; fail "the output is not an age file"; }
mv "$out.part" "$out"
chmod 640 "$out"
if [ -n "$READER_USER" ] && id "$READER_USER" >/dev/null 2>&1; then
  chown "$READER_USER" "$BACKUP_DIR" "$out"
fi
log "wrote $(du -h "$out" | cut -f1) to $out (encrypted; the plaintext dump has been removed)"

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'zeekr-companion-*.sql.gz.age' -mtime "+${RETENTION_DAYS}" -print -delete
log "done"
