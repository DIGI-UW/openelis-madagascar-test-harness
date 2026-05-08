# Developer setup

## Prerequisites

- Docker + Docker Compose v2
- Node.js 20+ (only if running Playwright outside the demo-tests container)
- Sibling source checkouts (defaults shown; override with env vars):
  - `../openelis-madagascar-distro` (`DISTRO_REPO`)
  - `../OpenELIS-Global-2` (`OE_REPO`)
  - `../openelis-analyzer-bridge` (`BRIDGE_REPO`)

If no local distro checkout is available, the harness downloads the ref from
`distro.lock.yml` into `.distro-cache/` on first run.

## Compose layering

| File | Source | Purpose |
|---|---|---|
| `${DISTRO_COMPOSE}` | distro (resolved from `distro.lock.yml`) | Base stack — registry images, prod-shaped |
| `compose.dev.yaml` | harness | `build:` overlays for webapp/frontend/bridge |
| `compose.validate.yaml` | harness | analyzer-mock service + Playwright runner |

```bash
# After restart-stack.sh resolves DISTRO_REPO, the equivalent CLI is:
docker compose \
  -f $DISTRO_COMPOSE \
  -f compose.dev.yaml \
  -f compose.validate.yaml \
  up -d
```

## restart-stack.sh

```bash
./scripts/restart-stack.sh                   # restart, keep data
./scripts/restart-stack.sh --clean           # restart, wipe DB + volumes
./scripts/restart-stack.sh --rebuild         # rebuild local images first
./scripts/restart-stack.sh --clean --rebuild
./scripts/restart-stack.sh --clean --seed-harness   # also seed analyzer harness via REST
```

Environment overrides:

```bash
DISTRO_REPO=/abs/path/to/distro ./scripts/restart-stack.sh        # explicit distro path
DISTRO_REF=main ./scripts/restart-stack.sh                         # validate a different distro ref
OE_REPO=/abs/path/OE-Global-2 ./scripts/restart-stack.sh --rebuild
```

`--seed-harness` requires `$OE_REPO/projects/analyzer-harness/seed-analyzers.sh`
and additionally seeds the Madagascar HIV-VL Westgard QC config via
`scripts/seed-qc.sh` (idempotent).

## Running Playwright

Inside the demo-tests container (matches CI):

```bash
docker compose \
  -f $DISTRO_COMPOSE \
  -f compose.dev.yaml \
  -f compose.validate.yaml \
  run --rm demo-tests \
  npx playwright test --project=harness-foundational
```

Outside (host node, faster iteration):

```bash
cd tests/playwright
npm ci
npx playwright test --project=harness-foundational
```

## CI workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `analyzer-validation.yml` | PR + dispatch | Checks out distro at the locked ref unless dispatch overrides `distro_ref`, builds local images via `compose.dev.yaml`, runs Playwright. Catches "harness PR breaks against current distro." |
| `e2e.yml` | Nightly + dispatch | Downloads the locked distro ref unless dispatch overrides `distro_ref`, runs Playwright against registry images only. Catches "pinned distro release works for implementer-shaped consumption." |

Both workflows take an optional `distro_ref` input on dispatch — useful
for validating an arbitrary distro PR or tag.

## See also

- [validation.md](validation.md) — E2E validation procedures
- [Distro README](https://github.com/DIGI-UW/openelis-madagascar-distro) — implementer-facing deployment docs
