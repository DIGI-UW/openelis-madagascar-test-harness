#!/usr/bin/env bash
# Build a distro release tarball locally, identical in shape to a GitHub
# auto-archive at a ref.
#
# Uses `git archive`, which:
#   - reads from the git tree (not the working dir), so runtime state
#     written by containers (postgres data, certbot volumes, tomcat logs)
#     never ends up in the artifact;
#   - respects .gitattributes export-ignore for any per-path exclusions;
#   - produces the same wrap-dir layout (openelis-madagascar-distro-<ref>/)
#     consumers expect from a tagged auto-archive.
#
# Usage:
#   ./scripts/build-distro-tarball.sh                         # HEAD of sibling distro
#   REF=3.2.1.7-pre-refactor ./scripts/build-distro-tarball.sh
#   DISTRO_REPO=/abs/path REF=main ./scripts/build-distro-tarball.sh
#
# Output: <harness-root>/openelis-madagascar-distro-<ref>.tar.gz
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DISTRO_REPO="${DISTRO_REPO:-$(realpath "$ROOT/../openelis-madagascar-distro" 2>/dev/null || echo "")}"
if [[ -z "$DISTRO_REPO" || ! -d "$DISTRO_REPO/.git" ]]; then
  echo "ERROR: no distro git repo found." >&2
  echo "  Set DISTRO_REPO=/abs/path or place a sibling clone at ../openelis-madagascar-distro." >&2
  exit 1
fi

REF="${REF:-HEAD}"
REF_NAME="$(git -C "$DISTRO_REPO" describe --tags --always "$REF" 2>/dev/null || echo "local")"
WRAP_DIR="openelis-madagascar-distro-${REF_NAME}"
TARBALL="${ROOT}/${WRAP_DIR}.tar.gz"

echo "[build] distro:  $DISTRO_REPO"
echo "[build] ref:     $REF ($REF_NAME)"
echo "[build] tarball: $TARBALL"

git -C "$DISTRO_REPO" archive --format=tar.gz \
    --prefix="${WRAP_DIR}/" \
    --output="$TARBALL" \
    "$REF"

SIZE="$(du -h "$TARBALL" | awk '{print $1}')"
ENTRIES="$(tar tzf "$TARBALL" | wc -l)"
echo "[build] done — ${SIZE}, ${ENTRIES} entries"
echo
echo "Verify the artifact boots a healthy stack:"
echo "  cd /tmp && tar xzf '${TARBALL}'"
echo "  cd /tmp/${WRAP_DIR}"
echo "  docker compose up -d"
echo "  curl -k -sSf https://localhost/ -o /dev/null && echo OK"
