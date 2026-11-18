#!/usr/bin/env bash
# Move a release install to the newest published version. Run ./update.sh --help for the flags.
# Run it in the folder that holds docker-compose.yml and .env (the folder install.sh was run in).
# A clone install that builds its own images is not supported: use deploy-guide.md section 7.
set -euo pipefail

SCRIPT_VERSION="v0.9.25"   # the release tag this file ships in; infra/check-script-version.sh checks it
WAIT_SECONDS="${WAIT_SECONDS:-180}"
BAR_WIDTH="${BAR_WIDTH:-6}"

repo="patcsy88/zeekr-companion"
api_url="https://api.github.com/repos/$repo"
raw_url="https://raw.githubusercontent.com/$repo"
image_api="ghcr.io/$repo-api"
image_web="ghcr.io/$repo-web"
tag_re='^v[0-9]+\.[0-9]+\.[0-9]+$'

usage() {
  cat <<EOF
update.sh $SCRIPT_VERSION
Move a release install to the newest published version.
Run it in the folder that holds docker-compose.yml and .env.

Usage: ./update.sh <flag>

Flags:
  --restart         Show the version in .env, the version api and web are running, and the
                    newest release on GitHub, with the releases in between and whether any adds
                    a database migration. Then ask y/n. Only y changes anything: it pulls the
                    api and web images (stops with nothing changed if either is missing), keeps
                    the compose file as docker-compose.yml.<old tag>, downloads the new one,
                    sets ZEEKR_VERSION in .env, then runs docker compose up -d --wait and
                    docker compose ps. Only containers whose image or settings changed are
                    recreated, so db keeps running. It always goes to the newest release.
  --script-version  Print this script's version and exit.
  -h, --help        Show this text and exit.

Settings (edit in the script, or for one run: WAIT_SECONDS=300 ./update.sh --restart):
  WAIT_SECONDS      How long to wait for healthy containers (default 180, minimum 30).
  BAR_WIDTH         Cells in the image-pull progress bar, 4 to 40 (default 6).

Safety:
  - --restart changes nothing unless you answer y.
  - If a release adds a database migration (or GitHub does not answer), it asks again and goes on
    only if you say a fresh encrypted export was taken (infra/backup/RESTORE.md, "Off-machine backup").
    It cannot check that you took it.
  - It refuses to go to a version older than the running one.
  - It never prints .env, removes containers, volumes or images, or runs prune.
EOF
}

[ $# -gt 0 ] || { usage; exit 0; }
while [ $# -gt 0 ]; do
  case "$1" in
    --restart) shift ;;
    --script-version) echo "update.sh $SCRIPT_VERSION"; exit 0 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "update.sh: the flag \"$1\" is not recognised." >&2; echo >&2; usage >&2; exit 2 ;;
  esac
done
echo "update.sh $SCRIPT_VERSION"

here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"

die() { echo "$*" >&2; exit 1; }
ask() { # ask <question>: true only for y or Y
  local reply=""
  read -r -p "$1 [y/n] " reply || return 1
  case "$reply" in y|Y) return 0 ;; *) return 1 ;; esac
}

case "$WAIT_SECONDS" in
  ''|*[!0-9]*) die "WAIT_SECONDS must be a whole number of seconds (got: $WAIT_SECONDS)" ;;
esac
[ "$WAIT_SECONDS" -ge 30 ] || die "WAIT_SECONDS must be at least 30 (got: $WAIT_SECONDS)"
case "$BAR_WIDTH" in
  ''|*[!0-9]*) die "BAR_WIDTH must be a whole number (got: $BAR_WIDTH)" ;;
esac
{ [ "$BAR_WIDTH" -ge 4 ] && [ "$BAR_WIDTH" -le 40 ]; } || die "BAR_WIDTH must be 4 to 40 (got: $BAR_WIDTH)"

for cmd in docker curl sort grep sed awk; do
  command -v "$cmd" >/dev/null 2>&1 || die "needs $cmd"
done
docker compose version >/dev/null 2>&1 || die "needs the Docker Compose plugin (docker compose)"
[ -f docker-compose.yml ] || die "no docker-compose.yml in $here"
[ -f .env ] || die "no .env in $here (run install.sh first)"
grep -q 'ZEEKR_VERSION' docker-compose.yml \
  || die "docker-compose.yml is not the release compose file; update a clone install with deploy-guide.md section 7"

# --- What is configured and what is running -------------------------------------------------
configured="$(grep -E '^ZEEKR_VERSION=' .env | tail -n 1 | cut -d= -f2- | tr -d '"'"'"' ')" || true
running=""
cid="$(docker compose ps -q api 2>/dev/null || true)"
if [ -n "$cid" ]; then
  running="$(docker inspect -f '{{.Config.Image}}' "$cid" 2>/dev/null | sed 's/.*://')" || true
fi
web_running=""
wid="$(docker compose ps -q web 2>/dev/null || true)"
if [ -n "$wid" ]; then
  web_running="$(docker inspect -f '{{.Config.Image}}' "$wid" 2>/dev/null | sed 's/.*://')" || true
fi

echo "Configured in .env:  ${configured:-not set}"
echo "Running (api):       ${running:-not running}"
echo "Running (web):       ${web_running:-not running}"

current="${running:-$configured}"
[[ "$current" =~ $tag_re ]] || die "cannot tell the current version (expected a tag like v0.1.0)"
if [ -n "$running" ] && [ -n "$configured" ] && [ "$running" != "$configured" ]; then
  echo "Note: .env says $configured but $running is running. Comparing against $running."
fi

# --- The newest published version ------------------------------------------------------------
tags="$(curl -fsSL --max-time 30 "$api_url/tags?per_page=100" \
  | grep -oE '"name": *"v[0-9]+\.[0-9]+\.[0-9]+"' | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | sort -uV)" \
  || die "could not read the release tags from GitHub; nothing was changed"
latest="$(printf '%s\n' "$tags" | tail -n 1)"
[[ "$latest" =~ $tag_re ]] || die "no release tag found on GitHub; nothing was changed"
echo "Newest release:      $latest"
if [ "$(printf '%s\n%s\n' "$SCRIPT_VERSION" "$latest" | sort -V | tail -n 1)" != "$SCRIPT_VERSION" ]; then
  echo "Note: this update.sh is $SCRIPT_VERSION but the newest release is $latest. A newer copy:"
  echo "  curl -fsSL -o update.sh $raw_url/$latest/infra/update.sh"
fi

if [ "$current" = "$latest" ]; then
  echo "Up to date. Nothing to do."
  exit 0
fi
if [ "$(printf '%s\n%s\n' "$current" "$latest" | sort -V | tail -n 1)" = "$current" ]; then
  die "$current is newer than the newest tag $latest. Refused; nothing was changed."
fi

between="$(printf '%s\n' "$tags" | awk -v a="$current" -v b="$latest" '
  BEGIN { on = 0 } $0 == a { on = 1; next } on { print } $0 == b { exit }')"
echo "Releases after $current: $(printf '%s' "$between" | tr '\n' ' ')"

# --- Does the update add a migration? --------------------------------------------------------
migration="unknown"
if compare="$(curl -fsSL --max-time 30 "$api_url/compare/$current...$latest")"; then
  found="$(printf '%s' "$compare" \
    | grep -oE '"filename": *"services/api/alembic/versions/[^"]+"' \
    | sed -E 's/.*versions\/([^"]+)"/\1/' | sort -u)" || true
  if [ -n "$found" ]; then
    migration="yes"
    echo "Database migration:  yes ($(printf '%s' "$found" | tr '\n' ' '))"
  else
    migration="no"
    echo "Database migration:  no"
  fi
else
  echo "Database migration:  unknown (GitHub did not answer). Treating it as yes."
fi

[ -t 0 ] || die "needs a terminal to answer y/n; nothing was changed"

echo
ask "Update from $current to $latest?" || { echo "Nothing was changed."; exit 0; }
if [ "$migration" != "no" ]; then
  echo "A migration runs when api starts and is not undone by going back a version."
  ask "Have you taken a fresh encrypted export (infra/backup/RESTORE.md, \"Off-machine backup\")?" \
    || { echo "Take the export first, then run ./update.sh --restart again. Nothing was changed."; exit 0; }
fi

# --- 1. Pull the new images before touching any file -----------------------------------------
bar_levels=(⣀ ⣄ ⣤ ⣦ ⣶ ⣷ ⣿)   # empty to full: 6 steps of fill inside each cell

pull_with_bar() { # pull_with_bar <heading> <image>: a [⣿⣿⣤⣀] bar that fills as layers finish
  local heading="$1" image="$2" log pid total done_n steps filled full part bar i last="" rc=0
  log="$(mktemp)"
  docker pull "$image" >"$log" 2>&1 &
  pid=$!

  draw() { # Docker's non-terminal output names each layer: "Pulling fs layer", then "Pull complete"
    total="$(grep -cE 'Pulling fs layer|Already exists' "$log" || true)"
    done_n="$(grep -cE 'Pull complete|Already exists' "$log" || true)"
    steps=$((BAR_WIDTH * 6)); filled=0
    [ "$total" -eq 0 ] || filled=$((done_n * steps / total))
    full=$((filled / 6)); part=$((filled % 6)); bar=""; i=0
    while [ "$i" -lt "$BAR_WIDTH" ]; do
      if [ "$i" -lt "$full" ]; then bar="${bar}${bar_levels[6]}"
      elif [ "$i" -eq "$full" ]; then bar="${bar}${bar_levels[$part]}"
      else bar="${bar}${bar_levels[0]}"; fi
      i=$((i + 1))
    done
    if [ -t 1 ]; then
      printf '\r%s [%s] ' "$heading" "$bar"
    elif [ "$bar" != "$last" ]; then   # not a terminal: one line per change, no carriage returns
      echo "$heading [$bar]"; last="$bar"
    fi
  }

  while kill -0 "$pid" 2>/dev/null; do draw; sleep 1; done
  wait "$pid" || rc=$?
  if [ "$rc" -eq 0 ]; then
    total=1; done_n=1; draw   # a finished pull always ends on a full bar
    if [ -t 1 ]; then printf '\n'; fi
    rm -f "$log"
  else
    if [ -t 1 ]; then printf '\n'; fi
    echo "Pull failed. Docker said:" >&2
    sed 's/^/    /' "$log" >&2
    rm -f "$log"
    return 1
  fi
}

pull_with_bar "api $latest (1 of 2)" "$image_api:$latest" || die "api image $latest could not be pulled; nothing was changed"
pull_with_bar "web $latest (2 of 2)" "$image_web:$latest" || die "web image $latest could not be pulled; nothing was changed"

# --- 2. Download the compose file(s) for the new tag and check them --------------------------
new_compose="$(mktemp docker-compose.new.XXXXXX)"
trap 'rm -f "$new_compose" "${new_lowmem:-}" "${new_env:-}"' EXIT
curl -fsSL --max-time 30 "$raw_url/$latest/infra/docker-compose.release.yml" -o "$new_compose" \
  || die "could not download the $latest compose file; nothing was changed"
grep -q 'ZEEKR_VERSION' "$new_compose" || die "the downloaded compose file looks wrong; nothing was changed"
ZEEKR_VERSION="$latest" docker compose -f "$new_compose" config -q \
  || die "the $latest compose file does not validate with this .env; nothing was changed"

new_lowmem=""
if [ -f docker-compose.lowmem.yml ]; then
  new_lowmem="$(mktemp docker-compose.lowmem.new.XXXXXX)"
  curl -fsSL --max-time 30 "$raw_url/$latest/infra/docker-compose.lowmem.yml" -o "$new_lowmem" \
    || die "could not download the $latest low-memory overlay; nothing was changed"
fi

# --- 3. Swap the files: keep the old ones next to them for going back ------------------------
cp -p docker-compose.yml "docker-compose.yml.$current"
mv "$new_compose" docker-compose.yml
if [ -n "$new_lowmem" ]; then
  cp -p docker-compose.lowmem.yml "docker-compose.lowmem.yml.$current"
  mv "$new_lowmem" docker-compose.lowmem.yml
fi

new_env="$(mktemp .env.new.XXXXXX)"
awk -v v="$latest" '
  /^ZEEKR_VERSION=/ { print "ZEEKR_VERSION=" v; done = 1; next }
  { print }
  END { if (!done) print "ZEEKR_VERSION=" v }
' .env > "$new_env"
chmod 600 "$new_env"
mv "$new_env" .env
echo "Set ZEEKR_VERSION=$latest in .env. Old compose file kept as docker-compose.yml.$current."

# --- 4. Start the new version -----------------------------------------------------------------
api_health() {
  local id
  id="$(docker compose ps -q api 2>/dev/null || true)"
  [ -n "$id" ] || { echo "not running"; return; }
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null \
    || echo "unknown"
}

start_stack() { # up to WAIT_SECONDS in total; keeps watching api if it is reported unhealthy early
  local deadline=$((SECONDS + WAIT_SECONDS)) left status
  while :; do
    left=$((deadline - SECONDS))
    [ "$left" -ge 1 ] || return 1
    echo "Starting the containers (waiting up to ${left}s for them to be healthy)..."
    if docker compose up -d --wait --wait-timeout "$left"; then
      return 0
    fi
    # Compose gives up as soon as api reports "unhealthy", but its health check keeps running and a
    # slow host can still finish starting. Watch it until it is healthy or the time is up.
    while :; do
      left=$((deadline - SECONDS))
      [ "$left" -ge 1 ] || return 1
      status="$(api_health)"
      echo "  api: $status (${left}s left)"
      [ "$status" = "healthy" ] && break
      sleep 5
    done
  done
}

if ! start_stack; then
  echo "The containers were not all healthy after ${WAIT_SECONDS}s. api is: $(api_health)." >&2
  echo "Check: docker compose ps, docker compose logs --tail 50 api" >&2
  echo "If api turns healthy later, run docker compose up -d --wait to start the rest." >&2
  echo "To go back: cp docker-compose.yml.$current docker-compose.yml, set ZEEKR_VERSION=$current in .env," >&2
  echo "then docker compose up -d --wait. A migration that already ran is not undone that way." >&2
  exit 1
fi
docker compose ps
echo "Updated to $latest."
