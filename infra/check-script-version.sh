#!/usr/bin/env bash
# Fails unless SCRIPT_VERSION in install.sh and update.sh, and the "File version" line at the top of
# docker-compose.release.yml and .env.example, equal the release tag.
#   infra/check-script-version.sh v0.9.21      (or set GITHUB_REF_NAME, as the release workflow does)
# Run it before tagging: a tag cannot hold its own number, so the number is bumped in a commit first.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tag="${1:-${GITHUB_REF_NAME:-}}"
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: $0 vN.N.N (got: ${tag:-nothing})" >&2; exit 2; }
bad=0
for f in install.sh update.sh; do
  found="$(sed -n 's/^SCRIPT_VERSION="\(v[0-9.]*\)".*/\1/p' "$here/$f" | head -n 1)"
  if [ "$found" = "$tag" ]; then
    echo "$f: $found matches $tag"
  else
    echo "$f: SCRIPT_VERSION is '${found:-missing}' but the tag is $tag" >&2
    bad=1
  fi
done
for f in docker-compose.release.yml .env.example; do
  found="$(sed -n 's/^# File version: \(v[0-9.]*\) .*/\1/p' "$here/$f" | head -n 1)"
  if [ "$found" = "$tag" ]; then
    echo "$f: File version $found matches $tag"
  else
    echo "$f: the File version line is '${found:-missing}' but the tag is $tag" >&2
    bad=1
  fi
done
[ "$bad" -eq 0 ] || { echo "Set SCRIPT_VERSION in both scripts and the File version line in both files to $tag, commit, and tag that commit." >&2; exit 1; }
