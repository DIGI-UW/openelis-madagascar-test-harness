import { test, expect } from "@playwright/test";

/**
 * OGC-671 regression — PhoneNumberValidationProvider accepts the Madagascar
 * 37/38 formats with spaces, dashes, or no separators.
 *
 * This supersedes the earlier OGC-646 `+261-33-...` expectation. OGC-671
 * narrows Madagascar patient registration to `+261 37 XX XXX XX` and
 * `+261 38 XX XXX XX`.
 */

const VALIDATE_URL =
  "/api/OpenELIS-Global/rest/PhoneNumberValidationProvider";

test.describe("OGC-671 PhoneNumberValidationProvider — Madagascar 37/38 format", () => {
  test("accepts +261 37 with spaces", async ({ request }) => {
    const url = `${VALIDATE_URL}?fieldId=patientPhone&value=${encodeURIComponent("+261 37 12 345 67")}`;
    const resp = await request.get(url);
    expect(
      resp.status(),
      `Madagascar number should not 401/500. Status: ${resp.status()}`,
    ).toBeLessThan(400);
    const body = await resp.text();
    console.log(`[OGC-646-a accept] body: ${body.substring(0, 300)}`);
    // Backend returns either {"success":true} JSON or a string "true"/"false".
    // Accept any "valid"-shaped response; reject explicit rejection text.
    // Backend response envelope (AjaxServlet wraps IActionConstants.VALID):
    //   accept → {"status":true,"body":"Valid phone number"}
    //   reject → {"status":false,"body":"Phone number must be in the form of <PHONE_FORMAT> ..."}
    const parsed = JSON.parse(body);
    expect(
      parsed.status,
      `Madagascar number should be accepted. Body: ${body}`,
    ).toBe(true);
    expect(parsed.body).toMatch(/valid/i);
  });

  test("accepts +261 37/38 with flexible separators", async ({
    request,
  }) => {
    for (const value of ["+261371234567", "+261-38-99-888-77"]) {
      const url = `${VALIDATE_URL}?fieldId=patientPhone&value=${encodeURIComponent(value)}`;
      const resp = await request.get(url);
      expect(resp.status()).toBeLessThan(400);
      const body = await resp.text();
      console.log(`[OGC-671 accept] ${value}: ${body.substring(0, 300)}`);
      expect(JSON.parse(body).status, `${value} should be accepted`).toBe(true);
    }
  });

  test("rejects legacy +261 33 numbers under OGC-671", async ({ request }) => {
    const url = `${VALIDATE_URL}?fieldId=patientPhone&value=${encodeURIComponent("+261-33-456-76-98")}`;
    const resp = await request.get(url);
    expect(resp.status()).toBeLessThan(500);
    const body = await resp.text();
    console.log(`[OGC-671 reject] body for legacy 33: ${body.substring(0, 300)}`);
    expect(JSON.parse(body).status, "legacy +261 33 must be rejected").toBe(
      false,
    );
  });
});
