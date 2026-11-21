#!/usr/bin/env bash
# Tests the .env.example comparison in infra/update.sh with made-up files. No network, no Docker.
#   infra/tests/check-update-env.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
# Load only the comparison functions from update.sh.
eval "$(sed -n '/^# >>> env-compare/,/^# <<< env-compare/p' "$here/../update.sh")"

cat > "$tmp/old" <<'X'
# Database password.
DB_PASS=
# Optional thing.
# OLD_OPTIONAL=
X
cat > "$tmp/new" <<'X'
# Database password.
DB_PASS=
# Optional thing.
# OLD_OPTIONAL=

# Alerts need all three.
# Keep the private one secret.
ALERT_KEY=
# Contact for alerts.
ALERT_CONTACT=
# A commented one.
# ALERT_COMMENTED=
NO_COMMENT_NAME=
X
cat > "$tmp/env" <<'X'
DB_PASS=hunter2-synthetic
ALERT_CONTACT=synthetic-value-do-not-print
X

fail=0
check() { if ! grep -qF -- "$2" <<<"$1"; then echo "FAIL: missing: $2"; fail=1; fi; }
absent() { if grep -qF -- "$2" <<<"$1"; then echo "FAIL: should not appear: $2"; fail=1; fi; }

out="$(env_report "$tmp/old" "$tmp/new" "$tmp/env" v0.0.1)"
check "$out" "New settings in .env.example since v0.0.1"
check "$out" "ALERT_KEY"
check "$out" "not in .env"
check "$out" "ALERT_CONTACT"
check "$out" "has a line in .env"
check "$out" "ALERT_COMMENTED"
check "$out" "NO_COMMENT_NAME"
if [ "$(grep -c '^NO_COMMENT_NAME$' <<<"$out")" -ne 0 ]; then echo "FAIL: empty block printed"; fail=1; fi
check "$out" "Keep the private one secret."
check "$out" "Alerts need all three."
absent "$out" "OLD_OPTIONAL"
absent "$out" "DB_PASS"
absent "$out" "synthetic-value-do-not-print"
absent "$out" "hunter2"
absent "$out" "Contact for alerts."   # already in .env, so its comment is not repeated

same="$(env_report "$tmp/new" "$tmp/new" "$tmp/env" v0.0.1)"
[ -z "$same" ] || { echo "FAIL: output for identical files: $same"; fail=1; }

[ "$fail" -eq 0 ] && echo "update.sh .env comparison: all checks passed"
exit "$fail"
