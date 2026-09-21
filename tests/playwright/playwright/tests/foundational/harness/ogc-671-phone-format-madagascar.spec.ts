import { test, expect } from "@playwright/test";

/**
 * OGC-671 — Madagascar phone validation contract (LO-01-01 registration).
 *
 * Local numbers are restricted to the 37 (Orange) and 38 (Telecom) prefixes,
 * may be entered with or without +261, and with spaces, dashes or no
 * separators at all. Any other country's number is accepted through the
 * E164 international path. This is the contract in the Jira ticket, shipped
 * by distro PRs #11 and #13 (2026-05-08) and confirmed done in the
 * 2026-05-14 review.
 *
 * History, because the previous version of this spec asserted the opposite:
 * OGC-646-a (2026-05-04) required `+261-33-456-76-98` to be accepted, and
 * fixed a real bug to get there. OGC-671 then deliberately narrowed local
 * numbers to 37/38, and OGC-646 was closed pointing at OGC-671 as its
 * successor. A spec still asserting 33 is accepted was testing a superseded
 * requirement, not catching a regression.
 *
 * Drives the auth-protected validator through the Playwright `request` API,
 * which carries the session set by auth.setup.ts. Response envelope:
 *   accept → {"status":true,"body":"Valid phone number"}
 *   reject → {"status":false,"body":"Phone number must be in the form of ..."}
 */

const VALIDATE_URL = "/api/OpenELIS-Global/rest/PhoneNumberValidationProvider";

type Validation = { status: boolean; body: string; raw: string };

async function validate(
  request: Parameters<Parameters<typeof test>[1]>[0]["request"],
  value: string,
): Promise<Validation> {
  const resp = await request.get(
    `${VALIDATE_URL}?fieldId=patientPhone&value=${encodeURIComponent(value)}`,
  );
  expect(
    resp.status(),
    `validator must answer, not 401/500 (${value})`,
  ).toBeLessThan(400);
  const raw = await resp.text();
  return { ...(JSON.parse(raw) as { status: boolean; body: string }), raw };
}

test.describe("OGC-671 phone validation — Madagascar", () => {
  // The ticket's own examples, in every separator style it says to allow.
  const ACCEPTED_LOCAL = [
    "+261 37 45 676 98",
    "+261374567698",
    "+261-37-45-676-98",
    "37 45 676 98",
    "374567698",
    "+37 45 676 98",
    "+261 38 12 345 67",
  ];

  for (const value of ACCEPTED_LOCAL) {
    test(`accepts local ${value}`, async ({ request }) => {
      const r = await validate(request, value);
      expect(r.status, `should be accepted: ${r.raw}`).toBe(true);
      expect(r.body).toMatch(/valid/i);
    });
  }

  test("accepts a foreign number through the E164 path", async ({
    request,
  }) => {
    const r = await validate(request, "+33 6 12 34 56 78");
    expect(r.status, `should be accepted: ${r.raw}`).toBe(true);
  });

  // 33 is Airtel. OGC-671 restricts local numbers to 37/38, so this is the
  // OGC-646-a number and it is now correctly rejected.
  test("rejects a 33-prefix local number (OGC-646-a's case, superseded by OGC-671)", async ({
    request,
  }) => {
    const r = await validate(request, "+261-33-456-76-98");
    expect(r.status, `should be rejected: ${r.raw}`).toBe(false);
    expect(r.body).toMatch(/must be in the form/i);
  });

  test("rejects an obviously malformed number (positive control)", async ({
    request,
  }) => {
    const r = await validate(request, "abc");
    expect(r.status, `should be rejected: ${r.raw}`).toBe(false);
  });
});
