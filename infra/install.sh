#!/usr/bin/env bash
# First-time setup of a release install: creates .env with fresh random secrets. Run ./install.sh --help.
set -euo pipefail

SCRIPT_VERSION="v0.9.23"   # the release tag this file ships in; infra/check-script-version.sh checks it

here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"

usage() {
  cat <<EOF
install.sh $SCRIPT_VERSION
First-time setup of a release install: creates .env with fresh random secrets.
Run it in the folder that holds docker-compose.yml (and .env.example).

Usage: ./install.sh <flag> [<flag>]

Flags:
  --init            Check the system and Docker, then write .env from .env.example with random
                    POSTGRES_PASSWORD and TOKEN_SECRET (mode 600, never printed). On a release
                    install it first shows the latest release tag and asks y/n. Starts nothing.
  --version vN.N.N  Same as --init, with ZEEKR_VERSION set to that tag and no latest-release
                    question.
  --start           Same as --init, then: docker compose up -d --wait (up to WAIT_SECONDS,
                    default 180), the owner login (you type the username and password), MFA
                    y/n, the optional Tailscale sidecar y/n, and docker compose ps.
                    Combine it with --version to fix the tag.
  --script-version  Print this script's version and exit.
  -h, --help        Show this text and exit.

Safety:
  - It refuses to run if .env already exists (the database password is fixed when the database
    volume is first created, so a new one would lock the API out of an existing database).
  - Secrets are written to .env (mode 600) and never printed.
  - There is no default login. Only --start runs the owner-login command, and you type the
    username and password. If it fails (for example the two passwords differ) you may try up to
    3 times; after that the other steps still run (MFA is skipped, because it needs an owner),
    it prints what is still to do and exits 0. Without --start, after the stack is up, run:
      docker compose exec api python -m app.cli.set_owner
  - It never installs Docker and never runs sudo.
EOF
}
version=""
start=0
WAIT_SECONDS="${WAIT_SECONDS:-180}"
case "$WAIT_SECONDS" in
  ''|*[!0-9]*) echo "WAIT_SECONDS must be a whole number of seconds (got: $WAIT_SECONDS)" >&2; exit 2 ;;
esac
[ "$WAIT_SECONDS" -ge 30 ] || { echo "WAIT_SECONDS must be at least 30 (got: $WAIT_SECONDS)" >&2; exit 2; }
[ $# -gt 0 ] || { usage; exit 0; }
while [ $# -gt 0 ]; do
  case "$1" in
    --init) shift ;;
    --version) version="${2:-}"; [ -n "$version" ] || { echo "install.sh: --version needs a value, for example v0.1.0 (try --help)" >&2; exit 2; }; shift 2 ;;
    --start) start=1; shift ;;
    --script-version) echo "install.sh $SCRIPT_VERSION"; exit 0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "install.sh: the flag \"$1\" is not recognised." >&2; echo >&2; usage >&2; exit 2 ;;
  esac
done
echo "install.sh $SCRIPT_VERSION"

if [ -e .env ]; then
  echo ".env already exists, so nothing was changed." >&2
  echo "To start over you must remove it yourself, and also the database volume if it was already created." >&2
  exit 1
fi

# --- System checks: nothing below runs sudo; it only prints what you can run yourself ----------
OS_RELEASE_FILE="${OS_RELEASE_FILE:-/etc/os-release}"
os="$(uname -s)"
arch="$(uname -m)"
distro_id=""; distro_like=""; distro_name="$os"
if [ "$os" = "Linux" ] && [ -r "$OS_RELEASE_FILE" ]; then
  # shellcheck source=/dev/null
  IFS='|' read -r distro_id distro_like distro_name < <(. "$OS_RELEASE_FILE"; echo "${ID:-}|${ID_LIKE:-}|${PRETTY_NAME:-Linux}")
fi
echo "System: $distro_name ($os, $arch)"

if [ "$os" != "Linux" ]; then
  echo "Note: this setup is meant for a Linux host (Ubuntu Server in the docs). Continuing on $os; the checks below still apply." >&2
fi

if grep -q 'ZEEKR_VERSION' docker-compose.yml 2>/dev/null; then
  case "$arch" in
    x86_64|amd64|aarch64|arm64) ;;
    *) echo "The release images are for x86_64 and aarch64 only, and this system is $arch. Nothing was changed." >&2; exit 1 ;;
  esac
fi

debian_family=0
case " $distro_id $distro_like " in *" debian "*|*" ubuntu "*|*" raspbian "*) debian_family=1 ;; esac

suggest_docker() { # suggest_docker <what is missing>
  {
    echo "$1"
    echo "This script never installs software or runs sudo for you. To install Docker Engine with the Compose plugin:"
    echo "  Docker's install guide (apt repository on Ubuntu or Debian, as in ADR-004): https://docs.docker.com/engine/install/"
    if [ "$debian_family" -eq 1 ]; then
      echo "  Or, on Debian or Ubuntu, Docker's convenience script (proposed, not found in the repo; it runs as root, so read it first):"
      echo "    curl -fsSL https://get.docker.com -o get-docker.sh"
      echo "    less get-docker.sh"
      echo "    sudo sh get-docker.sh"
    fi
    echo "Then run the same ./install.sh command again. Nothing was changed."
  } >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || suggest_docker "Docker is not installed."
if ! docker compose version >/dev/null 2>&1; then
  if [ "$debian_family" -eq 1 ]; then
    echo "The Docker Compose plugin is missing. If Docker came from Docker's apt repository, proposed, not found in the repo: sudo apt-get install docker-compose-plugin" >&2
  fi
  suggest_docker "The Docker Compose plugin (docker compose) is missing."
fi
docker compose up --help 2>&1 | grep -q -- '--wait' \
  || suggest_docker "This Docker Compose is too old: it has no 'up --wait'."

if ! docker info >/dev/null 2>&1; then
  {
    echo "Docker is installed but not usable by this user (the service may be stopped, or your user may not be allowed to use it)."
    echo "  Check:  docker info"
    echo "  Proposed, not found in the repo: sudo systemctl start docker   (if the service is stopped)"
    echo "  Proposed, not found in the repo: sudo usermod -aG docker \"\$USER\"   then log out and in again (if permission is denied)"
  } >&2
  if [ "$start" -eq 1 ]; then echo "--start needs a working Docker, so nothing was changed." >&2; exit 1; fi
  echo "Continuing: .env can be made without it, but 'docker compose up' will need it." >&2
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
  [ -t 0 ] || { echo "This is the release compose file and no --version was given, and there is no terminal to ask on. Run: ./install.sh --version v0.1.0" >&2; exit 2; }
  tags="$(curl -fsSL --max-time 30 "https://api.github.com/repos/patcsy88/zeekr-companion/tags?per_page=100" 2>/dev/null \
    | grep -oE '"name": *"v[0-9]+\.[0-9]+\.[0-9]+"' | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | sort -uV)" || tags=""
  latest="$(printf '%s\n' "$tags" | tail -n 1)"
  if [ -z "$latest" ]; then
    echo "Could not read the latest release from GitHub. Run: ./install.sh --version v0.1.0" >&2
    exit 2
  fi
  echo "Latest release: $latest"
  if [ "$(printf '%s\n%s\n' "$SCRIPT_VERSION" "$latest" | sort -V | tail -n 1)" != "$SCRIPT_VERSION" ]; then
    echo "Note: this install.sh is $SCRIPT_VERSION but the newest release is $latest. A newer copy:"
    echo "  curl -fsSL -o install.sh https://raw.githubusercontent.com/patcsy88/zeekr-companion/$latest/infra/install.sh"
  fi
  reply=""
  read -r -p "Install $latest? [y/n] " reply || reply=""
  case "$reply" in
    y|Y) version="$latest" ;;
    *) echo "Nothing was changed. For another version run: ./install.sh --version vX.Y.Z" >&2; exit 1 ;;
  esac
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

web_port="$(sed -n 's/^WEB_PORT=//p' .env | tail -n 1)"; web_port="${web_port:-8080}"

start_stack() {
  local deadline=$((SECONDS + WAIT_SECONDS)) state="" cid left
  echo "Starting the containers (pulls the images; waiting up to ${WAIT_SECONDS}s for them to be healthy)..."
  if docker compose up -d --wait --wait-timeout "$WAIT_SECONDS"; then return 0; fi
  # Compose gives up as soon as api reports unhealthy; a slow host may still be starting it.
  while [ "$SECONDS" -lt "$deadline" ]; do
    cid="$(docker compose ps -q api 2>/dev/null || true)"
    state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$cid" 2>/dev/null || true)"
    [ "$state" = healthy ] && break
    echo "  api: ${state:-not running} ($((deadline - SECONDS))s left)"
    sleep 5
  done
  if [ "$state" != healthy ]; then
    docker compose ps >&2
    echo "api did not become healthy. Look: docker compose logs --tail 50 api" >&2
    echo ".env is kept, so do not run install.sh again. Fix the cause, then: docker compose up -d --wait" >&2
    return 1
  fi
  left=$((deadline - SECONDS)); [ "$left" -ge 30 ] || left=30
  docker compose up -d --wait --wait-timeout "$left"
}

setup_tailscale() {
  local reply="" name="" tmp
  read -r -p "Set up private HTTPS with Tailscale for your phone? (optional) [y/n] " reply || reply=""
  case "$reply" in
    y|Y) ;;
    *) echo "Skipped Tailscale. Later: infra/README.md, \"Owner runbook: private HTTPS with the Tailscale sidecar\"."; return 0 ;;
  esac
  echo "The machine name is published in public Certificate Transparency logs and cannot be taken back."
  echo "Use a neutral name: no zeekr, personal name, plate or city (for example app-1)."
  read -r -p "Machine name: " name || name=""
  name="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')"
  case "$name" in
    '') echo "No name given, so Tailscale was skipped."; return 0 ;;
    *zeekr*) echo "That name contains zeekr, so it was refused and Tailscale was skipped." >&2; return 0 ;;
  esac
  if ! [[ "$name" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]; then
    echo "Use only letters, digits and hyphens (1 to 63, not starting or ending with a hyphen). Tailscale was skipped." >&2
    return 0
  fi
  read -r -p "Use \"$name\"? It is permanent once issued. [y/n] " reply || reply=""
  case "$reply" in y|Y) ;; *) echo "Tailscale was skipped."; return 0 ;; esac
  tmp="$(mktemp .env.XXXXXX)"
  NAME="$name" awk '
    /^#? *COMPOSE_PROFILES=/ { if (!p) print "COMPOSE_PROFILES=tailscale"; p=1; next }
    /^TS_HOSTNAME=/          { print "TS_HOSTNAME=" ENVIRON["NAME"]; h=1; next }
    { print }
    END { if (!p) print "COMPOSE_PROFILES=tailscale"; if (!h) print "TS_HOSTNAME=" ENVIRON["NAME"] }
  ' .env > "$tmp"
  if ! { chmod 600 "$tmp" && mv "$tmp" .env; }; then
    rm -f "$tmp"
    echo "Could not update .env, so Tailscale was skipped." >&2
    return 0
  fi
  if ! docker compose up -d; then
    echo ".env now has COMPOSE_PROFILES=tailscale and TS_HOSTNAME=$name, but the container did not start." >&2
    echo "Check the error above, then run: docker compose up -d" >&2
    echo "After it starts, follow infra/README.md from step 4 (the Tailscale login)." >&2
    return 0
  fi
  echo "The Tailscale container is starting. It stays unhealthy until you log in (this is expected):"
  echo "  1. docker compose logs tailscale     (open the login link in a browser signed in to your Tailscale account;"
  echo "     do not paste the link anywhere)"
  echo "  2. docker compose up -d --wait       (after logging in)"
  echo "  Then follow infra/README.md from step 5 (HTTPS address, phone check, close the plain HTTP port)."
}

owner_ok=0
create_owner() { # up to 3 tries; never ends the script, so the steps after it still run
  local attempt=1 reply=""
  echo "Create the owner login (you choose the username and password; there is no default):"
  while :; do
    if docker compose exec api python -m app.cli.set_owner; then owner_ok=1; return 0; fi
    echo "Owner login not created." >&2
    if [ "$attempt" -ge 3 ]; then echo "Stopped after 3 tries." >&2; return 0; fi
    reply=""
    read -r -p "Try again? [y/n] " reply || reply=""
    case "$reply" in y|Y) attempt=$((attempt + 1)) ;; *) return 0 ;; esac
  done
}

if [ "$start" -eq 1 ]; then
  start_stack || exit 1
  owner_pending=0
  if [ -t 0 ]; then
    create_owner
    if [ "$owner_ok" -eq 1 ]; then
      reply=""
      read -r -p "Set up two-step sign-in (MFA) now? Use a private terminal. [y/n] " reply || reply=""
      case "$reply" in
        y|Y) docker compose exec api python -m app.cli.set_mfa \
               || echo "MFA not set up. Nothing was saved. To try again: docker compose exec api python -m app.cli.set_mfa" >&2 ;;
        *) echo "Skipped MFA. Later: docker compose exec api python -m app.cli.set_mfa" ;;
      esac
    else
      owner_pending=1
      echo "Skipped MFA: there is no owner account yet."
    fi
    setup_tailscale
  else
    echo "No terminal, so the prompts were skipped. Run these yourself:"
    echo "  docker compose exec api python -m app.cli.set_owner"
    echo "  docker compose exec api python -m app.cli.set_mfa   (optional)"
    echo "  Optional private HTTPS for your phone: infra/README.md, \"Owner runbook: private HTTPS with the Tailscale sidecar\""
  fi
  docker compose ps
  if [ "$owner_pending" -eq 1 ]; then
    echo "Still to do:"
    echo "  docker compose exec api python -m app.cli.set_owner"
    echo "  docker compose exec api python -m app.cli.set_mfa   (after the owner exists, optional)"
    echo "The stack is running on 127.0.0.1:${web_port}, but there is no owner login yet, so you cannot sign in."
  else
    echo "Done. The app listens on 127.0.0.1:${web_port} on this host."
  fi
else
  echo "Next:"
  echo "  docker compose up -d --wait"
  echo "  docker compose exec api python -m app.cli.set_owner"
  echo "  (or run ./install.sh --start next time to do all of this, including the owner login)"
fi
