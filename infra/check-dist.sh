#!/usr/bin/env bash
# Post-build check for the web client output served by the proxy.
#   infra/check-dist.sh [dist-dir]      (default ../apps/web/dist, relative to infra/)
# Fails if the directory is missing, has no index.html, or contains dotfiles (.env, .git, ...)
# or source maps (*.map), none of which should be served from the proxy.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dist="${1:-../apps/web/dist}"
case "$dist" in /*) ;; *) dist="$here/$dist" ;; esac
[ -d "$dist" ] || { echo "dist directory not found: $dist" >&2; exit 1; }
[ -f "$dist/index.html" ] || { echo "no index.html in $dist (run the web build first)" >&2; exit 1; }
bad="$(find "$dist" \( -name '.*' -o -name '*.map' \) -not -path "$dist" -print)"
if [ -n "$bad" ]; then
  echo "dist contains files that must not be served:" >&2
  echo "$bad" >&2
  exit 1
fi
echo "dist ok: $dist (no dotfiles, no .map files)"
