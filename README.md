# openelis-madagascar-test-harness

Test harness and dev workspace for [openelis-madagascar-distro][distro].

The distro repo IS the deployment package — it stays lean and
implementer-facing. This repo holds everything a developer needs to
build, run, validate, and iterate on the distro: build overlays,
Playwright E2E tests, dev orchestration scripts, and CI smoke tests
against tagged distro candidates.

[distro]: https://github.com/DIGI-UW/openelis-madagascar-distro

## Layout

```
.
├── compose.dev.yaml             # build: overlays for webapp/frontend/bridge
├── compose.validate.yaml        # adds analyzer-mock + Playwright runner
├── tests/playwright/            # E2E specs + helpers
├── scripts/
│   ├── restart-stack.sh         # dev orchestration: down/up + readiness
│   ├── seed-qc.sh               # Madagascar HIV-VL Westgard QC fixtures
│   ├── reset-analyzer-state.sh  # wipe analyzer state between runs
│   └── validate-compose.sh      # compose merge sanity check
├── docs/
│   ├── README.md                # dev/contributor setup guide
│   └── validation.md            # E2E validation procedures
└── .github/workflows/
    ├── analyzer-validation.yml  # PR smoke: checkout distro at ref, build, run Playwright
    └── e2e.yml                  # download tagged distro tarball, run Playwright
```

For template extraction source classification, see
[`docs/template-source-inventory.md`](docs/template-source-inventory.md).

The harness has **no submodule** for the distro. At runtime,
`scripts/restart-stack.sh` resolves where the distro lives:

1. `$DISTRO_REPO` env var (if set and points at a directory)
2. `../openelis-madagascar-distro` (sibling clone, recommended for dev)
3. Fallback: download `$DISTRO_VERSION` (default `3.2.1.7-pre-refactor`)
   tarball into `.distro-cache/`

## Quickstart — sibling clone (recommended for active dev)

```bash
# Clone both repos side-by-side:
git clone https://github.com/DIGI-UW/openelis-madagascar-distro
git clone https://github.com/DIGI-UW/openelis-madagascar-test-harness

# Sibling source repos for local builds (override with OE_REPO / BRIDGE_REPO):
git clone https://github.com/I-TECH-UW/OpenELIS-Global-2
git clone https://github.com/DIGI-UW/openelis-analyzer-bridge

cd openelis-madagascar-test-harness
./scripts/restart-stack.sh --rebuild --seed-harness
```

## Quickstart — single clone (no distro sibling)

```bash
git clone https://github.com/DIGI-UW/openelis-madagascar-test-harness
cd openelis-madagascar-test-harness
DISTRO_VERSION=3.2.1.7-pre-refactor ./scripts/restart-stack.sh --rebuild
```

The script downloads the pinned distro tarball on first run.

See [docs/README.md](docs/README.md) for flag-by-flag usage of
`restart-stack.sh` and CI workflow details.
