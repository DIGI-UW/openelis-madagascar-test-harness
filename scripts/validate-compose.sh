#!/usr/bin/env bash
# Verifies docker compose files parse and merge (no containers started).
# Tests every overlay combination scripts/restart-stack.sh and the docs use,
# including the all-overlays case so a breaking interaction between
# compose.validate.yaml and compose.letsencrypt.yaml is caught here rather
# than at deploy time.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

source "${ROOT}/scripts/resolve-distro.sh"
resolve_distro_from_lock "$ROOT"

# Base distro compose alone.
docker compose -f "$DISTRO_COMPOSE" config -q

# Base + harness validate overlay (the standard local + CI shape).
docker compose -f "$DISTRO_COMPOSE" -f compose.validate.yaml config -q

# Base + letsencrypt overlay (production-shape) and base + validate +
# letsencrypt all-overlays. The letsencrypt overlay is optional in the
# distro tree, so only validated when present in the resolved distro
# checkout.
if [[ -f "${DISTRO_REPO}/compose.letsencrypt.yaml" ]]; then
  docker compose -f "$DISTRO_COMPOSE" -f "${DISTRO_REPO}/compose.letsencrypt.yaml" config -q
  docker compose \
    -f "$DISTRO_COMPOSE" \
    -f compose.validate.yaml \
    -f "${DISTRO_REPO}/compose.letsencrypt.yaml" \
    config -q
fi

echo "OK: compose files are valid for ${DISTRO_COMPOSE} plus harness overlays."
