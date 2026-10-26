#!/usr/bin/env bash
# Zeekr Companion: pull the encrypted backups to this machine and check them (run on the MAC).
#
# The Mac starts the connection, so the host never needs a way into the Mac. Files are copied, never
# deleted: pruning on the host does not remove your copies. The private key never leaves this
# machine, and nothing is decrypted unless you pass AGE_IDENTITY.
#
# Usage:
#   REMOTE=<user>@<host>:/var/backups/zeekr-companion AGE_IDENTITY=~/path/to/key.txt infra/backup/pull_backup.sh
#
# Environment:
#   REMOTE          required. user@host:/path (or a local directory, for tests)
#   LOCAL_DIR       where copies are kept (default ~/zeekr-backups)
#   AGE_IDENTITY    your private key file. When set, the newest file is decrypted and gzip-tested
#   VERIFY_RESTORE  1 = also restore the newest dump into a throwaway container (needs docker and
#                   AGE_IDENTITY). Counts are shown but not compared with the live database.
#   MAX_AGE_HOURS   fail if the newest copy is older than this (default 36), which catches a host
#                   timer that stopped running
#
# Exit codes: 0 all good; 1 a problem (nothing pulled, too old, not an age file, will not decrypt,
# or the restore failed). Bash 3.2 compatible.
set -euo pipefail
umask 077

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE="${REMOTE:-}"
LOCAL_DIR="${LOCAL_DIR:-$HOME/zeekr-backups}"
AGE_IDENTITY="${AGE_IDENTITY:-}"
VERIFY_RESTORE="${VERIFY_RESTORE:-0}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-36}"

log()  { echo "[pull_backup] $*"; }
fail() { echo "[pull_backup] FAIL: $*" >&2; exit 1; }

[ -n "$REMOTE" ] || fail "set REMOTE, for example user@host:/var/backups/zeekr-companion"
command -v rsync >/dev/null 2>&1 || fail "rsync is not installed"
if [ -n "$AGE_IDENTITY" ]; then
  [ -f "$AGE_IDENTITY" ] || fail "AGE_IDENTITY not found: $AGE_IDENTITY"
  command -v age >/dev/null 2>&1 || fail "age is not installed (brew install age)"
fi
if [ "$VERIFY_RESTORE" = "1" ] && [ -z "$AGE_IDENTITY" ]; then fail "VERIFY_RESTORE=1 needs AGE_IDENTITY"; fi

mkdir -p "$LOCAL_DIR"
chmod 700 "$LOCAL_DIR"

# -rt (not -a): do not copy the host's owner or permissions; new files get this machine's umask (600).
rsync -rt --ignore-existing \
  --include='zeekr-companion-*.sql.gz.age' --exclude='*' \
  -e "ssh -o BatchMode=yes -o ConnectTimeout=15" \
  "${REMOTE%/}/" "$LOCAL_DIR/" || fail "rsync failed (is the host reachable, and is the path right?)"
find "$LOCAL_DIR" -maxdepth 1 -type f -name 'zeekr-companion-*.sql.gz.age' -exec chmod 600 {} +

newest="$(find "$LOCAL_DIR" -maxdepth 1 -type f -name 'zeekr-companion-*.sql.gz.age' -print | sort | tail -1)"
[ -n "$newest" ] || fail "no backup files in $LOCAL_DIR after the pull"
count="$(find "$LOCAL_DIR" -maxdepth 1 -type f -name 'zeekr-companion-*.sql.gz.age' | wc -l | tr -d ' ')"
log "$count encrypted file(s) held in $LOCAL_DIR; newest: $(basename "$newest") ($(du -h "$newest" | cut -f1))"

[ -s "$newest" ] || fail "the newest file is empty"
head -c 21 "$newest" | grep -q 'age-encryption.org/v1' || fail "the newest file is not an age file"

if [ -n "$(find "$newest" -mmin "+$((MAX_AGE_HOURS * 60))" -print)" ]; then
  fail "the newest backup is older than ${MAX_AGE_HOURS} hours; check the timer on the host"
fi

if [ -z "$AGE_IDENTITY" ]; then
  log "OK (copied and recognised as encrypted; not decrypted, because AGE_IDENTITY is not set)"
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
plain="$work/$(basename "${newest%.age}")"
age -d -i "$AGE_IDENTITY" -o "$plain" "$newest" || fail "cannot decrypt the newest file with that key"
gzip -t "$plain" || fail "decrypted, but the dump is not a valid gzip file"
log "decrypts with your key and the dump is a valid gzip file"

if [ "$VERIFY_RESTORE" = "1" ]; then
  set +e
  LIVE_COMPARE=off "$here/restore_check.sh" "$plain"
  rc=$?
  set -e
  [ "$rc" -eq 2 ] || fail "restore check did not complete (exit $rc)"
  log "restores into a throwaway database (counts above are not compared with the live database)"
fi
log "OK"
