#!/usr/bin/env bash
# Run a Playwright spec against an arbitrary BASE_URL with credentials
# encapsulated in the script (rather than passed inline on the command line).
#
# Why: inline `TEST_PASS=adminADMIN! npx playwright test ...` invocations leave
# a credential-shaped string in shell history + AI assistant context. This
# wrapper keeps that out of the visible conversation.
#
# Usage:
#   ./scripts/run-spec.sh '<grep-pattern>'                # against mgtest by default
#   BASE_URL=https://mgtest.openelis-global.org ./scripts/run-spec.sh 'OGC-654'
#   ./scripts/run-spec.sh 'OGC-648' --reporter=line       # extra args forwarded
#
# Defaults:
#   BASE_URL=https://mgtest.openelis-global.org
#   TEST_USER=admin
#   TEST_PASS=adminADMIN!         # canonical OE2 demo password from auth.setup.ts
#   project=harness-foundational
#
# Override env: BASE_URL, TEST_USER, TEST_PASS, PROJECT.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 '<grep-pattern>' [extra-playwright-args...]"
  echo "Example: $0 'OGC-648'"
  exit 2
fi

GREP="$1"
shift

export BASE_URL="${BASE_URL:-https://mgtest.openelis-global.org}"
export TEST_USER="${TEST_USER:-admin}"
export TEST_PASS="${TEST_PASS:-adminADMIN!}"
PROJECT="${PROJECT:-harness-foundational}"

cd "$ROOT/tests/playwright"
npx playwright test --project="$PROJECT" --grep "$GREP" "$@"
