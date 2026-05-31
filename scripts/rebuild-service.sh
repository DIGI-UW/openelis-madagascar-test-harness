#!/usr/bin/env bash
# Rebuild + recreate ONE service of the running harness stack, in place.
#
# This is the targeted-iteration counterpart to restart-stack.sh --rebuild
# (which rebuilds ALL images and recreates the whole stack). Use this when you
# changed source in exactly one repo (webapp / frontend / bridge / mock) and
# want that change deployed without bouncing the DB, proxy, FHIR, etc.
#
#   ./scripts/rebuild-service.sh oe.openelis.org        # webapp (OE2 src change)
#   ./scripts/rebuild-service.sh openelis-analyzer-bridge
#   ./scripts/rebuild-service.sh frontend.openelis.org
#   ./scripts/rebuild-service.sh analyzer-mock
#
# Why this exists (do NOT hand-roll `docker compose -f … build <svc>`):
#   reconstructing the compose invocation by hand means reconstructing the
#   3-file overlay + the DISTRO_REPO/OE_REPO/BRIDGE_REPO resolution + the LE
#   overlay — get any of it subtly wrong and your change doesn't actually
#   deploy. This script reuses restart-stack.sh's EXACT resolution so a
#   single-service rebuild is as trustworthy as the full one.
#
# Compose layering / distro resolution: identical to restart-stack.sh
# (see that script's header). Service names come from compose.dev.yaml /
# compose.validate.yaml: oe.openelis.org, frontend.openelis.org,
# openelis-analyzer-bridge, analyzer-mock.
#
# Modeled on the OE2 analyzer-harness build.sh pattern: pass the explicit
# service name to `compose build` (a missing build: directive then errors
# loudly instead of silently no-op'ing), and verify the service is actually
# healthy afterward rather than trusting the build.
set -euo pipefail

SERVICE="${1:-}"
if [[ -z "$SERVICE" ]]; then
  echo "usage: $0 <service>   (oe.openelis.org | frontend.openelis.org | openelis-analyzer-bridge | analyzer-mock)" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PROJECT_LABEL="com.docker.compose.project=openelis-madagascar-test-harness"

# --- Resolve $DISTRO_REPO (sibling-or-cache). Mirrors restart-stack.sh. -------
DISTRO_REPO="${DISTRO_REPO:-}"
if [[ -z "$DISTRO_REPO" ]]; then
  SIBLING="$(realpath "$ROOT/../openelis-madagascar-distro" 2>/dev/null || echo "")"
  if [[ -n "$SIBLING" && -d "$SIBLING" ]]; then
    DISTRO_REPO="$SIBLING"
  fi
fi
if [[ -z "$DISTRO_REPO" || ! -d "$DISTRO_REPO" ]]; then
  DISTRO_VERSION="${DISTRO_VERSION:-3.2.1.7-pre-refactor}"
  DISTRO_REPO="${ROOT}/.distro-cache/openelis-madagascar-distro-${DISTRO_VERSION}"
fi
if [[ ! -d "$DISTRO_REPO" ]]; then
  echo "ERROR: \$DISTRO_REPO not found ($DISTRO_REPO). Run ./scripts/restart-stack.sh once to populate it." >&2
  exit 1
fi
echo "[distro] using $DISTRO_REPO"
# Export so compose.validate.yaml's ${DISTRO_REPO} interpolation (the
# analyzer-profiles bind mount) resolves to the repo we actually resolved —
# not its `../openelis-madagascar-distro` default, which is wrong in cache mode.
export DISTRO_REPO

COMPOSE="docker compose \
  -f ${DISTRO_REPO}/compose.yaml \
  -f compose.dev.yaml \
  -f compose.validate.yaml"

# Layer the Let's Encrypt overlay when the distro provides one and it's
# configured — same condition restart-stack.sh uses, so `up -d <svc>` doesn't
# recreate against a different compose set than the running stack was started
# with.
LE_OVERLAY="${DISTRO_REPO}/compose.letsencrypt.yaml"
LE_ENV_FILE="${DISTRO_REPO}/.env.letsencrypt"
if [[ -f "$LE_OVERLAY" && -f "$LE_ENV_FILE" ]]; then
  echo "[compose] layering Let's Encrypt overlay"
  COMPOSE="$COMPOSE -f ${LE_OVERLAY}"
fi

# Build contexts come from the sibling working trees (no commit required).
export OE_REPO="${OE_REPO:-$(realpath "$ROOT/../OpenELIS-Global-2" 2>/dev/null || echo "")}"
export BRIDGE_REPO="${BRIDGE_REPO:-$(realpath "$ROOT/../openelis-analyzer-bridge" 2>/dev/null || echo "")}"

# --- Build just this service, then recreate just this service. ---------------
BUILD_LOG_DIR="/tmp/rebuild-service"
mkdir -p "$BUILD_LOG_DIR"
LOG="$BUILD_LOG_DIR/${SERVICE//[^a-zA-Z0-9]/_}.log"
echo "[1/3] Building $SERVICE (full log: $LOG)..."
DOCKER_BUILDKIT=1 $COMPOSE build --pull "$SERVICE" 2>&1 | tee "$LOG" | tail -2

echo "[2/3] Recreating $SERVICE (up -d, force-recreate, no deps)..."
$COMPOSE up -d --no-deps --force-recreate "$SERVICE"

# --- Verify the service is actually healthy (behavior, not artifact). --------
echo "[3/3] Verifying $SERVICE health..."
probe() {
  case "$SERVICE" in
    oe.openelis.org)
      curl -k -sS -X POST \
        "https://localhost/api/OpenELIS-Global/ValidateLogin?apiCall=true" \
        --data-urlencode "loginName=${TEST_USER:-admin}" \
        --data-urlencode "password=${TEST_PASS:-adminADMIN!}" 2>/dev/null \
        | grep -q '"success":true'
      ;;
    frontend.openelis.org) curl -k -sSf https://localhost/health >/dev/null 2>&1 ;;
    openelis-analyzer-bridge) curl -k -sSf https://localhost:8442/actuator/health >/dev/null 2>&1 ;;
    analyzer-mock) curl -sSf http://localhost:8085/health >/dev/null 2>&1 ;;
    *) return 0 ;;  # unknown service: skip probe, rely on compose exit code
  esac
}
READY=""
for i in $(seq 1 36); do  # up to 180s
  if probe; then
    READY="yes"
    echo "    $SERVICE healthy after ~$((i*5))s"
    break
  fi
  sleep 5
done
if [[ -z "$READY" ]]; then
  echo "FAIL: $SERVICE not healthy after 180s. Last 40 log lines:" >&2
  docker compose -f "${DISTRO_REPO}/compose.yaml" -f compose.dev.yaml -f compose.validate.yaml \
    logs "$SERVICE" --tail 40 2>&1 || true
  exit 1
fi
echo "Done. $SERVICE rebuilt + recreated from local source."
