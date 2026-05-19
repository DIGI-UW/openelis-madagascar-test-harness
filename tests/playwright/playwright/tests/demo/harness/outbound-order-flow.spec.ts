/**
 * Outbound Order Dispatch Demo Flow
 *
 * Exercises the LIS-initiated order path:
 *   OE2 (ModifyOrder → Send to analyzer button)
 *     → bridge (HTTPListenController for ASTM, /api/send-hl7 for HL7)
 *     → mock analyzer (genexpert_astm on port 9600 / mindray_bc5380 on 5380)
 *     → mock pushes back a matching result on the same / fresh connection
 *     → bridge inbound listener (ASTM 12001 / MLLP 2575)
 *     → OE2 inbound result import (keyed by accession echoed in O.3 / OBR-3)
 *
 * For this proof spec, the click portion runs end-to-end (visual demo). Result
 * verification through AnalyzerResults → Accept → AccessionResults reuses
 * existing helpers (see analyzer-demo-flow.spec.ts for the full pattern);
 * extending this spec to assert the resulted row is a sibling commit once a
 * pre-existing seeded sample/accession is wired in (TODO).
 */

import { expect, test } from "../../../helpers/test-base";
import { createDemoPresentation } from "../../../helpers/demo-presentation";
import {
  createAnalyzerFromProfile,
  teardownAnalyzer,
} from "../../../helpers/create-analyzer-from-profile";
import { sendOrderToAnalyzer } from "../../../helpers/send-analyzer-order";
import { TEST_TIMEOUT, UI_TIMEOUT } from "../../../helpers/timeouts";

const SEEDED_ACCESSION =
  process.env.OUTBOUND_DEMO_ACCESSION || "ACC-OUTBOUND-DEMO";

test.describe("Outbound order dispatch — Send to analyzer", () => {
  test.describe.configure({ timeout: TEST_TIMEOUT });

  test("GeneXpert ASTM — order dispatched via bridge generic forwarder", async ({
    page,
  }) => {
    const demo = createDemoPresentation(page, {
      title: "GeneXpert (ASTM) — outbound order",
      description:
        "OE2 builds an ASTM H/P/O/L message and POSTs it through the bridge to the mock GeneXpert on port 9600.",
    });

    const analyzer = await createAnalyzerFromProfile(page, {
      name: "Demo: Outbound GeneXpert",
      displayName: "GeneXpert ASTM (outbound)",
      analyzerType: "MOLECULAR",
      pluginType: "Generic ASTM",
      profileName: "Cepheid GeneXpert (ASTM Mode)",
      protocol: "ASTM",
      mockAnalyzerName: "demo-outbound-gx",
      port: 9600,
    });

    try {
      await demo.step("Open ModifyOrder for the seeded accession");
      await page.goto(`/ModifyOrder?accessionNumber=${SEEDED_ACCESSION}`);
      await expect(page.getByText(/Modify Order|Order/i)).toBeVisible({
        timeout: UI_TIMEOUT,
      });

      await demo.step("Click 'Send to analyzer' and dispatch to GeneXpert");
      await sendOrderToAnalyzer(page, {
        analyzerName: "Outbound GeneXpert",
      });

      // TODO follow-up: poll mock simulate-api (port 8085) for the inbound
      // order event, then wait for the resulted row on AccessionResults page
      // using openAnalyzerResultsByIdAndWaitForText / acceptAndVerifyResults
      // from existing helpers. The mock now triggers a result push on inbound
      // ASTM order receipt (see analyzer-mock-server PR-B).
    } finally {
      await teardownAnalyzer(page, analyzer);
    }
  });

  test("Mindray HL7 — order dispatched via bridge outbound MLLP", async ({
    page,
  }) => {
    const demo = createDemoPresentation(page, {
      title: "Mindray BC-5380 (HL7) — outbound order",
      description:
        "OE2 generates an ORM^O01 and POSTs it through the bridge's new /api/send-hl7 endpoint; bridge MLLP-sends to mock Mindray on port 5380.",
    });

    const analyzer = await createAnalyzerFromProfile(page, {
      name: "Demo: Outbound Mindray",
      displayName: "Mindray BC-5380 (outbound HL7)",
      analyzerType: "HEMATOLOGY",
      pluginType: "Generic HL7",
      profileName: "Mindray BC-5380",
      protocol: "HL7",
      mockAnalyzerName: "demo-outbound-bc5380",
      port: 5380,
    });

    try {
      await demo.step("Open ModifyOrder for the seeded accession");
      await page.goto(`/ModifyOrder?accessionNumber=${SEEDED_ACCESSION}`);
      await expect(page.getByText(/Modify Order|Order/i)).toBeVisible({
        timeout: UI_TIMEOUT,
      });

      await demo.step("Click 'Send to analyzer' and dispatch to Mindray");
      await sendOrderToAnalyzer(page, {
        analyzerName: "Outbound Mindray",
      });

      // TODO follow-up: assert the bridge MLLP listener receives the ORU^R01
      // result the mock pushes back (mock _push_order_result targets
      // ORDER_RESULT_PUSH_HOST:PORT → openelis-analyzer-bridge:2575 by default).
      // OE2's inbound import keys the result to SEEDED_ACCESSION via OBR-3.
    } finally {
      await teardownAnalyzer(page, analyzer);
    }
  });
});
