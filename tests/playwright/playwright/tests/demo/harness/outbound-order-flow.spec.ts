/**
 * Outbound Order Dispatch — round-trip demo flow
 *
 *   OE2 ModifyOrder ─ Send to analyzer button
 *     → bridge (HTTPListenController for ASTM, /api/send-hl7 for HL7)
 *     → mock analyzer (genexpert_astm:9600 / mindray_bc5380:5380)
 *     → mock pushes a matching result via FRESH connection back to the
 *       bridge's inbound listener (ASTM:12001 / MLLP:2575)
 *     → OE2 inbound result import keys to accession via O.3 / OBR-3
 *     → result row appears on AnalyzerResults → accept → AccessionResults
 *
 * Two tests in one file using createDemoPresentation so the
 * harness-demo-video project records a narrated walkthrough.
 */

import { expect, test } from "../../../helpers/test-base";
import { createDemoPresentation } from "../../../helpers/demo-presentation";
import {
  createAnalyzerFromProfile,
  teardownAnalyzer,
} from "../../../helpers/create-analyzer-from-profile";
import { sendOrderToAnalyzer } from "../../../helpers/send-analyzer-order";
import { acceptAndVerifyResults } from "../../../helpers/accept-results";
import { openAnalyzerResultsByIdAndWaitForText } from "../../../helpers/results-ui";
import { LONG_TIMEOUT, TEST_TIMEOUT, UI_TIMEOUT } from "../../../helpers/timeouts";
import type { AnalyzerTestConfig } from "../../../helpers/analyzer-test-config";

const RESULTS_TIMEOUT = 90_000;
const SIMULATOR_URL = process.env.SIMULATOR_URL || "http://localhost:8085";
const SEEDED_ACCESSION =
  process.env.OUTBOUND_DEMO_ACCESSION || "ACC-OUTBOUND-DEMO";

const CONFIGS: AnalyzerTestConfig[] = [
  {
    name: "Demo: Outbound GeneXpert",
    displayName: "GeneXpert ASTM (outbound)",
    analyzerType: "MOLECULAR",
    pluginType: "Generic ASTM",
    profileName: "Cepheid GeneXpert (ASTM Mode)",
    protocol: "ASTM",
    mockAnalyzerName: "demo-outbound-gx",
    port: 9600,
    push: {
      protocol: "ASTM",
      simulatorUrl: SIMULATOR_URL,
      template: "genexpert_astm",
      destination: "tcp://placeholder:12001",
    },
  },
  {
    name: "Demo: Outbound Mindray",
    displayName: "Mindray BC-5380 (outbound HL7)",
    analyzerType: "HEMATOLOGY",
    pluginType: "Generic HL7",
    profileName: "Mindray BC-5380",
    protocol: "HL7",
    mockAnalyzerName: "demo-outbound-bc5380",
    port: 5380,
    push: {
      protocol: "HL7",
      simulatorUrl: SIMULATOR_URL,
      template: "mindray_bc5380",
      destination: "mllp://placeholder:2575",
    },
  },
];

test.describe("Outbound order dispatch — round-trip", () => {
  test.describe.configure({ timeout: TEST_TIMEOUT });

  for (const config of CONFIGS) {
    test(`${config.displayName} — dispatch + result returns + accept`, async ({
      page,
    }, testInfo) => {
      const presentation = createDemoPresentation(page, testInfo);
      let step = 0;

      await presentation.title(
        config.displayName,
        "Outbound order dispatch → result round-trip",
      );

      const analyzer = await createAnalyzerFromProfile(
        page,
        config,
        presentation,
      );

      try {
        await presentation.step(
          ++step,
          `Open ModifyOrder for accession ${SEEDED_ACCESSION}`,
        );
        await page.goto(`/ModifyOrder?accessionNumber=${SEEDED_ACCESSION}`);
        await expect(page.getByRole("button", {
          name: /send to analyzer/i,
        })).toBeVisible({ timeout: UI_TIMEOUT });

        await presentation.step(
          ++step,
          `Click 'Send to analyzer' and dispatch to ${config.displayName}`,
        );
        await sendOrderToAnalyzer(page, { analyzerName: config.name });
        await presentation.evidence(
          `${config.name}-dispatched`.replace(/[^a-zA-Z0-9._-]/g, "-"),
        );

        await presentation.step(
          ++step,
          "Wait for the result to return on AnalyzerResults",
        );
        // The mock receives the order and pushes a matching result back via
        // fresh TCP/MLLP to the bridge listener; the bridge forwards FHIR to
        // OE2; the existing inbound import keys the result to the seeded
        // accession via O.3 / OBR-3.
        await openAnalyzerResultsByIdAndWaitForText(
          page,
          analyzer.id,
          SEEDED_ACCESSION,
          {
            timeoutMs: RESULTS_TIMEOUT,
            perAttemptTimeoutMs: LONG_TIMEOUT,
            allExpectedAccessions: [SEEDED_ACCESSION],
          },
        );
        await presentation.evidence(
          `${config.name}-result-staged`.replace(/[^a-zA-Z0-9._-]/g, "-"),
        );

        await presentation.step(
          ++step,
          "Accept the result and verify on AccessionResults",
        );
        await acceptAndVerifyResults(
          page,
          presentation,
          step,
          SEEDED_ACCESSION,
          testInfo,
          1, // accept just the one seeded accession
          config.name.replace(/[^a-zA-Z0-9._-]/g, "-"),
        );
      } finally {
        await teardownAnalyzer(page, analyzer);
      }
    });
  }
});
