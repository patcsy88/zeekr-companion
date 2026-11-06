#!/usr/bin/env bash
# First-time setup: creates .env with fresh random secrets before the first "docker compose up".
#   ./install.sh                   create .env (from .env.example if it is next to this script)
#   ./install.sh --version v0.1.0  also set ZEEKR_VERSION (release install, docker-compose.release.yml)
#   ./install.sh --start           then run: docker compose up -d --wait
#
# Safety:
# - It never overwrites an existing .env. The database password is fixed when the database volume is
#   first created, so a new one would lock the API out of an existing database.
# - Secrets are written to .env (mode 600) and never printed.
# - It does not create the owner login. After the stack is up, run:
#     docker compose exec api python -m app.cli.set_owner
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
version=""
start=0
while [ $# -gt 0 ]; do
  case "$1" in
    --version) version="${2:-}"; [ -n "$version" ] || { echo "--version needs a value, for example v0.1.0" >&2; exit 2; }; shift 2 ;;
    --start) start=1; shift ;;
    -h|--help) sed -n 2,12p "$0"; exit 0 ;;
    *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

if [ -e .env ]; then
  echo ".env already exists, so nothing was changed." >&2
  echo "To start over you must remove it yourself, and also the database volume if it was already created." >&2
  exit 1
fi

random_hex() { # random_hex <bytes>
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "import secrets,sys; print(secrets.token_hex(int(sys.argv[1])))" "$1"
  else
    echo "need openssl or python3 to make random secrets" >&2
    exit 1
  fi
}

if [ -n "$version" ]; then
  case "$version" in
    v[0-9]*.[0-9]*.[0-9]*) ;;
    *) echo "version must look like v0.1.0 (got: $version)" >&2; exit 2 ;;
  esac
fi
if grep -q 'ZEEKR_VERSION' docker-compose.yml 2>/dev/null && [ -z "$version" ]; then
  echo "This is the release compose file, so it needs a version: ./install.sh --version v0.1.0" >&2
  exit 2
fi

umask 077
pg="$(random_hex 24)"      # 48 hex characters: safe inside the database URL
tok="$(random_hex 32)"     # 64 hex characters: at least 32 are required

if [ -f .env.example ]; then
  PG="$pg" TOK="$tok" VER="$version" awk '
    /^POSTGRES_PASSWORD=/ { print "POSTGRES_PASSWORD=" ENVIRON["PG"]; next }
    /^TOKEN_SECRET=/      { print "TOKEN_SECRET=" ENVIRON["TOK"]; next }
    /^# ZEEKR_VERSION=/   { if (ENVIRON["VER"] != "") print "ZEEKR_VERSION=" ENVIRON["VER"]; else print; next }
    { print }
  ' .env.example > .env
else
  {
    echo "POSTGRES_PASSWORD=$pg"
    echo "TOKEN_SECRET=$tok"
    [ -z "$version" ] || echo "ZEEKR_VERSION=$version"
  } > .env
fi
chmod 600 .env
unset pg tok

echo "Created .env in $here (mode 600) with new random POSTGRES_PASSWORD and TOKEN_SECRET."
echo "Never commit it or paste it anywhere. Back it up somewhere private: it is not recoverable."

if [ "$start" -eq 1 ]; then
  docker compose up -d --wait
  echo "Stack is up. Create the owner login now:"
else
  echo "Next:"
  echo "  docker compose up -d --wait"
fi
echo "  docker compose exec api python -m app.cli.set_owner"
