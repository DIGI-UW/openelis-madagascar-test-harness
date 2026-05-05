#!/usr/bin/env bash
# Rebuild + recreate ONE service in the harness stack — for tight TDD loops.
#
# Usage:
#   ./scripts/rebuild-service.sh <service-name> [--no-cache] [--wait]
#
# Examples:
#   ./scripts/rebuild-service.sh frontend.openelis.org      # rebuild frontend, recreate container
#   ./scripts/rebuild-service.sh oe.openelis.org --wait     # rebuild webapp, wait for /health + ValidateLogin
#   ./scripts/rebuild-service.sh openelis-analyzer-bridge --no-cache  # force full rebuild ignoring cache
#
# Why this exists separately from restart-stack.sh --rebuild:
#   restart-stack.sh --rebuild rebuilds ALL local images (webapp + frontend +
#   bridge + demo-tests) and does a full down/up cycle (~3-5 min). For tight
#   TDD loops where you change one file and need to re-run a Playwright spec,
#   that's wasteful (~3-4× slower than needed). This script:
#     - Builds ONLY the specified service via compose.dev.yaml's build context
#     - Does `docker compose up -d --no-deps --force-recreate <service>` so
#       only that container restarts; the rest of the stack stays up
#     - Optionally waits for stack readiness (--wait, useful for backend
#       changes that need ValidateLogin to come back online; not needed for
#       frontend-only changes since the proxy keeps serving)
#
# Service names match `docker compose config --services` output. As of
# 2026-05-04 the locally-buildable services (per compose.dev.yaml) are:
#   - oe.openelis.org           (webapp; container name openelisglobal-webapp)
#   - frontend.openelis.org     (container name openelisglobal-front-end)
#   - openelis-analyzer-bridge  (container + service name match)
#   - db.openelis.org           (container name openelisglobal-database)
#   - fhir.openelis.org         (container name external-fhir-api)
#   - proxy                     (container name openelisglobal-proxy)
#
# Container names (used by `docker exec`) differ from service names (used by
# `docker compose <verb> <service>`). This script accepts service names only.
#
# Distro resolution: same as restart-stack.sh.
#   1. $DISTRO_REPO env var
#   2. ../openelis-madagascar-distro sibling
#   3. tarball download to .distro-cache/
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <service-name> [--no-cache] [--wait]"
  echo "       Run with no args (this message) to see service-name list."
  exit 2
fi

SERVICE="$1"
shift

NO_CACHE_FLAG=""
WAIT_FLAG=""
for arg in "$@"; do
  case "$arg" in
    --no-cache) NO_CACHE_FLAG="--no-cache";;
    --wait) WAIT_FLAG="yes";;
    *) echo "Unknown flag: $arg"; exit 2;;
  esac
done

# Resolve $DISTRO_REPO (sibling-or-download) — same logic as restart-stack.sh.
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
  if [[ ! -d "$DISTRO_REPO" ]]; then
    echo "[distro] no sibling clone — downloading ${DISTRO_VERSION} tarball..."
    mkdir -p "${ROOT}/.distro-cache"
    curl -sSfL "https://github.com/DIGI-UW/openelis-madagascar-distro/archive/refs/tags/${DISTRO_VERSION}.tar.gz" \
      | tar xz -C "${ROOT}/.distro-cache"
  fi
fi

OE_REPO="${OE_REPO:-$(realpath "$ROOT/../OpenELIS-Global-2" 2>/dev/null || echo "")}"
BRIDGE_REPO="${BRIDGE_REPO:-$(realpath "$ROOT/../openelis-analyzer-bridge" 2>/dev/null || echo "")}"

COMPOSE_FILES=(
  -f "${DISTRO_REPO}/compose.yaml"
  -f compose.dev.yaml
)

# Validate the service name exists.
AVAILABLE_SERVICES="$(docker compose "${COMPOSE_FILES[@]}" config --services 2>/dev/null | sort)"
if ! echo "$AVAILABLE_SERVICES" | grep -qx "$SERVICE"; then
  echo "ERROR: '$SERVICE' is not a valid compose service."
  echo "Available services:"
  echo "$AVAILABLE_SERVICES" | sed 's/^/  /'
  exit 2
fi

# Resolve the source repo for this service (locally-built services only).
# Used for SHA tracking + cache-hit detection. Empty for registry-only
# services (db / fhir / proxy) — those skip source-sha reporting.
SOURCE_REPO=""
case "$SERVICE" in
  oe.openelis.org|frontend.openelis.org) SOURCE_REPO="$OE_REPO";;
  openelis-analyzer-bridge)              SOURCE_REPO="$BRIDGE_REPO";;
esac

SOURCE_SHA=""
SOURCE_DIRTY=""
if [[ -n "$SOURCE_REPO" && -d "$SOURCE_REPO/.git" ]]; then
  SOURCE_SHA="$(git -C "$SOURCE_REPO" rev-parse --short HEAD 2>/dev/null || echo "")"
  if ! git -C "$SOURCE_REPO" diff-index --quiet HEAD -- 2>/dev/null; then
    SOURCE_DIRTY=" +dirty"
  fi
fi

# Snapshot the image ID of the running container BEFORE any work. After
# rebuild + recreate, this should change unless the build was a full cache
# hit — that's the signal we want.
OLD_IMG="$(docker compose "${COMPOSE_FILES[@]}" images -q "$SERVICE" 2>/dev/null | head -n1 || echo "")"
OLD_IMG_SHORT="$(echo "$OLD_IMG" | cut -c1-12)"

echo "[1/4] Building $SERVICE (context resolved via compose.dev.yaml)..."
echo "      OE_REPO=$OE_REPO"
echo "      BRIDGE_REPO=$BRIDGE_REPO"
if [[ -n "$SOURCE_SHA" ]]; then
  echo "      source: $SOURCE_REPO @ $SOURCE_SHA$SOURCE_DIRTY"
fi
echo "      pre-build image: ${OLD_IMG_SHORT:-<none>}"
OE_REPO="$OE_REPO" BRIDGE_REPO="$BRIDGE_REPO" DOCKER_BUILDKIT=1 \
  docker compose "${COMPOSE_FILES[@]}" build $NO_CACHE_FLAG "$SERVICE"

echo "[2/4] Recreating $SERVICE container (--no-deps --force-recreate)..."
docker compose "${COMPOSE_FILES[@]}" up -d --no-deps --force-recreate "$SERVICE"

# After recreate, the container reflects what the build actually produced.
# If the post-recreate image == pre-build image, the build was a no-op.
CONTAINER_ID="$(docker compose "${COMPOSE_FILES[@]}" ps -q "$SERVICE" 2>/dev/null | head -n1 || echo "")"
RUNNING_IMG=""
RUNNING_IMG_CREATED=""
if [[ -n "$CONTAINER_ID" ]]; then
  RUNNING_IMG="$(docker inspect "$CONTAINER_ID" --format '{{.Image}}' 2>/dev/null | sed 's/^sha256://' || echo "")"
  if [[ -n "$RUNNING_IMG" ]]; then
    RUNNING_IMG_CREATED="$(docker image inspect "$RUNNING_IMG" --format '{{.Created}}' 2>/dev/null || echo "")"
  fi
fi
RUNNING_IMG_SHORT="$(echo "$RUNNING_IMG" | cut -c1-12)"

echo "[3/4] Build + recreate result:"
echo "      pre-build image:    ${OLD_IMG_SHORT:-<none>}"
echo "      post-recreate image: ${RUNNING_IMG_SHORT:-<none>} (created ${RUNNING_IMG_CREATED:-?})"
if [[ -n "$SOURCE_REPO" && -n "$OLD_IMG_SHORT" && -n "$RUNNING_IMG_SHORT" \
      && "$OLD_IMG_SHORT" == "$RUNNING_IMG_SHORT" && -z "$NO_CACHE_FLAG" ]]; then
  echo ""
  echo "      WARN: rebuild produced no image change (full cache hit, container on same image as before)."
  echo "            If $SOURCE_REPO has changes you expect to land, re-run with --no-cache:"
  echo "              $0 $SERVICE --no-cache${WAIT_FLAG:+ --wait}"
  echo ""
fi

if [[ -z "$WAIT_FLAG" ]]; then
  echo "[4/4] Done. (Skip readiness wait — pass --wait if you need /health + ValidateLogin to confirm.)"
  exit 0
fi

echo "[4/4] Waiting for stack readiness (same probe as restart-stack.sh)..."
TEST_USER="${TEST_USER:-admin}"
TEST_PASS="${TEST_PASS:-adminADMIN!}"
for i in $(seq 1 60); do
  if ! curl -k -sSf https://localhost/health >/dev/null 2>&1; then
    sleep 5
    continue
  fi
  LOGIN_JSON="$(curl -k -sS -X POST \
    "https://localhost/api/OpenELIS-Global/ValidateLogin?apiCall=true" \
    --data-urlencode "loginName=${TEST_USER}" \
    --data-urlencode "password=${TEST_PASS}" 2>/dev/null || true)"
  if echo "$LOGIN_JSON" | grep -q '"success":true'; then
    echo "      Stack ready after ~$((i*5))s (health + ValidateLogin both passed)"
    exit 0
  fi
  sleep 5
done

echo "FAIL: stack not ready after 300s. Last 40 webapp log lines:"
docker logs openelisglobal-webapp --tail 40 2>&1 || true
exit 1
