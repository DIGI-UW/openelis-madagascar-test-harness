#!/usr/bin/env bash
# Resolve the distro checkout used by harness scripts.
#
# Precedence:
#   1. DISTRO_REPO=/abs/path/to/distro
#   2. ./distro checkout
#   3. ../openelis-madagascar-distro sibling checkout
#   4. distro.lock.yml archive download into .distro-cache/

set -euo pipefail

resolve_distro_from_lock() {
  local root="$1"
  local lock_file="${root}/distro.lock.yml"

  if [[ ! -f "$lock_file" ]]; then
    echo "ERROR: distro lock file not found: $lock_file" >&2
    return 1
  fi

  lock_value() {
    local key="$1"
    sed -nE "s|^[[:space:]]*${key}:[[:space:]]*['\"]?([^'\"#]+)['\"]?[[:space:]]*(#.*)?$|\\1|p" "$lock_file" \
      | head -n1 \
      | sed -E 's/[[:space:]]+$//'
  }

  DISTRO_REPOSITORY="${DISTRO_REPOSITORY:-$(lock_value repository)}"
  DISTRO_REF="${DISTRO_REF:-$(lock_value ref)}"
  DISTRO_COMMIT_SHA="${DISTRO_COMMIT_SHA:-$(lock_value commit_sha)}"
  DISTRO_COMPOSE_FILE="${DISTRO_COMPOSE_FILE:-$(lock_value compose_file)}"
  DISTRO_TARBALL_URL_TEMPLATE="${DISTRO_TARBALL_URL_TEMPLATE:-$(lock_value tarball_url_template)}"

  if [[ -z "$DISTRO_REPOSITORY" || -z "$DISTRO_REF" ]]; then
    echo "ERROR: distro.lock.yml must define repository and ref" >&2
    return 1
  fi
  if [[ -z "$DISTRO_COMPOSE_FILE" ]]; then
    DISTRO_COMPOSE_FILE="docker-compose.yml"
  fi

  local explicit="${DISTRO_REPO:-}"
  if [[ -n "$explicit" && -d "$explicit" ]]; then
    DISTRO_REPO="$explicit"
  elif [[ -d "${root}/distro" ]]; then
    DISTRO_REPO="${root}/distro"
  else
    local sibling
    sibling="$(realpath "${root}/../openelis-madagascar-distro" 2>/dev/null || true)"
    if [[ -n "$sibling" && -d "$sibling" ]]; then
      DISTRO_REPO="$sibling"
    else
      local repo_name cache_key tarball_url
      repo_name="${DISTRO_REPOSITORY##*/}"
      cache_key="${DISTRO_REF//\//-}"
      DISTRO_REPO="${root}/.distro-cache/${repo_name}-${cache_key}"
      if [[ ! -d "$DISTRO_REPO" ]]; then
        echo "[distro] no local checkout — downloading ${DISTRO_REPOSITORY}@${DISTRO_REF}..."
        mkdir -p "${root}/.distro-cache"
        tarball_url="${DISTRO_TARBALL_URL_TEMPLATE//\{repository\}/$DISTRO_REPOSITORY}"
        tarball_url="${tarball_url//\{ref\}/$DISTRO_REF}"

        # Extract into a per-call scratch dir so the destination move can't
        # accidentally pick up an unrelated cached `${repo_name}-*` folder
        # left from a previous ref. The tarball produces exactly one
        # top-level directory; we move that under the deterministic cache
        # key path and discard the scratch.
        local scratch extracted
        scratch="$(mktemp -d "${root}/.distro-cache/.scratch-XXXXXXXX")"
        if ! curl -sSfL "$tarball_url" | tar xz -C "$scratch"; then
          rm -rf "$scratch"
          echo "ERROR: failed to download/extract distro tarball $tarball_url" >&2
          return 1
        fi
        extracted="$(find "$scratch" -mindepth 1 -maxdepth 1 -type d | head -n1)"
        if [[ -z "$extracted" ]]; then
          rm -rf "$scratch"
          echo "ERROR: distro tarball produced no top-level directory" >&2
          return 1
        fi
        mv "$extracted" "$DISTRO_REPO"
        rm -rf "$scratch"
      fi
    fi
  fi

  DISTRO_COMPOSE="${DISTRO_REPO}/${DISTRO_COMPOSE_FILE}"
  if [[ ! -f "$DISTRO_COMPOSE" ]]; then
    echo "ERROR: distro compose file not found: $DISTRO_COMPOSE" >&2
    return 1
  fi

  export DISTRO_REPOSITORY DISTRO_REF DISTRO_COMMIT_SHA DISTRO_COMPOSE_FILE
  export DISTRO_TARBALL_URL_TEMPLATE DISTRO_REPO DISTRO_COMPOSE
}
