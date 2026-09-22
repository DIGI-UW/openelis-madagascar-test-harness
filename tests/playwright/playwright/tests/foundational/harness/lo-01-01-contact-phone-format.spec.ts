import { test, expect } from "../../../helpers/test-base";
import { UI_TIMEOUT } from "../../../helpers/timeouts";

/**
 * LO-01-01 — Emergency contact phone format hint parity.
 *
 * UAT Round 2 (May 2026) reported: "Format is fixed for patient phone
 * number. However, the format for contact phone under emergency contact
 * info does not conform to prescribed format." (Madagascar uses 7-digit
 * local format, hint was reporting 8 digits.)
 *
 * Root cause / fix path: both inputs hit the same
 * `/rest/PhoneNumberValidationProvider?fieldId=patientPhone` validator and
 * use the same `getPhoneFormatHint(intl, configurationProperties)` helper.
 * The current build (post-develop merge) renders the same helper text on
 * both helpers. This spec locks that parity so a future regression where
 * only primary or only contact reflects the country PHONE_FORMAT_LABEL
 * config will fail loudly.
 */

test.describe("LO-01-01: emergency contact phone format hint", () => {
  test("contactPhone helper DOM matches primaryPhone helper DOM", async ({
    page,
  }) => {
    await page.goto("/PatientManagement", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});

    await page.locator("#newPatient").click();
    await expect(page.locator('input[name="firstName"]')).toBeVisible({
      timeout: UI_TIMEOUT,
    });

    // Lock the structural contract: both helpers must render through the
    // SAME getPhoneFormatHint() output. Compare innerHTML (DOM equality)
    // rather than innerText — Carbon's stacked-helper CSS can affect
    // text-extraction whitespace even when the underlying markup is
    // identical, and the user-perceived format is driven by the markup.
    const primaryHtml = await page
      .locator("#primaryPhone-helper-text")
      .innerHTML();
    const contactHtml = await page
      .locator("#contactPhone-helper-text")
      .innerHTML();

    expect(
      primaryHtml.trim().length,
      "primary phone helper must render non-empty markup",
    ).toBeGreaterThan(0);
    expect(
      contactHtml,
      `contact phone helper markup must match primary (primary=${primaryHtml}, contact=${contactHtml})`,
    ).toBe(primaryHtml);
    // Also lock the country format substring so a missing PHONE_FORMAT_LABEL
    // config doesn't silently regress both to empty.
    expect(primaryHtml, "primary helper must include the local format").toMatch(
      /Local:\s*[^<]+/,
    );
    expect(contactHtml, "contact helper must include the local format").toMatch(
      /Local:\s*[^<]+/,
    );
  });
});
