# LO-07-02 / -03 / -04 mgtest validation — preflight notes

Server prepared 2026-05-01 for UAT V2 testing of:
- **LO-07-02** Internal Control (Westgard rules)
- **LO-07-03** Calibration / verification samples (EQA mapping)
- **LO-07-04** Invalid quality indicators (Alerts pass-through)

## What's ready for testers/screenshots

### Phase 1 — Mock subdomain (DONE)
- `mock.mgtest.openelis-global.org` resolves with a real Let's Encrypt cert
  (SAN-expanded from the existing `mgtest.openelis-global.org` lineage,
  expires 2026-07-29).
- nginx server block at [configs/nginx/nginx.conf](../../../openelis-madagascar-distro/configs/nginx/nginx.conf) proxies to `openelis-analyzer-mock:8080`.
- Verify: `curl https://mock.mgtest.openelis-global.org/health` → 200 with mock endpoint table.

### Phase 2 — Mock FILE + HL7 QC support (DONE)
- Mock now supports `qc=true, qc_deviation=N` body params on all three lanes:
  ASTM, FILE, HL7. Generation is profile-driven and deterministic.
- Mock template `qc_controls` arrays added to `quantstudio5.json` (LPC + HPC)
  and `mindray_bs200.json` (GLU).
- OE-side `mindray-bs200.json` HL7 profile gained `qcRules: [SPECIMEN_ID_PREFIX QC]`
  so the bridge correctly classifies generated HL7 QC samples.
- 17 contract tests in [test_qc_message.py](../../../OpenELIS-Global-2/tools/analyzer-mock-server/test_qc_message.py) all pass (6 ASTM + 5 FILE + 6 HL7).
- Mock image rebuilt as `itechuw/astm-mock-server:local` and redeployed.

### Phase 3 — Postman trigger collection (DONE)
- [tests/postman/openelis-mgtest-qc.postman_collection.json](../postman/openelis-mgtest-qc.postman_collection.json) — 6 folders, 18 requests, 14 assertions.
- Newman validation passed clean: 18 requests / 0 failed, 14 assertions / 0 failed.
- All requests trigger the mock; the mock owns wire-format generation + transport.
  Postman never uploads payloads.

### Phase 4 — LO-07-02 + LO-07-04 TSVs (DONE)
- [tests/uat/lo-07-02-steps.tsv](lo-07-02-steps.tsv) — 15 rows × 6 columns, trailing-tab
  padded. ASTM (steps 0–11), FILE-lane parity (12), HL7-lane parity (13),
  optional e-sign bullet (14).
- [tests/uat/lo-07-04-steps.tsv](lo-07-04-steps.tsv) — 5 rows × 6 columns. 3-step
  Alerts-tab pass-through that piggybacks on LO-07-02 violations.

### Phase 5 — LO-07-03 EQA setup (DONE)
- Madagascar overlay menu fix applied: [configs/menu/menu_config.json](../../../openelis-madagascar-distro/configs/menu/menu_config.json)
  swaps orphan `menu_eqa_tests` + `menu_eqa_mgmt` for `menu_eqa` with
  `childMenus: ["*"]` so the real EQA tree (Management / Distribution /
  My Programs / Orders / Results / Participants) renders.
- EQA program seeded: "WHO AFRO HIV-VL Cycle 2026-Q2" (provider=WHO AFRO, id=1).
  Confirms LO-07-03 V1 step 13 FAIL was a data-only gap.
- [tests/uat/lo-07-03-steps.tsv](lo-07-03-steps.tsv) — 10 rows × 6 columns. Steps 0-5
  testable today; steps 6-8 marked PARTIAL with openelis-work spec refs.
- Harness `seed-qc.sh` extended to seed Mindray BS-200 + LOT-GLU-N + EQA program
  on every `--seed-harness` run.

## What testers need to do

1. **Import** the Postman collection + environment from
   `tests/postman/`. Activate the environment "OpenELIS mgtest".
2. **Run Folder #1** (Health & Inventory) — confirm mock is reachable.
3. **Walk LO-07-02** ([lo-07-02-steps.tsv](lo-07-02-steps.tsv)) end-to-end. Capture
   screenshots into `screenshots/lo-07-02/`. Mark each step PASS / FAIL / PARTIAL
   and fill the Screenshot column with the relative file path.
4. **Walk LO-07-04** ([lo-07-04-steps.tsv](lo-07-04-steps.tsv)) using the LO-07-02
   seeded violations. Screenshots into `screenshots/lo-07-04/`.
5. **Walk LO-07-03** ([lo-07-03-steps.tsv](lo-07-03-steps.tsv)) end-to-end. Steps 6-8
   are pre-flagged PARTIAL — capture the Reports → Routine state for step 6 to
   document the report-filter gap.
6. **Post the three TSVs** into GRIST raw_Testing Details.

## Known landmines

### Webapp restart re-validates Hibernate against schema
The `feat/madagascar-qc-demo` OE image still has compiled bytecode referencing
the dropped `analyzer.archive_directory` and `error_directory` columns. On
webapp restart, Hibernate validation against the current schema (where the
columns have been Liquibase-dropped via `3.4.14.x/012-drop-analyzer-archive-error-directories.xml`)
fails the `pluginRegistryService` bean init, which cascades into a full Spring
context startup failure. **Symptom**: every REST endpoint returns 302 redirects
to `/OpenELIS-Global/`.

**Workaround applied**: re-added the columns via `ALTER TABLE ... ADD COLUMN
IF NOT EXISTS`. The webapp now starts cleanly. The columns are unused at
runtime (the bridge owns archive routing); they're back only as Hibernate-mapping
placeholders.

**Proper fix** (Mekom scope): rebuild `itechuw/openelis-global-2:local` from the
latest `feat/madagascar-qc-demo` head OR rebase onto develop, then re-run
Liquibase to remove the placeholder columns. Out of scope for V2 prep.

### Mock per-analyzer source IPs need `--seed-harness`
The mock's per-analyzer docker networks (e.g., `mock-analyzer-genexpert`)
allocate specific source IPs (10.42.20.10 for the GeneXpert lane). Force-recreating
the mock container via `docker compose up -d --force-recreate analyzer-mock`
detaches those networks; ASTM pushes will fail with "Cannot assign requested
address" until reconnected. **Workaround applied**: `docker network connect
mock-analyzer-genexpert openelis-analyzer-mock` (and bc5380 equivalent).

**Proper fix**: re-run `restart-stack.sh --seed-harness` to re-register
analyzers via the OE harness REST API, which restores the per-analyzer network
bindings cleanly.

### EQA REST endpoint requires basic auth + JSESSIONID round-trip
Spring Security on the deployed branch has form-login enabled alongside HTTP
Basic; basic auth succeeds (Set-Cookie issued) but the response is 302 to the
saved-request handler. Postman handles this correctly because it sends the
JSESSIONID back; some `curl` patterns don't.

## What's PARTIAL (V2 acceptance criteria for Mekom)

- **LO-07-03 step 6** — Reports → Routine doesn't filter on `is_eqa_sample`.
  Spec ref: [openelis-work eqa-requirements.md BR-001](https://github.com/DIGI-UW/openelis-work/blob/main/designs/quality/eqa-requirements.md).
- **LO-07-03 step 7** — Analyzer Manual QC feature unimplemented.
  Spec ref: [openelis-work analyzer-manual-qc.md](https://github.com/DIGI-UW/openelis-work/blob/main/designs/quality/analyzer-manual-qc.md).
- **LO-07-03 step 8** — Reagent QC + Batch Workplan integration unimplemented.
  Spec ref: [openelis-work batch-workplan-reagent-qc.md](https://github.com/DIGI-UW/openelis-work/blob/main/designs/quality/batch-workplan-reagent-qc.md).
- **LO-07-02 step 14 (optional)** — E-signature on QC review surface; verify on
  walkthrough whether the resolved-violation page exposes an e-sign control,
  flag PARTIAL with Mekom note if not.
- **LO-07-02 step 11** — Patient release gating (FR7.7) requires a clinical
  sample queued during the open-violation window; if no such sample is staged,
  mark PARTIAL.

## Files changed

| Repo | Path | Change |
|---|---|---|
| openelis-madagascar-distro | `.env.letsencrypt` | NEW — SAN-expanded LE config |
| openelis-madagascar-distro | `configs/nginx/nginx.conf` | Added `mock.mgtest…` server block |
| openelis-madagascar-distro | `configs/menu/menu_config.json` | EQA menu overlay fix |
| OpenELIS-Global-2 | `tools/analyzer-mock-server/protocols/file_handler.py` | `generate_qc()` |
| OpenELIS-Global-2 | `tools/analyzer-mock-server/protocols/hl7_handler.py` | `generate_qc()` + `generate_qc_oru_r01()` |
| OpenELIS-Global-2 | `tools/analyzer-mock-server/api.py` | qc body params on FILE + HL7 endpoints; `_upload_qc_content_to_bridge` helper |
| OpenELIS-Global-2 | `tools/analyzer-mock-server/templates/quantstudio5.json` | `qc_controls` (LPC + HPC) |
| OpenELIS-Global-2 | `tools/analyzer-mock-server/templates/mindray_bs200.json` | `qc_controls` (GLU) |
| OpenELIS-Global-2 | `tools/analyzer-mock-server/test_qc_message.py` | FILE + HL7 contract tests (11 new) |
| OpenELIS-Global-2 | `projects/analyzer-profiles/hl7/mindray-bs200.json` | `qcRules: [SPECIMEN_ID_PREFIX QC]` |
| openelis-madagascar-test-harness | `scripts/seed-qc.sh` | Mindray BS-200 lot + EQA program seed |
| openelis-madagascar-test-harness | `tests/postman/*` | Collection + env + README (NEW) |
| openelis-madagascar-test-harness | `tests/uat/lo-07-{02,03,04}-steps.tsv` | TSVs (NEW) |
| openelis-madagascar-test-harness | `tests/uat/screenshots/lo-07-{02,03,04}/` | Empty dirs for tester captures (NEW) |
