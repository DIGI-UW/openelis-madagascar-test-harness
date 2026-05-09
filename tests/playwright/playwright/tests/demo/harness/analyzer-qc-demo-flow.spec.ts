/**
 * Analyzer QC demo flows — three transport lanes (ASTM / HL7 / FILE).
 *
 * Each scenario walks the viewer through the lab admin's setup tour
 * (analyzer dashboard → edit form → QC rules) before triggering a
 * Westgard 1-3s deviation through the scenario-only mock contract.
 * The pipeline is then traced server-side: bridge classifies + propagates
 * lot/level metadata, OE's 3-tier resolver picks the right control lot,
 * Westgard rules fire, the violation surfaces in the QC dashboard +
 * Alerts tab + Instrument detail page.
 *
 * Pacing: when running under `harness-demo-video`, set
 *   PLAYWRIGHT_SLOWMO=750
 * for a stakeholder-friendly tempo; titles linger 4s, steps 2.5s.
 */

import { expect, test } from "../../../helpers/test-base";
import { createDemoPresentation } from "../../../helpers/demo-presentation";
import {
  executePostmanItem,
  openQcDashboard,
  pollQcInstrument,
  pollQcViolations,
  type QcScenario,
  resetBridgeForAnalyzer,
  verifyQcDashboardUi,
  walkAnalyzerSetup,
} from "../../../helpers/postman-qc";
import { TEST_TIMEOUT } from "../../../helpers/timeouts";

const TITLE_MS = 4_000;
const STEP_MS = 2_500;
const PAUSE_MS = 1_500;

const QC_SCENARIOS: QcScenario[] = [
  {
    title: "GeneXpert ASTM QC",
    subtitle: "Westgard 1-3s rejection over the ASTM lane",
    postmanPath: [
      "2. ASTM QC — GeneXpert (HIV-VL)",
      "POST 1-3s rejection (qc_deviation=3.5)",
    ],
    analyzerId: 11,
    instrumentName: "GeneXpert",
    expectedFormName: "Cepheid GeneXpert",
    testName: "HIV",
    expectedSeverity: "REJECTION",
    protocol: "ASTM",
  },
  {
    title: "Mindray BS-200 HL7 QC",
    subtitle: "Westgard 1-3s rejection over the HL7/MLLP lane",
    postmanPath: [
      "4. HL7 QC — Mindray BS-200 (GLU)",
      "POST 1-3s rejection (qc_deviation=3.5)",
    ],
    analyzerId: 13,
    instrumentName: "Mindray BS-200",
    testName: "Glucose",
    expectedSeverity: "REJECTION",
    protocol: "HL7",
  },
  {
    title: "QuantStudio 5 FILE QC",
    subtitle: "Westgard 1-3s rejection over the FILE upload lane",
    postmanPath: [
      "3. FILE QC — QuantStudio 5 (VIH-1)",
      "POST 1-3s rejection (qc_deviation=3.0)",
    ],
    analyzerId: 14,
    instrumentName: "QuantStudio 5",
    testName: "HIV",
    expectedSeverity: "REJECTION",
    protocol: "FILE",
  },
];

function parseTimestamp(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

async function runScenario(
  page: import("@playwright/test").Page,
  scenario: QcScenario,
  testInfo: import("@playwright/test").TestInfo,
) {
  const presentation = createDemoPresentation(page, testInfo);
  const startedAt = Date.now();
  const mockUrl = process.env.SIMULATOR_URL || "http://localhost:8085";

  // Pre-flight: clear any stale bridge state for this analyzer so a re-run
  // of the spec doesn't race with leftover RETRYING rows / incoming files.
  await resetBridgeForAnalyzer(page, scenario.analyzerId);

  await presentation.title(scenario.title, scenario.subtitle, TITLE_MS);

  // Section 1 — Setup walkthrough: dashboard → edit form → QC rules
  await walkAnalyzerSetup(page, scenario, presentation);

  // Section 2 — Trigger via the scenario-only mock contract
  await presentation.scene("QC Trigger via Postman → Mock");
  await presentation.step(
    4,
    `Send a 1-3s deviation through the scenario-only ${scenario.protocol} mock contract`,
    STEP_MS,
  );
  const trigger = await executePostmanItem(page, scenario.postmanPath, {
    mock_url: mockUrl,
  });
  expect(trigger.status).toBe(200);
  expect(trigger.json?.qc).toBe(true);
  expect(["completed", "uploaded"]).toContain(trigger.json?.status);
  await presentation.evidence(`qc-trigger-${scenario.instrumentName}`);
  await presentation.pause(PAUSE_MS);

  // Section 3 — Bridge → OE propagation traced via the QC API
  await presentation.scene("Bridge → OE propagation");
  await presentation.step(
    5,
    "Wait for the QC violation to surface in OpenELIS' QC violations API",
    STEP_MS,
  );
  const violation = await pollQcViolations(page, (entry) => {
    const seenAt = parseTimestamp(entry?.violationDateTime);
    const instrumentOk = String(entry?.instrumentName || "")
      .toLowerCase()
      .includes(scenario.instrumentName.toLowerCase());
    const testOk = String(entry?.testName || "")
      .toLowerCase()
      .includes(scenario.testName.toLowerCase());
    const unresolved = String(entry?.resolutionStatus || entry?.status || "")
      .toUpperCase()
      .includes("UNRESOLVED");
    const ruleOk = scenario.expectedRuleCode
      ? String(entry?.ruleCode || "")
          .toUpperCase()
          .includes(scenario.expectedRuleCode)
      : true;
    const severityOk = scenario.expectedSeverity
      ? String(entry?.severity || "")
          .toUpperCase()
          .includes(scenario.expectedSeverity)
      : true;
    return seenAt >= startedAt && instrumentOk && testOk && unresolved && ruleOk && severityOk;
  });
  expect(violation).toBeTruthy();

  await presentation.step(
    6,
    "Confirm the QC instruments API reflects the new out-of-control state",
    STEP_MS,
  );
  const instrument = await pollQcInstrument(page, scenario.instrumentName);
  expect(instrument).toBeTruthy();

  // Section 4 — QC Dashboard UI: Instruments tab + Alerts tab
  await presentation.step(
    7,
    "Open the QC Dashboard, locate the instrument tile, switch to Alerts",
    STEP_MS,
  );
  await openQcDashboard(page, presentation);
  await verifyQcDashboardUi(page, scenario, instrument, presentation);
  await presentation.pause(PAUSE_MS);

  // Section 5 — Instrument Detail: per-analyte breakdown
  const instrumentId = instrument?.instrumentId || instrument?.id;
  if (instrumentId) {
    await presentation.scene("Instrument Detail");
    await presentation.step(
      8,
      `Open the instrument detail page for the full ${scenario.testName} analyte breakdown`,
      STEP_MS,
    );
    await page.goto(`/analyzers/qc/instruments/${instrumentId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("instrument-detail-page")).toBeVisible();
    await expect(page.getByTestId("analyte-detail-grid")).toContainText(
      scenario.testName,
    );
    await presentation.evidence(
      `qc-instrument-detail-${scenario.instrumentName}`,
    );
    await presentation.pause(PAUSE_MS);
  }

  await presentation.title(
    "Scenario complete",
    `${scenario.instrumentName}: ${scenario.protocol} QC violation captured end-to-end`,
    TITLE_MS,
  );
}

test.describe("Analyzer QC demo flows", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(TEST_TIMEOUT);

  test("GeneXpert ASTM QC: setup walkthrough + Westgard rejection on QC dashboard", async ({ page }, testInfo) => {
    await runScenario(page, QC_SCENARIOS[0], testInfo);
  });

  test("Mindray BS-200 HL7 QC: setup walkthrough + Westgard rejection on QC dashboard", async ({ page }, testInfo) => {
    await runScenario(page, QC_SCENARIOS[1], testInfo);
  });

  test("QuantStudio 5 FILE QC: setup walkthrough + uploads QC file with full lot/level propagation", async ({ page }, testInfo) => {
    await runScenario(page, QC_SCENARIOS[2], testInfo);
  });
});
