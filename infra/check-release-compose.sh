#!/usr/bin/env bash
# Fails if docker-compose.release.yml has drifted from docker-compose.yml (ADR-012).
# Compares the fully resolved configuration of both files with the image and build lines removed.
#   infra/check-release-compose.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
printf 'POSTGRES_PASSWORD=x\nTOKEN_SECRET=y\nZEEKR_VERSION=v0.0.0\n' > "$tmp/env"
norm() {
  docker compose --env-file "$tmp/env" -f "$1" config --format json | python3 -c '
import json, sys
c = json.load(sys.stdin)
for s in c["services"].values():
    s.pop("build", None)
    if s.get("image", "").startswith("ghcr.io/"):
        s.pop("image")
print(json.dumps(c, sort_keys=True, indent=1))
'
}
norm "$here/docker-compose.yml" > "$tmp/a.json"
norm "$here/docker-compose.release.yml" > "$tmp/b.json"
if diff -u "$tmp/a.json" "$tmp/b.json"; then
  echo "release compose matches docker-compose.yml (apart from image and build)"
else
  echo "docker-compose.release.yml has drifted from docker-compose.yml" >&2
  exit 1
fi
