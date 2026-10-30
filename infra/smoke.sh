#!/usr/bin/env bash
# Compose smoke test for the proxy (AC-1 and the ADR-002 checks). Run from anywhere:
#   infra/smoke.sh
# It uses a unique compose project, a throwaway env file and throwaway secrets, and removes
# everything it created (containers, network, its own volume and images it built) on exit. It never
# touches the real "zeekr-companion" project or its pgdata volume.
#
# Needs: docker compose, curl, and a Python with the API installed (services/api/.venv or $PYTHON).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
api_dir="$here/../services/api"
python="${PYTHON:-$api_dir/.venv/bin/python}"
project="zcsmoke$(date +%s)$RANDOM"
envfile="$here/.env.smoke-$project"
port="${SMOKE_PORT:-18080}"
subnet="172.29.$((RANDOM % 200 + 20)).0/24"
proxy_ip="${subnet%.0/24}.10"
pass="smoke-$(openssl rand -hex 12)"
user="smoke-owner"
fail=0

compose() { docker compose -p "$project" --env-file "$envfile" -f "$here/docker-compose.yml" "$@"; }
ok()   { echo "PASS  $*"; }
bad()  { echo "FAIL  $*"; fail=1; }
check() { # check "description" expected actual
  if [ "$2" = "$3" ]; then ok "$1 ($3)"; else bad "$1: expected '$2', got '$3'"; fi
}

cleanup() {
  for c in ${extra_containers:-}; do docker rm -f "$c" >/dev/null 2>&1 || true; done
  if [ -n "${extra_network:-}" ]; then docker network rm "$extra_network" >/dev/null 2>&1 || true; fi
  compose down --volumes --remove-orphans --rmi local >/dev/null 2>&1 || true
  rm -f "$envfile"
}
trap cleanup EXIT

cat > "$envfile" <<EOF
POSTGRES_PASSWORD=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)
TOKEN_SECRET=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 48)
WEB_PORT=$port
WEB_SUBNET=$subnet
WEB_PROXY_IP=$proxy_ip
EOF
# Optional: SMOKE_WEB_DIST_DIR=../apps/web/dist (relative to infra/) serves the real build.
if [ -n "${SMOKE_WEB_DIST_DIR:-}" ]; then echo "WEB_DIST_DIR=$SMOKE_WEB_DIST_DIR" >> "$envfile"; fi

echo "project=$project subnet=$subnet proxy_ip=$proxy_ip port=$port"
compose up -d --build --wait --wait-timeout 180 >/dev/null
# Create the owner account the way the operator does (ADR-006), without a TTY prompt.
printf '%s\n%s\n' "$user" "$pass" | compose exec -T api python -c 'import sys; from app.config import Settings; from app.db import create_db_engine, create_session_factory; from app.repositories.owner_account import OwnerAccountRepository; from app.security import hash_password; e = create_db_engine(Settings().database_url.get_secret_value()); OwnerAccountRepository(create_session_factory(e)()).upsert(sys.stdin.readline().strip(), hash_password(sys.stdin.readline().strip()))'

base="http://127.0.0.1:$port"
hdr() { curl -s -o /dev/null -D - "$@" | tr -d '\r'; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
has() { # has "description" "header-regex" "headers"
  if printf '%s\n' "$3" | grep -qiE "$2"; then ok "$1"; else bad "$1 (missing $2)"; fi
}
lacks() {
  if printf '%s\n' "$3" | grep -qiE "$2"; then bad "$1 (found $2)"; else ok "$1"; fi
}

echo "--- routing"
check "/health through proxy" 200 "$(code "$base/health")"
check "/health body" '{"status":"ok"}' "$(curl -s "$base/health")"
check "GET /api/v1/vehicle without token" 401 "$(code "$base/api/v1/vehicle")"
check "401 body code" unauthenticated "$(curl -s "$base/api/v1/vehicle" | "$python" -c 'import json,sys; print(json.load(sys.stdin)["error"]["code"])')"
check "wrong password" 401 "$(code -X POST -H 'content-type: application/json' -d '{"username":"smoke-owner","password":"nope"}' "$base/api/v1/auth/token")"
check "SPA fallback serves index" 200 "$(code "$base/some/client/route")"

echo "--- served client"
index="$(curl -s "$base/")"
if [ -n "${SMOKE_WEB_DIST_DIR:-}" ]; then
  if printf '%s' "$index" | grep -q "placeholder page"; then bad "WEB_DIST_DIR is set but / is the placeholder"; else ok "WEB_DIST_DIR is set and / is the real build"; fi
  if "$here/check-dist.sh" "$SMOKE_WEB_DIST_DIR" >/dev/null; then ok "dist has no dotfiles or .map files"; else bad "dist check failed"; fi
  check "dotfile request is 404" 404 "$(code "$base/.env")"
  check ".map request is 404" 404 "$(code "$base/assets/index.js.map")"
else
  echo "      (SMOKE_WEB_DIST_DIR not set: serving the placeholder; set it to ../apps/web/dist to test the real build)"
fi

echo "--- headers on index.html"
h="$(hdr "$base/")"
has "CSP" "^content-security-policy: default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; connect-src 'self' https://\*\.sentry\.io\$" "$h"
has "nosniff" "^x-content-type-options: nosniff" "$h"
has "referrer-policy" "^referrer-policy: no-referrer" "$h"
has "permissions-policy" "^permissions-policy: " "$h"
has "cross-origin-opener-policy" "^cross-origin-opener-policy: same-origin" "$h"
has "index.html no-cache" "^cache-control: no-cache" "$h"
lacks "no HSTS by default" "^strict-transport-security" "$h"
lacks "no Server header" "^server:" "$h"
has "sw.js no-cache" "^cache-control: no-cache" "$(hdr "$base/sw.js")"

echo "--- headers on /api and /health"
h="$(hdr "$base/api/v1/vehicle")"
count() { printf '%s\n' "$2" | grep -ciE "$1" || true; }
check "/api Cache-Control header lines" 1 "$(count '^cache-control:' "$h")"
check "/api Cache-Control value is exactly no-store" "cache-control: no-store" "$(printf '%s\n' "$h" | grep -i '^cache-control:' | tr 'A-Z' 'a-z')"
for u in "$base/api/v1/vehicle" "$base/api/v1/nope"; do
  check "Cache-Control single no-store on $u" "cache-control: no-store" "$(hdr "$u" | grep -i '^cache-control:' | tr 'A-Z' 'a-z')"
done
check "401 login Cache-Control single no-store" "cache-control: no-store" "$(curl -s -o /dev/null -D - -X POST -H 'content-type: application/json' -d '{"username":"smoke-owner","password":"nope"}' "$base/api/v1/auth/token" | tr -d '\r' | grep -i '^cache-control:' | tr 'A-Z' 'a-z')"
check "413-style oversize body Cache-Control single no-store" "cache-control: no-store" "$(curl -s -o /dev/null -D - -X POST -H 'content-type: application/json' --data-binary "{$(head -c 70000 /dev/zero | tr '\0' ' ')}" "$base/api/v1/auth/token" | tr -d '\r' | grep -i '^cache-control:' | tr 'A-Z' 'a-z')"
has "/api CSP" "^content-security-policy:" "$h"
has "/api nosniff" "^x-content-type-options: nosniff" "$h"
has "/api referrer-policy" "^referrer-policy: no-referrer" "$h"
h="$(hdr "$base/health")"
has "/health CSP" "^content-security-policy:" "$h"
has "/health nosniff" "^x-content-type-options: nosniff" "$h"

echo "--- body cap at the proxy"
big="$(head -c 70000 /dev/zero | tr '\0' ' ')"
out="$(curl -s -w '\n%{http_code}' -X POST -H 'content-type: application/json' --data-binary "{$big}" "$base/api/v1/auth/token")"
check "70 KB body status" 400 "$(printf '%s' "$out" | tail -n1)"
check "70 KB body code" validation_error "$(printf '%s' "$out" | head -n1 | "$python" -c 'import json,sys; print(json.load(sys.stdin)["error"]["code"])')"
check "64 KiB-or-less body reaches the API (401)" 401 "$(code -X POST -H 'content-type: application/json' -d '{"username":"smoke-owner","password":"nope"}' "$base/api/v1/auth/token")"

echo "--- image"
check "no stale build/ or egg-info in the api image" "" "$(docker exec "$(compose ps -q api)" sh -c 'ls -d /srv/api/build /srv/api/*.egg-info 2>/dev/null' | tr -d '\n')"

echo "--- networks"
check "backend network is internal" true "$(docker network inspect -f '{{.Internal}}' "${project}_backend")"
check "edge network is not internal" false "$(docker network inspect -f '{{.Internal}}' "${project}_edge")"
check "egress network is not internal" false "$(docker network inspect -f '{{.Internal}}' "${project}_egress")"
check "api on backend and egress" "${project}_backend ${project}_egress" "$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$(compose ps -q api)" | tr -s ' ' '\n' | grep . | sort | tr '\n' ' ' | sed 's/ $//')"
check "db only on backend" "${project}_backend" "$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$(compose ps -q db)" | tr -d ' ')"
check "web on backend and edge" "${project}_backend ${project}_edge" "$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$(compose ps -q web)" | tr -s ' ' '\n' | grep . | sort | tr '\n' ' ' | sed 's/ $//')"
check "web static IP on backend" "$proxy_ip" "$(docker inspect -f "{{(index .NetworkSettings.Networks \"${project}_backend\").IPAddress}}" "$(compose ps -q web)")"

echo "--- ports"
api_cid="$(compose ps -q api)"; web_cid="$(compose ps -q web)"; db_cid="$(compose ps -q db)"
check "api published ports" "" "$(docker port "$api_cid" 2>/dev/null | tr -d '\n')"
check "db published ports" "" "$(docker port "$db_cid" 2>/dev/null | tr -d '\n')"
check "web published port" "127.0.0.1:$port" "$(docker port "$web_cid" 8080/tcp | grep -v '::' | tr -d '\n')"
if lsof -nP -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "SKIP  api not reachable from host (port 8000 is in use by another process; the published-ports checks above still apply)"
else
  check "api not reachable from host" 000 "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:8000/health" || true)"
fi

echo "--- real client address behind the proxy (two client containers, separate buckets)"
net="${project}_backend"
api_image="$(docker inspect -f '{{.Config.Image}}' "$api_cid")"
ca="${project}-client-a"; cb="${project}-client-b"
extra_containers="$ca $cb"
for c in $ca $cb; do
  docker run -d --name "$c" --network "$net" --entrypoint sleep "$api_image" 300 >/dev/null
done
client() { # client <container> <forwarded-for-or-empty> <password> -> HTTP status
  docker exec "$1" python -c '
import sys, urllib.request, urllib.error, json
xff, pw = sys.argv[1], sys.argv[2]
req = urllib.request.Request("http://web:8080/api/v1/auth/token", data=json.dumps({"username": "smoke-owner", "password": pw}).encode(), method="POST", headers={"content-type": "application/json"})
if xff:
    req.add_header("X-Forwarded-For", xff)
try:
    print(urllib.request.urlopen(req, timeout=10).status)
except urllib.error.HTTPError as e:
    print(e.code)
' "$2" "$3"
}
a_ip="$(docker inspect -f "{{(index .NetworkSettings.Networks \"$net\").IPAddress}}" "$ca")"
b_ip="$(docker inspect -f "{{(index .NetworkSettings.Networks \"$net\").IPAddress}}" "$cb")"
echo "      client A $a_ip, client B $b_ip, proxy $proxy_ip"
# Client A: five failures, each claiming a different X-Forwarded-For. Then the correct password.
for i in 1 2 3 4 5; do client "$ca" "198.51.100.$i" "wrong" >/dev/null; done
check "client A locked out despite spoofed X-Forwarded-For" 429 "$(client "$ca" "203.0.113.77" "$pass")"
check "client B (another address) can still log in" 200 "$(client "$cb" "" "$pass")"
logs="$(compose logs api 2>&1 | grep -E 'failed login attempt|blocked by rate limit' || true)"
echo "$logs" | sed -n '1,3p'
if echo "$logs" | grep -q "client=$a_ip"; then ok "API logs client A's real address ($a_ip)"; else bad "API did not log client A's real address"; fi
if echo "$logs" | grep -q "client=198.51.100\|client=203.0.113"; then bad "API logged a spoofed address as the client"; else ok "API logs the real peer, not the spoofed one"; fi
if echo "$logs" | grep -q "client=$proxy_ip\b"; then bad "API saw the proxy address as the client"; else ok "API does not see the proxy address as the client"; fi

echo "--- host-side requests (how Tailscale Serve on the host will arrive): one shared bucket"
# Serve connects to 127.0.0.1:$port on the host, so Caddy sees the Docker gateway address, never
# the tailnet address. Every such request must be one client to the API, whatever it claims.
edge_gw="$(docker network inspect -f '{{(index .IPAM.Config 0).Gateway}}' "${project}_edge")"
hs=(-H 'Tailscale-User-Login: placeholder@example.invalid' -H 'Tailscale-User-Name: Placeholder')
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -X POST -H 'content-type: application/json' -H "X-Forwarded-For: 198.51.100.$((100 + i))" "${hs[@]}" -d '{"username":"smoke-owner","password":"wrong"}' "$base/api/v1/auth/token"
done
login_body="{\"username\":\"$user\",\"password\":\"$pass\"}"
check "host-side login with a new spoofed X-Forwarded-For is still locked out" 429 "$(code -X POST -H 'content-type: application/json' -H 'X-Forwarded-For: 203.0.113.250' "${hs[@]}" -d "$login_body" "$base/api/v1/auth/token")"
host_clients="$(compose logs api 2>&1 | grep -E 'failed login attempt|blocked by rate limit|login succeeded' | sed -n 's/.*client=\([^ ]*\).*/\1/p' | grep -vxF -e "$a_ip" -e "$b_ip" | sort -u | tr '\n' ' ' | sed 's/ $//')"
echo "      client address(es) the API saw for host-side requests: $host_clients (edge gateway: $edge_gw)"
check "host-side requests share exactly one client address" 1 "$(printf '%s\n' "$host_clients" | wc -w | tr -d ' ')"
if printf '%s' "$host_clients" | grep -q '198.51.100\|203.0.113'; then bad "a spoofed X-Forwarded-For became the client address"; else ok "spoofed X-Forwarded-For did not become the client address"; fi
if compose logs api 2>&1 | grep -qi 'placeholder@example\|tailscale-'; then bad "API logs contain Tailscale identity header content"; else ok "API logs contain no Tailscale identity header content"; fi

echo "--- Tailscale identity headers are stripped before the API and static files (real Caddyfile)"
# A second Caddy with the real Caddyfile in front of an echo upstream that returns the request
# headers it received. Separate network so the real stack and its alias "api" are untouched.
enet="${project}-echo"; eapi="${project}-echo-api"; eweb="${project}-echo-web"
extra_containers="$extra_containers $eapi $eweb"
extra_network="$enet"
docker network create "$enet" >/dev/null
docker run -d --name "$eapi" --network "$enet" --network-alias api --entrypoint python \
  -v "$here/tests/header-echo.py:/echo.py:ro" "$api_image" /echo.py >/dev/null
docker run -d --name "$eweb" --network "$enet" -p "127.0.0.1:0:8080" \
  -e HSTS_SNIPPET=/etc/caddy/snippets/hsts-off.caddy \
  -v "$here/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$here/snippets:/etc/caddy/snippets:ro" \
  -v "$here/web-placeholder:/srv/web:ro" "$(docker inspect -f '{{.Config.Image}}' "$web_cid")" >/dev/null
eport="$(docker port "$eweb" 8080/tcp | grep -v '::' | sed 's/.*://')"
for _ in $(seq 1 30); do [ "$(code "http://127.0.0.1:$eport/health" || true)" = 200 ] && break; sleep 0.5; done
ts=(-H 'Tailscale-User-Login: placeholder@example.invalid' -H 'tailscale-user-name: Placeholder' -H 'TAILSCALE-USER-PROFILE-PIC: https://example.invalid/p.png' -H 'Tailscale-Headers-Info: https://example.invalid/info' -H 'Tailscale-Some-Future-Header: 1' -H 'X-Not-Tailscale-Prefix: keep-me')
for p in /api/v1/anything /health; do
  got="$(curl -s "${ts[@]}" "http://127.0.0.1:$eport$p")"
  check "echo upstream saw no Tailscale-* header on $p" 0 "$(printf '%s' "$got" | grep -oi '"tailscale-[a-z-]*"' | wc -l | tr -d ' ')"
  check "unrelated header still forwarded on $p" '"keep-me"' "$(printf '%s' "$got" | "$python" -c 'import json,sys; print(json.dumps(json.load(sys.stdin).get("x-not-tailscale-prefix")))')"
done
sh_="$(curl -s -D - -o /dev/null "${ts[@]}" "http://127.0.0.1:$eport/")"
check "static file request with Tailscale headers still served" 200 "$(code "${ts[@]}" "http://127.0.0.1:$eport/")"
lacks "static response does not echo Tailscale headers" "^tailscale-" "$(printf '%s' "$sh_" | tr -d '\r')"
if docker logs "$eweb" 2>&1 | grep -qi 'placeholder@example\|tailscale-user'; then bad "Caddy access/error log contains Tailscale identity content"; else ok "Caddy logs contain no Tailscale identity content"; fi

echo
if [ "$fail" -eq 0 ]; then echo "SMOKE TEST PASSED"; else echo "SMOKE TEST FAILED"; fi
exit "$fail"
