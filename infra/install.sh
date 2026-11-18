#!/usr/bin/env bash
# First-time setup: creates .env with fresh random secrets before the first "docker compose up".
#   ./install.sh                   create .env (from .env.example if it is next to this script)
#   ./install.sh --version v0.1.0  also set ZEEKR_VERSION (release install, docker-compose.release.yml)
#                                  without --version, a release install shows the latest release tag
#                                  from GitHub and asks y/n before using it
#   ./install.sh --start           then run: docker compose up -d --wait
#                                  first it checks the system (Linux and distro, x86_64 or aarch64) and that
#                                  Docker and the Compose plugin work; if not, it suggests how to install them
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
    -h|--help) sed -n 2,16p "$0"; exit 0 ;;
    *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

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
    echo "Then run ./install.sh again. Nothing was changed."
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

if [ "$start" -eq 1 ]; then
  docker compose up -d --wait
  echo "Stack is up. Create the owner login now:"
else
  echo "Next:"
  echo "  docker compose up -d --wait"
fi
echo "  docker compose exec api python -m app.cli.set_owner"
