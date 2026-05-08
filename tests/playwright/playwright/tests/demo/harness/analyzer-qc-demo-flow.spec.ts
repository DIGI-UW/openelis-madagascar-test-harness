import { expect, test } from "../../../helpers/test-base";
import { createDemoPresentation } from "../../../helpers/demo-presentation";
import {
  executePostmanItem,
  openQcDashboard,
  pollQcInstrument,
  pollQcViolations,
  type QcScenario,
  verifyQcDashboardUi,
} from "../../../helpers/postman-qc";
import { TEST_TIMEOUT } from "../../../helpers/timeouts";

const QC_SCENARIOS: QcScenario[] = [
  {
    title: "GeneXpert ASTM QC",
    subtitle: "1-3s rejection appears in QC dashboard",
    postmanPath: [
      "2. ASTM QC — GeneXpert (HIV-VL)",
      "POST 1-3s rejection (qc_deviation=3.5)",
    ],
    instrumentName: "GeneXpert",
    testName: "HIV",
    expectedSeverity: "REJECTION",
  },
  {
    title: "Mindray BS-200 HL7 QC",
    subtitle: "1-3s rejection appears in QC dashboard",
    postmanPath: [
      "4. HL7 QC — Mindray BS-200 (GLU)",
      "POST 1-3s rejection (qc_deviation=3.5)",
    ],
    instrumentName: "Mindray BS-200",
    testName: "Glucose",
    expectedSeverity: "REJECTION",
  },
  {
    title: "QuantStudio 5 FILE QC",
    subtitle: "Generated QC file appears in QC dashboard",
    postmanPath: [
      "3. FILE QC — QuantStudio 5 (VIH-1)",
      "POST 1-3s rejection (qc_deviation=3.0)",
    ],
    instrumentName: "QuantStudio 5",
    testName: "HIV",
    expectedSeverity: "REJECTION",
  },
];

function parseTimestamp(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

async function runScenario(page: import("@playwright/test").Page, scenario: QcScenario, testInfo: import("@playwright/test").TestInfo) {
  const presentation = createDemoPresentation(page, testInfo);
  const startedAt = Date.now();
  const mockUrl = process.env.SIMULATOR_URL || "http://localhost:8085";

  await presentation.title(scenario.title, scenario.subtitle);
  await presentation.step(1, "Trigger QC scenario through Postman contract");
  const trigger = await executePostmanItem(page, scenario.postmanPath, {
    mock_url: mockUrl,
  });

  expect(trigger.status).toBe(200);
  expect(trigger.json?.qc).toBe(true);
  expect(["completed", "uploaded"]).toContain(trigger.json?.status);
  await presentation.evidence(`qc-trigger-${scenario.instrumentName}`);

  await presentation.step(2, "Poll QC violations API for new unresolved violation");
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
      ? String(entry?.ruleCode || "").toUpperCase().includes(scenario.expectedRuleCode)
      : true;
    const severityOk = scenario.expectedSeverity
      ? String(entry?.severity || "").toUpperCase().includes(scenario.expectedSeverity)
      : true;
    return seenAt >= startedAt && instrumentOk && testOk && unresolved && ruleOk && severityOk;
  });
  expect(violation).toBeTruthy();

  await presentation.step(3, "Poll QC instruments API for lane visibility");
  const instrument = await pollQcInstrument(page, scenario.instrumentName);
  expect(instrument).toBeTruthy();

  await presentation.step(4, "Validate QC dashboard and alerts UI");
  await openQcDashboard(page, presentation);
  await verifyQcDashboardUi(page, scenario, instrument, presentation);

  const instrumentId = instrument?.instrumentId || instrument?.id;
  if (instrumentId) {
    await presentation.step(5, "Open instrument detail page for video evidence");
    await page.goto(`/analyzers/qc/instruments/${instrumentId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("instrument-detail-page")).toBeVisible();
    await expect(page.getByTestId("analyte-detail-grid")).toContainText(
      scenario.testName,
    );
    await presentation.evidence(`qc-instrument-detail-${scenario.instrumentName}`);
  }
}

test.describe("Analyzer QC demo flows", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(TEST_TIMEOUT);

  test("GeneXpert ASTM QC: triggers Westgard rejection and appears on QC dashboard", async ({ page }, testInfo) => {
    await runScenario(page, QC_SCENARIOS[0], testInfo);
  });

  test("Mindray BS-200 HL7 QC: triggers Westgard rejection and appears on QC dashboard", async ({ page }, testInfo) => {
    await runScenario(page, QC_SCENARIOS[1], testInfo);
  });

  // FILE lane is gated on bridge propagating lotNumber/controlLevel as FHIR
  // Observation extensions (qc-metadata-propagation plan). Without it, OE's
  // 3-tier lot resolver can't disambiguate multiple ACTIVE lots (LPC + HPC)
  // for QuantStudio 5 + VIH-1, so QC violations don't fire even though the
  // mock-generated file is uploaded and accepted by the bridge.
  test.fixme("QuantStudio 5 FILE QC: uploads generated QC file and appears on QC dashboard", async ({ page }, testInfo) => {
    await runScenario(page, QC_SCENARIOS[2], testInfo);
  });
});
