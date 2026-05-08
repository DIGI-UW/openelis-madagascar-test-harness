#!/usr/bin/env bash
# Verifies docker compose files parse and merge (no containers started).
# Tests every overlay combination scripts/restart-stack.sh and the docs use.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

source "${ROOT}/scripts/resolve-distro.sh"
resolve_distro_from_lock "$ROOT"

docker compose -f "$DISTRO_COMPOSE" config -q
docker compose -f "$DISTRO_COMPOSE" -f compose.validate.yaml config -q
if [[ -f "${DISTRO_REPO}/compose.letsencrypt.yaml" ]]; then
  docker compose -f "$DISTRO_COMPOSE" -f "${DISTRO_REPO}/compose.letsencrypt.yaml" config -q
fi
docker compose \
  -f "$DISTRO_COMPOSE" \
  -f compose.validate.yaml \
  config -q

echo "OK: compose files are valid for ${DISTRO_COMPOSE} plus harness overlays."
