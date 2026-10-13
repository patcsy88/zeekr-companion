#!/usr/bin/env bash
# Header check for the real HTTPS origin, run by the owner from a tailnet device (the phone
# cannot run it; a laptop on the tailnet can). The URL is read from the environment and is never
# stored in the repo:
#
#   ORIGIN=https://<host>.<tailnet>.ts.net infra/check-https-origin.sh
#
# Cache-Control on /health is only checked for duplication (the API sets none there).
# Sends only unauthenticated GETs (no password, no token). Asserts, for "/", "/sw.js", "/health"
# and an API path (401 is expected there):
#   - CSP, nosniff, Referrer-Policy, Permissions-Policy and COOP are present exactly once
#   - Cache-Control is present exactly once with the expected value
#   - no Strict-Transport-Security (WEB_HSTS=off), no Server header, no Tailscale-* response header
set -euo pipefail

if [ -z "${ORIGIN:-}" ]; then
  echo "Set ORIGIN, for example: ORIGIN=https://<host>.<tailnet>.ts.net $0" >&2
  exit 2
fi
case "$ORIGIN" in
  https://*) ;;
  # CHECK_ALLOW_HTTP=1 exists only so this script can be tested against the local stack.
  http://127.0.0.1:*|http://localhost:*) [ "${CHECK_ALLOW_HTTP:-}" = 1 ] || { echo "ORIGIN must start with https://" >&2; exit 2; } ;;
  *) echo "ORIGIN must start with https:// (this script checks the HTTPS origin)" >&2; exit 2 ;;
esac
origin="${ORIGIN%/}"
fail=0

headers() { # headers <path> -> status line + headers, CRs removed, final response only
  curl -sS -o /dev/null -D - --max-time 15 "$origin$1" | tr -d '\r'
}
once() { # once <label> <header-name> <headers>
  local n
  n="$(printf '%s\n' "$3" | grep -ciE "^$2:" || true)"
  if [ "$n" = 1 ]; then echo "PASS  $1: $2 once"; else echo "FAIL  $1: $2 appears $n times (want 1)"; fail=1; fi
}
absent() { # absent <label> <header-regex> <headers>
  if printf '%s\n' "$3" | grep -qiE "^($2)"; then echo "FAIL  $1: found $2"; fail=1; else echo "PASS  $1: no $2"; fi
}
value() { # value <label> <header-name> <expected-lowercase> <headers>
  local got
  got="$(printf '%s\n' "$4" | grep -iE "^$2:" | head -n1 | sed "s/^[^:]*: *//" | tr 'A-Z' 'a-z')"
  if [ "$got" = "$3" ]; then echo "PASS  $1: $2 = $3"; else echo "FAIL  $1: $2 = '$got' (want '$3')"; fail=1; fi
}

check_path() { # check_path <path> <expected-status> <expected-cache-control>
  local p="$1" want="$2" cc="$3" h status n
  h="$(headers "$p")"
  status="$(printf '%s\n' "$h" | sed -n '1s/^HTTP[^ ]* \([0-9]*\).*/\1/p')"
  if [ "$status" = "$want" ]; then echo "PASS  $p: status $status"; else echo "FAIL  $p: status '$status' (want $want)"; fail=1; fi
  for name in Content-Security-Policy X-Content-Type-Options Referrer-Policy Permissions-Policy \
              Cross-Origin-Opener-Policy; do
    once "$p" "$name" "$h"
  done
  if [ "$cc" = none ]; then
    # /health: the API sets no Cache-Control; it must still never be duplicated.
    n="$(printf '%s\n' "$h" | grep -ciE '^Cache-Control:' || true)"
    if [ "$n" -le 1 ]; then echo "PASS  $p: Cache-Control at most once ($n)"; else echo "FAIL  $p: Cache-Control appears $n times"; fail=1; fi
  else
    once "$p" Cache-Control "$h"
    value "$p" Cache-Control "$cc" "$h"
  fi
  absent "$p" 'Strict-Transport-Security' "$h"
  absent "$p" 'Server' "$h"
  absent "$p" 'Tailscale-' "$h"
}

echo "Checking $(printf '%s' "$origin" | sed 's#^\(https://\)[^.]*\..*#\1<host>.<tailnet>.ts.net#') (host not echoed in full)"
check_path / 200 no-cache
check_path /sw.js 200 no-cache
check_path /health 200 none
check_path /api/v1/vehicle 401 no-store

echo
if [ "$fail" -eq 0 ]; then echo "HTTPS ORIGIN CHECK PASSED"; else echo "HTTPS ORIGIN CHECK FAILED"; fi
exit "$fail"
