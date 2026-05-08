# Template Source Inventory

This Madagascar harness is the source reference for extracting a clean
`openelis-harness-template` repository. The template repository should be
created fresh with `git init`; files from this repo should be copied
deliberately after classification, not by preserving Madagascar git history.

## Generic Template Core

These files are broadly reusable after replacing Madagascar-specific defaults
and comments in the new template repo only:

- `compose.dev.yaml`
- `compose.validate.yaml`
- `.github/workflows/analyzer-validation.yml`
- `.github/workflows/e2e.yml`
- `scripts/rebuild-service.sh`
- `scripts/reset-analyzer-state.sh`
- `scripts/restart-stack.sh`
- `scripts/run-spec.sh`
- `scripts/validate-compose.sh`
- `docs/README.md`
- `docs/validation.md`
- `tests/playwright/Dockerfile`
- `tests/playwright/package.json`
- `tests/playwright/package-lock.json`
- `tests/playwright/playwright.config.ts`
- `tests/playwright/playwright/fixtures/`
- `tests/playwright/playwright/helpers/`
- `tests/playwright/playwright/tests/auth.setup.ts`
- `tests/playwright/playwright/tests/foundational/core/`
- `tests/playwright/playwright/tests/foundational/harness/api-endpoint-contract.spec.ts`
- `tests/playwright/playwright/tests/foundational/harness/file-and-results-helpers.spec.ts`

The harness template should add `distro.lock.yml` as the stable pointer to the
distro under test, then refactor scripts/workflows to read it instead of
duplicating a `DISTRO_VERSION` default.

## Madagascar Payload

These files are Madagascar UAT/demo content and should stay in generated country
harness repos, not in the base template:

- `tests/playwright/playwright/tests/foundational/harness/ogc-646-a-phone-format-madagascar.spec.ts`
- `tests/playwright/playwright/tests/foundational/harness/ogc-650-gps-form-observation.spec.ts`
- `tests/playwright/playwright/tests/foundational/harness/ogc-650-patco-program-validation.spec.ts`
- `tests/playwright/playwright/tests/foundational/harness/ogc-654-validation-note-persistence.spec.ts`
- `tests/playwright/playwright/tests/foundational/harness/ogc-669-patient-registration-journey.spec.ts`
- `tests/playwright/playwright/tests/demo/harness/analyzer-demo-flow.spec.ts`
- `scripts/seed-qc.sh`
- `tests/postman/`
- `tests/uat/`

The Madagascar analyzer demo flow is useful country payload, but it hardcodes
the Madagascar analyzer set and real-file paths such as `/mnt/la2m/...`. The
template should instead ship a tiny `tests/playwright/playwright/tests/examples/`
stub showing how a country repo adds its own workflow.

## Runtime And Local Artifacts

Generated runtime state must not be copied into the template or committed back
to this country repo:

- `.distro-cache/`
- `test-results/`
- `test-artifacts/`
- `playwright-report/`
- `tests/playwright/.env`
- `tests/playwright/node_modules/`
- `tests/playwright/playwright/.auth/`

Playwright storage state under `tests/playwright/playwright/.auth/` is generated
per run and contains session cookies. It must remain ignored.
