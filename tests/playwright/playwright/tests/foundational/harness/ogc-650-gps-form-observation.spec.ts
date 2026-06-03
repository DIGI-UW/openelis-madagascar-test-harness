import { test, expect } from "@playwright/test";

/**
 * OGC-650 observation spec — does /SamplePatientEntry render the
 * GpsCoordinatesCapture component (or any lat/long input)?
 *
 * Casey's full ticket text (3 lines): "Add two text boxes: Latitude and
 * Longitude / Add to Madagascar distro / See LO-01-01"
 *
 * What we already know:
 *   - clinlims.sample.gps_latitude/gps_longitude/etc. columns EXIST
 *   - frontend/src/components/addOrder/GpsCoordinatesCapture.jsx EXISTS
 *   - GpsCoordinatesCapture is mounted at addOrder/SampleType.jsx:624
 *   - 3 mgtest samples, 0 with GPS captured
 *
 * Question: does the form Casey is on (/SamplePatientEntry) include
 * GpsCoordinatesCapture or any lat/long inputs?
 *
 * NOT a regression test — purely diagnostic. Will be deleted or
 * refactored once we know the actual scope.
 */

test.describe("OGC-650 observation — GPS / lat-long on /SamplePatientEntry", () => {
  test("capture form contents + look for any GPS / lat / long inputs", async ({
    page,
  }) => {
    test.setTimeout(45_000);

    await page.goto("/SamplePatientEntry", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);

    await page
      .screenshot({
        path: `/tmp/ogc-650-${Date.now()}.png`,
        fullPage: true,
      })
      .catch(() => {});

    // Scan for any text or input matching lat/long/gps/coordinate.
    const labelMatches = await page
      .locator(
        ':text-matches("(latitude|longitude|gps|coordinate|geolocation|geo location)", "i")',
      )
      .allTextContents()
      .catch(() => []);
    console.log(
      "[OGC-650] visible lat/long/gps text matches:",
      JSON.stringify(labelMatches.slice(0, 30)),
    );

    // Scan for input/select elements with name/id mentioning gps/lat/long.
    const inputs = await page
      .locator(
        'input[name*="gps" i], input[name*="latitude" i], input[name*="longitude" i], input[id*="gps" i], input[id*="latitude" i], input[id*="longitude" i]',
      )
      .all();
    console.log(`[OGC-650] gps/lat/long input element count: ${inputs.length}`);
    for (let i = 0; i < inputs.length; i++) {
      const id = await inputs[i].getAttribute("id").catch(() => null);
      const name = await inputs[i].getAttribute("name").catch(() => null);
      console.log(`[OGC-650] input[${i}] id=${id} name=${name}`);
    }

    // Total form input count (sanity).
    const totalInputs = await page.locator("input, select, textarea").count();
    console.log(`[OGC-650] total form inputs on page: ${totalInputs}`);

    // No assertions — diagnostic only.
    expect(true).toBe(true);
  });
});
