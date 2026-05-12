import { expect, test } from "@playwright/test";

/**
 * LO-01-01 — Marital status dropdown reference-data integrity.
 *
 * UAT Round 2 (May 2026) flagged that "DNA" was appearing as a marital
 * status option, which makes no sense as a marriage state. Tracking the
 * source revealed a legacy 2012-06-11 seed row in clinlims.dictionary
 * (id=1089, dict_entry='DNA', dictionary.marriage.DNA) loaded from OE2's
 * master `install/installerTemplate/linux/initDB/OpenELIS-Global.sql`.
 *
 * This regression locks the dropdown contents to a clean Madagascar-
 * acceptable set. Failure indicates either the seed regression returned
 * or a new placeholder/dev value was added.
 */

const EXPECTED_VALUES = ["married", "single", "divorced", "widowed", "livingWith"];

test.describe("LO-01-01: PATIENT_MARITAL_STATUS dropdown contents", () => {
  test("API returns no DNA option", async ({ page }) => {
    const response = await page.request.get(
      "/api/OpenELIS-Global/rest/displayList/PATIENT_MARITAL_STATUS",
    );
    const body = await response.json();
    await response.dispose();

    expect(response.status(), "displayList endpoint should return 200").toBe(200);
    expect(Array.isArray(body), "response must be an array").toBe(true);

    const offending = body.filter(
      (entry: { value?: string; display?: string }) =>
        /dna/i.test(entry.value || "") || /dna/i.test(entry.display || ""),
    );
    expect(
      offending,
      `Found DNA-like entries in marital status dropdown: ${JSON.stringify(offending)}`,
    ).toEqual([]);
  });

  test("API contains expected core marital states", async ({ page }) => {
    const response = await page.request.get(
      "/api/OpenELIS-Global/rest/displayList/PATIENT_MARITAL_STATUS",
    );
    const body = await response.json();
    await response.dispose();

    const values = body.map((e: { value: string }) => e.value);
    for (const expected of EXPECTED_VALUES) {
      expect(
        values,
        `expected '${expected}' in marital options, got ${JSON.stringify(values)}`,
      ).toContain(expected);
    }
  });
});
