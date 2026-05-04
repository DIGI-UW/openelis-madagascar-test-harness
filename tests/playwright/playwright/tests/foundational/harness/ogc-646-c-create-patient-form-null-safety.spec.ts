import { test, expect } from "@playwright/test";

/**
 * OGC-646-c regression — CreatePatientForm null-safety on healthDistricts.
 *
 * Original bug: when GET /rest/health-districts-for-region returns null
 * (e.g., transient backend error), CreatePatientForm.jsx:1584 ran
 * `healthDistricts.map(...)` without optional chaining, throwing TypeError
 * and triggering the React error boundary that renders the "Sample entry
 * could not be loaded" fallback. The sibling line 1556 already used
 * `healthRegions?.map()` correctly; this fix brings the districts dropdown
 * into line.
 *
 * Strategy: stub the districts API to return null via Playwright's route
 * interception. The page must render the SamplePatientEntry without
 * falling to the error boundary.
 */

const ACCESSION_PAGE = "/SamplePatientEntry";
const ERROR_BOUNDARY_TEXT =
  /Sample entry could not be loaded|Something went wrong on the sample entry page/i;

test.describe("OGC-646-c CreatePatientForm null-safety on healthDistricts", () => {
  test("page does not crash to error boundary when districts API returns null", async ({
    page,
  }) => {
    test.setTimeout(60_000);

    // Force the districts API to return null — reproduces the original
    // failure mode from CreatePatientForm.jsx:480 setHealthDistricts(res).
    await page.route(/\/rest\/health-districts-for-region/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "null",
      });
    });

    // Navigate to the page that mounts CreatePatientForm.
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => {
      consoleErrors.push(err.message);
    });

    await page.goto(ACCESSION_PAGE, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000); // give React time to commit + crash if it's going to

    // Capture screenshot for record.
    await page
      .screenshot({
        path: `/tmp/ogc-646-c-${Date.now()}.png`,
        fullPage: true,
      })
      .catch(() => {});

    // Assert: error boundary did NOT fire.
    const errorBoundaryVisible = await page
      .getByText(ERROR_BOUNDARY_TEXT)
      .first()
      .isVisible()
      .catch(() => false);

    if (errorBoundaryVisible) {
      console.log("[OGC-646-c] ERROR BOUNDARY VISIBLE — bug is reproducing");
    }
    if (consoleErrors.length > 0) {
      console.log(
        "[OGC-646-c] page errors captured:",
        JSON.stringify(consoleErrors, null, 2),
      );
    }

    expect(
      errorBoundaryVisible,
      "Error boundary should NOT fire when districts API returns null (OGC-646-c regression)",
    ).toBe(false);

    // Belt-and-suspenders: no TypeError about reading .map of null/undefined.
    const mapCrash = consoleErrors.find((e) =>
      /(?:Cannot read prop|of (?:null|undefined))/.test(e),
    );
    expect(
      mapCrash,
      `Should not throw .map-of-null TypeError. Captured errors: ${JSON.stringify(consoleErrors)}`,
    ).toBeUndefined();
  });
});
