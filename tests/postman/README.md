# OpenELIS mgtest QC — Postman Collection

A trigger-only Postman collection for preparing Westgard QC scenarios on the
mgtest server (https://mgtest.openelis-global.org). Drives all three transport
lanes (ASTM, FILE, HL7) through `https://mock.mgtest.openelis-global.org` and
uses mock-API sanity checks for trigger responses.

## Design principle

**Postman triggers the mock; the mock owns wire-format generation + transport.**
Postman never uploads payloads and does not pass bridge transport details.
Every QC trigger is a `POST {{mock_url}}/simulate/{lane}/{template}` with
scenario intent only (`qc`, `qc_deviation`, optional `count`).

The mock applies internal delivery defaults and pushes to the bridge on the
docker-internal network.

## Files

| File | Purpose |
|---|---|
| `openelis-mgtest-qc.postman_collection.json` | The collection (6 folders, ~15 requests) |
| `openelis-mgtest.postman_environment.json`    | Default env: demo creds + URLs |

## First-time setup

1. **Import** both files into Postman (File → Import).
2. **Activate the environment**: dropdown top-right → "OpenELIS mgtest".
3. **Verify health** — Folder #1: `GET /health`, `GET /analyzers`. Both should return 200.
4. **(Optional) seed EQA** — Folder #6: `POST seed WHO AFRO HIV-VL Cycle 2026-Q2`. Returns 200 (or 409 if already seeded).
5. **Drive a QC scenario** — Folder #2 / #3 / #4. Each request returns 200 with a
   JSON body summarizing the generated message + push status.
6. **Validate in OpenELIS UI** — use QC Dashboard, Alerts, and Instrument Detail
   as the validation surface. Folder #5 API calls are sanity checks only.

## Folder-by-folder

- **1. Health & Inventory** — GET requests to confirm the mock is reachable and
  list registered analyzer networks. Run these first.
- **2. ASTM QC — GeneXpert (HIV-VL)** — Five scenario-only requests covering each Westgard
  rule: baseline pass, 1-3s, 2-2s, R-4s pair, 4-1s sequence. LOT-HIVVL-N
  (mean=1250 copies/mL, SD=125).
- **3. FILE QC — QuantStudio 5 (VIH-1)** — Mock generates QC CSV content with
  `Sample Name=QC-{lot}-{level}` + `Task=STANDARD` and applies internal delivery
  defaults. LOT-LPC-26B (target=32.0 Ct, SD=0.5).
- **4. HL7 QC — Mindray BS-200 (GLU)** — Mock generates ORU^R01 with
  `OBR-3=QC-{lot}-{level}` and applies internal delivery defaults. LOT-GLU-N
  (target=100 mg/dL, SD=5).
- **5. OE-Side Verification** — HTTP Basic GETs for `/qc/violations?unresolved=true`,
  `/qc/alerts`, `/qc/control-lots`, `/eqa/my-programs`. These are API sanity checks;
  UI remains the validation authority.
- **6. EQA Setup** — Idempotent seed of the WHO AFRO HIV-VL EQA program so
  LO-07-03's Programme dropdown unblocks.

## Running headless via Newman

```bash
npx newman run openelis-mgtest-qc.postman_collection.json \
    -e openelis-mgtest.postman_environment.json
```

(No `--insecure` needed — the mock subdomain has a real Let's Encrypt cert.)

## Variable overrides

The shipped environment file uses demo OE creds (`admin:adminADMIN!`).
For real deployments, override via Postman's environment editor:

| Variable | When to override |
|---|---|
| `oe_admin_pass` | Production OE admin password |

## Troubleshooting

- **QC trigger returns non-200** — verify the mock is healthy (`GET /health`) and
  analyzers are registered (`GET /analyzers`), then restart with
  `restart-stack.sh --seed-harness`.
- **OE-side QC violations don't show the new row** — check the bridge logs
  (`docker logs openelis-analyzer-bridge --tail 50`) for parse errors. The bridge
  reads `qcRules` from the analyzer profile; if the OE webapp didn't pick up a
  recently added qcRule, restart it (`docker restart openelisglobal-webapp`).
- **`mock.mgtest.openelis-global.org` cert error** — re-run
  `distro/scripts/generate-letsencrypt-certs.sh` against
  `LETSENCRYPT_DOMAINS=mgtest.openelis-global.org,mock.mgtest.openelis-global.org`.

## What this collection does NOT do

- Upload pre-baked CSV files (e.g., `qadocs/QuantStudio Failing QC Samples/`) to
  the bridge directly. Those fixtures test OE's file-watcher import path, not
  the bridge's QC pipeline. Use the harness's separate playwright/upload tests
  for that.
- Touch the bridge admin UI directly. The bridge is internal; only the mock is
  exposed.
- Drive TCP/MLLP from your laptop. All transport happens between the mock and
  bridge containers internally; clients only call the mock API.
